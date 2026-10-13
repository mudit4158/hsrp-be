import type { Ctx, Step } from '../core/types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Switches the VAHAN mock on the Simulator page (normal / down / slow / not-found). */
export function vahanMode(mode: 'normal' | 'down'): Step {
  return {
    who: 'admin',
    say: mode === 'down' ? 'Admin switches the VAHAN mock to "down": VAHAN stops answering' : 'Admin switches the VAHAN mock back to "normal"',
    async run(c) {
      const w = await c.web.as('admin');
      await w.nav('Simulator');
      await w.clickButton(mode, w.page.locator('.card', { hasText: 'VAHAN mock' }));
      await w.waitText(new RegExp(`Now: ${mode}`));
      await w.show(w.page.locator('.card', { hasText: 'VAHAN mock' }).first());
    },
  };
}

/** Integration monitor: shows the failing VAHAN post for the case's order. */
export const showVahanRetrying: Step = {
  who: 'admin',
  say: 'The fitment is saved but VAHAN is down: the post waits in the retry queue (order stays Fitted)',
  async run(c) {
    await c.api.waitFor('VAHAN post retrying', () => c.api.orderDetail(c.data.orderId), (d: any) => ['RETRYING', 'PENDING'].includes(d.fitment?.vahanStatus) && d.order.status === 'FITTED', 60_000);
    const w = await c.web.as('admin');
    await w.nav('Integration monitor');
    await w.waitText('Replay all VAHAN posts');
    await w.show(w.page.locator('tbody tr', { hasText: /vahan-post/ }).first(), c.pace.read * 1.5);
  },
};

export const replayVahanPosts: Step = {
  who: 'admin',
  say: 'Admin replays the queued VAHAN posts; VAHAN accepts the fitment and the order completes',
  async run(c) {
    const w = await c.web.as('admin');
    await w.nav('Integration monitor');
    await w.clickButton('Replay all VAHAN posts');
    await c.api.waitStatus(c.data.orderId, ['COMPLETED'], 60_000);
    await sleep(c.pace.read / 2);
  },
};

/** Opens a report, fills its filters and runs it; keeps the result on screen. */
export function runReport(name: string, filters: (c: Ctx) => Record<string, string>, say: string): Step {
  return {
    who: 'admin',
    say,
    async run(c) {
      const w = await c.web.as('admin');
      if (!w.page.url().endsWith('/reports')) await w.nav('Reports');
      await w.click(w.page.locator('tbody tr', { hasText: name }).first());
      const card = w.page.locator('.card', { has: w.page.getByRole('heading', { name, exact: true }) });
      for (const [label, value] of Object.entries(filters(c))) {
        const field = w.field(label, card);
        if ((await field.evaluate((e) => e.tagName)) === 'SELECT') await w.select(field, value);
        else await w.type(field, value);
      }
      await w.clickButton('Run', card);
      await card.getByText(/^\d+ rows$/).waitFor({ timeout: 15_000 });
      await w.show(card.locator('table').first(), c.pace.read * 2);
    },
  };
}
