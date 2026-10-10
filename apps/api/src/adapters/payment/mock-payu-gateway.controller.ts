import { Body, Controller, Logger, Post, Res } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Response } from 'express';
import { randomInt } from 'node:crypto';
import { env } from '../../platform/config/env';
import { PrismaService } from '../../platform/database/prisma.service';
import { Public } from '../../platform/http/decorators';
import { requestHash, responseHash } from './payu-hash';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function page(title: string, inner: string) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title>
<style>body{font-family:system-ui,sans-serif;background:#f3f4f6;margin:0;padding:24px}main{max-width:440px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 4px #0002}
h1{font-size:20px;margin:0 0 4px}.tag{display:inline-block;background:#fef3c7;color:#92400e;font-size:12px;padding:2px 8px;border-radius:99px;margin-bottom:16px}
dl{display:grid;grid-template-columns:auto 1fr;gap:6px 12px;font-size:14px}dt{color:#6b7280}dd{margin:0;font-weight:600}
button{width:100%;padding:12px;margin-top:10px;border:0;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
.ok{background:#16a34a;color:#fff}.bad{background:#dc2626;color:#fff}.cancel{background:#e5e7eb;color:#111}</style></head><body><main>${inner}</main></body></html>`;
}

/**
 * The mock payment gateway's hosted page. Nothing here talks to a real gateway.
 * On a choice it records the outcome, fires a webhook to the API, and posts the browser back to surl/furl.
 */
@ApiExcludeController()
@Controller('mock-gateway/payu')
export class MockPayuGatewayController {
  private readonly log = new Logger('MockPayU');

  constructor(private readonly prisma: PrismaService) {}

  @Post('_payment')
  @Public()
  async payment(@Body() f: Record<string, string>, @Res() res: Response) {
    if (f.key !== env.payu.key || requestHash(f, env.payu.salt) !== f.hash) {
      res.status(400).type('html').send(page('Invalid request', '<h1>Invalid payment request</h1><p>Hash check failed. The request was not signed with the merchant salt.</p>'));
      return;
    }
    await this.prisma.mockPayuTxn.upsert({
      where: { txnid: f.txnid },
      create: { tenantId: env.defaultTenantId, txnid: f.txnid, amount: f.amount, request: f },
      update: { request: f },
    });
    const hidden = `<input type="hidden" name="txnid" value="${esc(f.txnid)}">`;
    res.type('html').send(
      page(
        'Mock payment gateway',
        `<h1>Mock payment gateway</h1><span class="tag">Prototype — no real money moves</span>
<dl><dt>Amount</dt><dd>₹ ${esc(f.amount)}</dd><dt>For</dt><dd>${esc(f.productinfo)}</dd><dt>Payer</dt><dd>${esc(f.firstname)}</dd><dt>Txn</dt><dd>${esc(f.txnid)}</dd></dl>
<form method="post" action="complete">${hidden}<input type="hidden" name="outcome" value="success"><button class="ok">Pay (simulate success)</button></form>
<form method="post" action="complete">${hidden}<input type="hidden" name="outcome" value="failure"><button class="bad">Simulate failure</button></form>
<form method="post" action="complete">${hidden}<input type="hidden" name="outcome" value="cancel"><button class="cancel">Cancel</button></form>`,
      ),
    );
  }

  @Post('complete')
  @Public()
  async complete(@Body() body: { txnid: string; outcome: string }, @Res() res: Response) {
    const t = await this.prisma.mockPayuTxn.findUnique({ where: { txnid: body.txnid } });
    if (!t) {
      res.status(404).type('html').send(page('Not found', '<h1>Unknown transaction</h1>'));
      return;
    }
    const req = t.request as Record<string, string>;
    const status = body.outcome === 'success' ? 'success' : 'failure';
    const mihpayid = String(randomInt(100000000, 999999999));
    await this.prisma.mockPayuTxn.update({ where: { id: t.id }, data: { status: body.outcome === 'cancel' ? 'cancelled' : status, mihpayid } });
    const fields: Record<string, string> = {
      key: req.key,
      txnid: req.txnid,
      amount: req.amount,
      productinfo: req.productinfo,
      firstname: req.firstname,
      email: req.email,
      phone: req.phone ?? '',
      status,
      mihpayid,
      mode: 'MOCK',
      ...(body.outcome === 'cancel' ? { unmappedstatus: 'userCancelled' } : {}),
    };
    fields.hash = responseHash(fields, env.payu.salt);

    // Server-to-server webhook, as a real gateway would send independently of the browser.
    setTimeout(() => {
      fetch(`${env.internalApiUrl}/api/v1/payments/webhook/payu`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(fields),
      }).catch((e) => this.log.warn(`Webhook delivery failed: ${(e as Error).message}`));
    }, 300);

    const target = status === 'success' ? req.surl : req.furl;
    const inputs = Object.entries(fields).map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`).join('');
    res.type('html').send(
      page('Returning…', `<h1>Returning to the merchant…</h1><form id="f" method="post" action="${esc(target)}">${inputs}<button class="cancel">Continue</button></form><script>document.getElementById('f').submit()</script>`),
    );
  }
}
