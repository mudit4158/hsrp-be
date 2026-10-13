import { Browser, chromium, Locator, Page } from 'playwright-core';
import { CONFIG, Pace, seedPassword } from './config';
import { OVERLAY_SCRIPT } from './overlay';

export type WebRole = 'admin' | 'station' | 'dealer';

const ROLES: Record<WebRole, { user: string; label: string; color: string }> = {
  admin: { user: CONFIG.users.admin, label: 'Operations / admin · admin', color: '#6d28d9' },
  station: { user: CONFIG.users.station, label: 'Embossing station · station.kol', color: '#0f766e' },
  dealer: { user: CONFIG.users.dealer, label: 'Dealer WB01 (web) · dealer.wb01', color: '#b45309' },
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The browser side of the simulation. Each role has its own window (own session) laid exactly on top of the
 * others, so changing role is an instant window switch instead of a sign-out and sign-in. All windows share the
 * caption, so the viewer always sees which case and step is running.
 */
export class Web {
  private browser!: Browser;
  private windows = new Map<WebRole, RoleWindow>();
  private bounds = { left: 0, top: 0, width: 1280, height: 860 };
  private caption: { head: string; text: string; who: string } | null = null;
  active: RoleWindow | null = null;

  constructor(private pace: Pace) {}

  async launch() {
    this.browser = await chromium.launch({
      channel: CONFIG.browserChannel,
      headless: false,
      // The role windows are stacked; keep the hidden ones rendering so a role switch shows a live page at once.
      args: ['--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding', '--disable-background-timer-throttling', '--no-first-run', '--no-default-browser-check', '--disable-popup-blocking', '--disable-features=Translate,AutofillServerCommunication', '--disable-infobars', '--hide-crash-restore-bubble'],
    });
    // Size the windows from the screen: the browser on the left, the emulator window on the right.
    const probe = await this.browser.newPage();
    const screen = await probe.evaluate(() => ({ w: window.screen.availWidth, h: window.screen.availHeight }));
    await probe.close();
    this.bounds = { left: 0, top: 0, width: Math.max(1100, screen.w - CONFIG.phonePanelWidth), height: screen.h };
  }

  async close() {
    await this.browser?.close().catch(() => undefined);
  }

  /** Brings the role's window to the front, opening and signing in on first use. */
  async as(role: WebRole): Promise<RoleWindow> {
    // A window closed by hand (or a crashed browser) is reopened and signed in again, so the run carries on.
    if (!this.browser.isConnected()) {
      console.log('      (browser was closed; reopening it)');
      this.windows.clear();
      this.active = null;
      await this.launch();
    }
    let w = this.windows.get(role);
    if (w && w.page.isClosed()) {
      this.windows.delete(role);
      if (this.active === w) this.active = null;
      w = undefined;
    }
    if (!w) {
      const context = await this.browser.newContext({ viewport: null, acceptDownloads: false });
      await context.addInitScript(OVERLAY_SCRIPT);
      const page = await context.newPage();
      page.on('close', () => console.log(`      (the ${role} window was closed)`));
      w = new RoleWindow(page, role, this.pace);
      this.windows.set(role, w);
      await w.place(this.bounds);
      await page.bringToFront();
      this.active = w;
      await page.goto(CONFIG.webUrl);
      await w.decorate(this.caption);
      await w.signIn();
    }
    if (this.active !== w) {
      await w.page.bringToFront();
      await w.decorate(this.caption);
      this.active = w;
    }
    return w;
  }

  /** Sets the caption on every open window (the active one shows it). */
  async setCaption(head: string, text: string, who: string) {
    this.caption = { head, text, who };
    await this.active?.decorate(this.caption);
  }

  /** A card over the active window (case intro, results). Opens the admin window if none is open yet. */
  async card(opts: { title: string; badge?: string; tone?: string; lines?: string[]; foot?: string; button?: string; waitMs?: number }) {
    const w = this.active && !this.active.page.isClosed() ? this.active : await this.as(this.active?.role ?? 'admin');
    await w.page.evaluate((o) => (window as any).__sim.card(o), opts);
  }

  async screenshot(path: string) {
    await this.active?.page.screenshot({ path }).catch(() => undefined);
  }
}

/** One signed-in window. Every action moves the visible cursor first, so a viewer can follow each click. */
export class RoleWindow {
  constructor(
    readonly page: Page,
    readonly role: WebRole,
    private pace: Pace,
  ) {}

  async place(b: { left: number; top: number; width: number; height: number }) {
    const cdp = await this.page.context().newCDPSession(this.page);
    const { windowId } = await cdp.send('Browser.getWindowForTarget');
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: { windowState: 'normal' } });
    await cdp.send('Browser.setWindowBounds', { windowId, bounds: b });
    await cdp.detach();
  }

  async decorate(caption: { head: string; text: string; who: string } | null) {
    const r = ROLES[this.role];
    await this.page
      .evaluate(
        ([label, color, cap, move]) => {
          const sim = (window as any).__sim;
          if (!sim) return;
          sim.setSpeed(move);
          sim.role(label, color);
          if (cap) sim.caption(cap.head, cap.text, cap.who);
          else sim.clearCaption();
        },
        [r.label, r.color, caption, this.pace.move] as const,
      )
      .catch(() => undefined);
  }

  async signIn() {
    const user = this.field('Username');
    if (!(await user.isVisible().catch(() => false))) return;
    await this.type(user, ROLES[this.role].user);
    await this.type(this.field('Password'), seedPassword(), { secret: true });
    await this.click(this.page.getByRole('button', { name: 'Sign in' }));
    await this.page.locator('nav.nav').waitFor({ timeout: 15_000 });
  }

  // ------------------------------------------------------------------ primitives

  /** Smoothly scrolls the element to the middle of the window (if needed) and glides the cursor onto it. */
  async pointAt(target: Locator) {
    await target.waitFor({ state: 'visible', timeout: 15_000 });
    const moved = await target.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (r.top >= 70 && r.bottom <= window.innerHeight - 110) return false;
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return true;
    });
    if (moved) await sleep(420);
    const box = await target.boundingBox();
    if (!box) throw new Error('Element has no position on screen');
    await this.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await sleep(this.pace.move);
    return box;
  }

  async click(target: Locator, opts: { pause?: number } = {}) {
    await this.pointAt(target);
    await target.click({ timeout: 10_000 });
    await sleep(opts.pause ?? this.pace.afterClick);
  }

  /** Clicks a button by its visible name. */
  button(name: string | RegExp, scope?: Locator) {
    return (scope ?? this.page).getByRole('button', { name, exact: typeof name === 'string' });
  }

  async clickButton(name: string | RegExp, scope?: Locator) {
    await this.click(this.button(name, scope).first());
  }

  /** Clears the field and types like a person; `secret` hides nothing on screen but keeps it out of logs. */
  async type(target: Locator | string, text: string, opts: { secret?: boolean } = {}) {
    const field = typeof target === 'string' ? this.field(target) : target;
    await this.click(field, { pause: 120 });
    await field.fill('');
    await this.page.keyboard.type(text, { delay: opts.secret ? 10 : this.pace.typeDelay });
    await sleep(Math.min(250, this.pace.afterClick));
  }

  /** Native <select>: points at it, flashes it and picks the option whose label starts with `optionLabel`. */
  async select(target: Locator | string, optionLabel: string) {
    const sel = typeof target === 'string' ? this.field(target) : target;
    await this.pointAt(sel);
    const box = await sel.boundingBox();
    if (box) await this.page.evaluate(([x, y]) => (window as any).__sim?.ripple(x, y), [box.x + box.width / 2, box.y + box.height / 2] as const);
    // Matches an option by the start of its label or by its value.
    const label = await sel.evaluate((el, wanted) => {
      const o = Array.from((el as HTMLSelectElement).options).find((x) => x.label.startsWith(wanted) || x.value === wanted);
      return o?.label ?? null;
    }, optionLabel);
    if (!label) throw new Error(`No option "${optionLabel}"`);
    await sel.selectOption({ label });
    await sleep(this.pace.afterClick);
  }

  /** Opens a page from the left menu (client-side navigation, no reload). */
  async nav(label: string) {
    await this.click(this.page.locator('nav.nav').getByRole('link', { name: label, exact: true }));
    await this.page.waitForLoadState('domcontentloaded');
  }

  /**
   * The input/select/textarea of a form field by its label text. The app's <label> wraps the control and its hint,
   * so accessible names include the hint; match the label's own caption instead.
   */
  field(label: string, scope?: Locator) {
    return (scope ?? this.page)
      .locator('label.field', { has: this.page.locator('.field-label').getByText(label, { exact: true }) })
      .locator('input, select, textarea')
      .first();
  }

  /** The table row that contains `text`. */
  row(text: string) {
    return this.page.locator('tbody tr', { hasText: text }).first();
  }

  modal() {
    return this.page.locator('.modal').last();
  }

  async waitText(text: string | RegExp, timeoutMs = 15_000, scope?: Locator) {
    await (scope ?? this.page).getByText(text).first().waitFor({ state: 'visible', timeout: timeoutMs });
  }

  /** Points at something worth reading (a status, a result row) and keeps it on screen for a moment. */
  async show(target: Locator, ms = this.pace.read) {
    await this.pointAt(target);
    await target.evaluate((el, d) => (window as any).__sim?.focus(el, d), ms).catch(() => undefined);
    await sleep(ms);
  }

  /** Runs `action` (which opens a PDF in a new tab), shows the PDF briefly, closes it and returns here. */
  async viewPopup(action: () => Promise<void>, ms = this.pace.read) {
    // The app opens PDFs after an API call; Chrome may treat that as a popup without a user gesture and drop it.
    // The PDF is only shown for the viewer, so a missing tab is not a failure.
    const popup = this.page.context().waitForEvent('page', { timeout: 8_000 }).catch(() => null);
    await action();
    const p = await popup;
    if (!p) return;
    await p.waitForLoadState().catch(() => undefined);
    await sleep(ms);
    await p.close();
    await this.page.bringToFront();
  }
}
