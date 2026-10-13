import { ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG, Pace, seedPassword } from './config';

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PKG = 'com.hsrp.dealer';

export interface PNode {
  text: string | null;
  value: string | null;
  desc: string | null;
  x: number;
  y: number;
  w: number;
  h: number;
  clickable: boolean;
  editable: boolean;
  enabled: boolean;
  checked: boolean;
  selected: boolean;
}
type Match = string | RegExp | ((n: PNode) => boolean);

/**
 * The dealer app on the Android emulator (debug build). The screen is read through the app's automation bridge
 * (app/src/debug/.../AutomationBridge.kt, ~50 ms) instead of `uiautomator dump` (~3 s); taps and typing go through
 * `adb shell input`, so they are real touches and show as circles ("show taps" is switched on).
 */
export class Phone {
  private shell: ChildProcessWithoutNullStreams | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private seq = 0;
  private screenH = 2400;

  constructor(private pace: Pace) {}

  async init() {
    const devices = (await this.adb(['devices'])).stdout;
    if (!devices.includes(`${CONFIG.adbSerial}\tdevice`)) throw new Error(`Emulator ${CONFIG.adbSerial} is not running (adb devices: ${devices.trim().replace(/\s+/g, ' ')})`);
    await this.adb(['forward', `tcp:${CONFIG.bridgePort}`, 'tcp:7777']);
    await this.sh('settings put system show_touches 1');
    // Gboard's "Try out your stylus" tutorial pops up over the app and swallows typed text; keep it off.
    await this.sh('settings put secure stylus_handwriting_enabled 0');
    await this.sh(`am start -n ${PKG}/.MainActivity`);
    await this.waitFor(() => true, 'the dealer app on screen', 20_000);
  }

  async close() {
    this.shell?.stdin.end();
    this.shell?.kill();
  }

  private adb(args: string[]) {
    return run(CONFIG.adbPath, ['-s', CONFIG.adbSerial, ...args], { windowsHide: true });
  }

  /** Runs a command in one long-lived `adb shell` (saves ~150 ms per tap over a new adb process). */
  sh(cmd: string): Promise<string> {
    const job = this.queue.then(
      () =>
        new Promise<string>((resolve, reject) => {
          if (!this.shell) {
            this.shell = spawn(CONFIG.adbPath, ['-s', CONFIG.adbSerial, 'shell'], { windowsHide: true });
            this.shell.on('exit', () => (this.shell = null));
          }
          const marker = `__sim_done_${++this.seq}__`;
          let out = '';
          const timer = setTimeout(() => reject(new Error(`adb shell timed out: ${cmd}`)), 15_000);
          const onData = (d: Buffer) => {
            out += d.toString();
            const i = out.indexOf(marker);
            if (i >= 0) {
              clearTimeout(timer);
              this.shell?.stdout.off('data', onData);
              resolve(out.slice(0, i));
            }
          };
          this.shell.stdout.on('data', onData);
          this.shell.stdin.write(`${cmd}; echo ${marker}\n`);
        }),
    );
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** Visible screen content (merged Compose semantics nodes with screen bounds). */
  async nodes(): Promise<PNode[]> {
    const res = await fetch(`http://127.0.0.1:${CONFIG.bridgePort}/nodes`).catch(() => null);
    if (!res?.ok) return [];
    const body = (await res.json().catch(() => null)) as { height?: number; nodes?: PNode[] } | null;
    if (body?.height) this.screenH = body.height;
    return body?.nodes ?? [];
  }

  static match(m: Match): (n: PNode) => boolean {
    if (typeof m === 'function') return m;
    if (typeof m === 'string') return (n) => n.text === m || n.desc === m;
    return (n) => m.test(n.text ?? '') || m.test(n.desc ?? '');
  }

  async find(m: Match) {
    return (await this.nodes()).find(Phone.match(m)) ?? null;
  }

  async waitFor(m: Match, label: string, timeoutMs = 15_000): Promise<PNode> {
    const pred = Phone.match(m);
    const end = Date.now() + timeoutMs;
    while (Date.now() < end) {
      const hit = (await this.nodes()).find(pred);
      if (hit) return hit;
      await sleep(120);
    }
    throw new Error(`Dealer app: "${label}" did not appear within ${Math.round(timeoutMs / 1000)} s`);
  }

  /** The part of the screen between the top app bar and the bottom tab bar. */
  private async band() {
    const nav = await this.find('Home');
    return { top: 260, bottom: (nav?.y ?? this.screenH - 280) - 30 };
  }

  /** Scrolls (real swipes) until the node is fully inside the visible band; returns its fresh position. */
  async reveal(m: Match, label: string): Promise<PNode> {
    for (let i = 0; i < 12; i++) {
      const n = await this.find(m);
      const band = await this.band();
      if (n && n.y >= band.top && n.y + n.h <= band.bottom) return n;
      const mid = Math.round((band.top + band.bottom) / 2);
      // Not composed yet (lazy list) → scroll down a page; otherwise scroll just enough to centre it.
      const delta = n ? Math.max(-900, Math.min(900, n.y + n.h / 2 - mid)) : 700;
      await this.sh(`input swipe 540 ${mid + Math.round(delta / 2)} 540 ${mid - Math.round(delta / 2)} 350`);
      await sleep(350);
    }
    throw new Error(`Dealer app: could not scroll "${label}" into view`);
  }

  async tapNode(n: PNode) {
    await this.sh(`input tap ${Math.round(n.x + n.w / 2)} ${Math.round(n.y + n.h / 2)}`);
    await sleep(this.pace.phoneAfterTap);
  }

  /** Waits for the element, scrolls it into view and taps it. */
  async tap(m: Match, label = String(m), timeoutMs = 15_000) {
    const pred = Phone.match(m);
    const start = Date.now();
    let swipes = 0;
    while (Date.now() - start < timeoutMs) {
      if ((await this.nodes()).some(pred)) {
        await this.tapNode(await this.reveal(m, label));
        return;
      }
      // Not on the screen yet: wait a moment for loading, then look further down (lazy lists compose on scroll).
      if (Date.now() - start > 2500 && swipes < 6) {
        const band = await this.band();
        const mid = Math.round((band.top + band.bottom) / 2);
        await this.sh(`input swipe 540 ${mid + 350} 540 ${mid - 350} 300`);
        swipes++;
      }
      await sleep(150);
    }
    throw new Error(`Dealer app: "${label}" did not appear within ${Math.round(timeoutMs / 1000)} s`);
  }

  /**
   * Types into the focused field (spaces as %s for `input text`). With `field`, checks what the field now holds and,
   * if the keyboard dropped characters (fields that rewrite their text on every key, e.g. upper-casing), clears it and
   * types one character at a time.
   */
  async type(text: string, field?: Match) {
    const safe = (t: string) => t.replace(/[^A-Za-z0-9 .,_-]/g, '').replace(/ /g, '%s');
    await this.sh(`input text "${safe(text)}"`);
    await sleep(this.pace.phoneAfterTap);
    if (!field) return;
    const norm = (v: string | null | undefined) => (v ?? '').toUpperCase().replace(/\s+/g, ' ').trim();
    for (let attempt = 0; attempt < 2; attempt++) {
      const n = await this.find(field);
      if (norm(n?.value) === norm(text)) return;
      // A keyboard overlay may have taken the text: close the keyboard, focus the field again, retype slowly.
      await this.hideKeyboard();
      if (n) await this.tapNode(n);
      await this.sh(`input keyevent KEYCODE_MOVE_END; for i in $(seq 1 ${(n?.value?.length ?? 0) + 4}); do input keyevent KEYCODE_DEL; done`);
      for (const ch of text) await this.sh(`input text "${safe(ch) || '%s'}"`);
      await sleep(this.pace.phoneAfterTap);
    }
    const n = await this.find(field);
    if (norm(n?.value) !== norm(text)) throw new Error(`Dealer app: the field holds "${n?.value}" instead of "${text}"`);
  }

  async hideKeyboard() {
    const ime = await this.sh('dumpsys input_method | grep -E "mInputShown|isInputViewShown" | head -3');
    if (/=true/.test(ime)) {
      await this.sh('input keyevent 4');
      await sleep(300);
    }
  }

  /** Taps a bottom tab (Home, Orders, Inward, Fitment, Sync). */
  async tab(name: 'Home' | 'Orders' | 'Inward' | 'Fitment' | 'Sync') {
    await this.hideKeyboard();
    // Leave any sub-screen first: sub-screens show a back arrow in the top bar.
    // App-bar and tab-bar items never scroll, so they are tapped where they are.
    for (let i = 0; i < 3; i++) {
      const back = await this.find((n) => n.desc === 'Back');
      if (!back) break;
      await this.tapNode(back);
    }
    const nav = await this.find('Home');
    await this.tapNode(await this.waitFor((n) => n.text === name && n.clickable && (!nav || n.y >= nav.y - 5), `${name} tab`));
  }

  /** Makes sure the app is signed in as the demo dealer (signs in on screen if needed). */
  async ensureSignedIn() {
    const nodes = await this.nodes();
    if (!nodes.some((n) => n.text === 'Sign in')) return;
    await this.tap((n) => n.editable && /Username/.test(n.text ?? ''), 'Username field');
    await this.type(CONFIG.users.dealer, (n) => n.editable && /Username/.test(n.text ?? ''));
    await this.tap((n) => n.editable && /Password/.test(n.text ?? ''), 'Password field');
    await this.sh(`input text "${seedPassword().replace(/[^A-Za-z0-9._-]/g, '')}"`);
    await this.hideKeyboard();
    await this.tap('Sign in');
    await this.waitFor('Home', 'home screen', 20_000);
  }

  async screenshot(path: string) {
    const { writeFile } = await import('node:fs/promises');
    const res = await new Promise<Buffer>((resolve, reject) =>
      execFile(CONFIG.adbPath, ['-s', CONFIG.adbSerial, 'exec-out', 'screencap', '-p'], { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }, (e, out) => (e ? reject(e) : resolve(out))),
    ).catch(() => null);
    if (res) await writeFile(path, res);
  }
}
