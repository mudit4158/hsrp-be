import { Body, Controller, Get, Post, Put, Query, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { VahanModeRequest } from '@hsrp/contracts';
import type { Response } from 'express';
import { createZodDto } from 'nestjs-zod';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { env } from '../../platform/config/env';
import { requestContext } from '../../platform/context/request-context';
import { PrismaService } from '../../platform/database/prisma.service';
import { RequirePermission } from '../../platform/http/decorators';
import { Problem } from '../../platform/http/problem';
import { signBody } from '../../utility/identity/api-client.service';
import { toCsv } from '../../utility/import-export/csv';
import { ImportService } from '../../utility/import-export/import.service';
import { MockStateService } from '../mock-state.service';

class VahanModeDto extends createZodDto(VahanModeRequest) {}
class OemPushDto extends createZodDto(z.object({ oemCode: z.string().optional(), repeatLast: z.boolean().default(false) })) {}

/** Fixtures written by the seed: what the "OEM side" of the simulation knows. */
interface OemDemo {
  oemCode: string;
  apiKey?: string;
  secret?: string;
  dealerCodes: string[];
  sampleRegnNos: string[];
  csvProfileCode?: string;
}

/** Admin-only controls for the mocked outside world. */
@ApiTags('simulator')
@Controller('simulator')
export class SimulatorController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly state: MockStateService,
    private readonly imports: ImportService,
  ) {}

  @Get('state')
  @RequirePermission('simulator.use')
  async getState() {
    const demos = await this.state.get<OemDemo[]>('oem.demo', []);
    return {
      vahanMode: await this.state.get('vahan.mode', 'normal'),
      demoMode: env.demoMode,
      oems: demos.map((d) => ({ oemCode: d.oemCode, api: Boolean(d.apiKey), csvProfileCode: d.csvProfileCode, dealers: d.dealerCodes })),
    };
  }

  @Put('vahan-mode')
  @RequirePermission('simulator.use')
  async setVahanMode(@Body() body: VahanModeDto) {
    await this.state.set('vahan.mode', body.mode);
    return { vahanMode: body.mode };
  }

  @Get('messages')
  @RequirePermission('simulator.use')
  messages(@Query('to') to?: string, @Query('channel') channel?: string) {
    return this.prisma.mockOutboundMessage.findMany({
      where: { ...(to ? { to: { contains: to } } : {}), ...(channel ? { channel } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Get('payments')
  @RequirePermission('simulator.use')
  payments() {
    return this.prisma.mockPayuTxn.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @Get('oem-callbacks')
  @RequirePermission('simulator.use')
  callbacks() {
    return this.prisma.mockOemCallback.findMany({ orderBy: { createdAt: 'desc' }, take: 100 });
  }

  @Get('vahan-vehicles')
  @RequirePermission('simulator.use')
  vehicles(@Query('scenario') scenario?: string, @Query('q') q?: string, @Query('state') state?: string) {
    return this.prisma.mockVahanVehicle.findMany({
      where: {
        ...(scenario ? { scenario } : {}),
        ...(state ? { stateCd: state } : {}),
        ...(q ? { regnNo: { contains: q.toUpperCase() } } : {}),
      },
      orderBy: { regnNo: 'asc' },
      take: 300,
    });
  }

  /** Pushes a sample order to our own OEM endpoint exactly as an OEM system would (API key, signature, idempotency key). */
  @Post('oem-order')
  @RequirePermission('simulator.use')
  async pushOemOrder(@Body() body: OemPushDto) {
    const demos = await this.state.get<OemDemo[]>('oem.demo', []);
    const demo = demos.find((d) => d.apiKey && (!body.oemCode || d.oemCode === body.oemCode));
    if (!demo?.apiKey || !demo.secret) throw Problem.badRequest('No API-integrated demo OEM is configured');

    let last = await this.state.get<{ payload: unknown; idempotencyKey: string } | null>('oem.lastPush', null);
    if (!body.repeatLast || !last) {
      const cursor = await this.state.get<number>(`oem.cursor.${demo.oemCode}`, 0);
      if (cursor >= demo.sampleRegnNos.length) throw Problem.conflict('All sample vehicles for this OEM have been used. Reseed to start over.');
      const v = await this.prisma.mockVahanVehicle.findUnique({ where: { regnNo: demo.sampleRegnNos[cursor] } });
      if (!v) throw Problem.notFound('Sample vehicle');
      await this.state.set(`oem.cursor.${demo.oemCode}`, cursor + 1);
      last = {
        idempotencyKey: randomUUID(),
        payload: {
          oemOrderRef: `${demo.oemCode}-PO-${Date.now().toString().slice(-8)}`,
          dealerCode: demo.dealerCodes[cursor % demo.dealerCodes.length],
          regnNo: v.regnNo,
          chassisNo: v.chassisNo,
          engineNo: v.engineNo,
          ownerName: 'Test Owner (fictional)',
          mobile: `90000${String(10000 + cursor).slice(-5)}`,
        },
      };
      await this.state.set('oem.lastPush', last);
    }
    const raw = JSON.stringify(last.payload);
    const res = await fetch(`${env.internalApiUrl}/api/v1/oem/${demo.oemCode}/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': demo.apiKey,
        'x-signature': signBody(demo.secret, raw),
        'idempotency-key': last.idempotencyKey,
      },
      body: raw,
    });
    return {
      request: { url: `/api/v1/oem/${demo.oemCode}/orders`, idempotencyKey: last.idempotencyKey, body: last.payload },
      response: { status: res.status, replayed: res.headers.get('idempotent-replayed') === 'true', body: await res.json().catch(() => null) },
    };
  }

  @Get('oem-csv')
  @RequirePermission('simulator.use')
  async sampleCsv(@Res() res: Response, @Query('oemCode') oemCode?: string) {
    const { csv } = await this.buildCsv(oemCode);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="sample-oem-orders.csv"');
    res.send(csv);
  }

  @Post('oem-csv')
  @RequirePermission('simulator.use')
  async uploadSampleCsv(@Body() body: { oemCode?: string }) {
    const { csv, demo } = await this.buildCsv(body?.oemCode);
    return this.imports.start({ profileCode: demo.csvProfileCode!, filename: `sample-${demo.oemCode}-${Date.now()}.csv`, data: Buffer.from(csv) });
  }

  /** Sample file in the CSV OEM's own column layout: good rows plus deliberately bad ones. */
  private async buildCsv(oemCode?: string) {
    const demos = await this.state.get<OemDemo[]>('oem.demo', []);
    const demo = demos.find((d) => d.csvProfileCode && (!oemCode || d.oemCode === oemCode));
    if (!demo) throw Problem.badRequest('No CSV-integrated demo OEM is configured');
    const cursor = await this.state.get<number>(`oem.cursor.${demo.oemCode}`, 0);
    const picks = demo.sampleRegnNos.slice(cursor, cursor + 4);
    if (picks.length < 2) throw Problem.conflict('Not enough unused sample vehicles left. Reseed to start over.');
    await this.state.set(`oem.cursor.${demo.oemCode}`, cursor + picks.length);
    const vehicles = await this.prisma.mockVahanVehicle.findMany({ where: { regnNo: { in: picks } } });
    const stamp = Date.now().toString().slice(-6);
    const rows: Record<string, string>[] = vehicles.map((v, i) => ({
      'Dealer Code': demo.dealerCodes[i % demo.dealerCodes.length],
      'Invoice No': `INV-${stamp}-${i + 1}`,
      'Registration No': v.regnNo,
      'Chassis No': v.chassisNo,
      'Engine No': v.engineNo,
      'Customer Name': `Sample Buyer ${i + 1}`,
      Mobile: `91111${String(10000 + i).slice(-5)}`,
    }));
    rows.push({ 'Dealer Code': demo.dealerCodes[0], 'Invoice No': `INV-${stamp}-X1`, 'Registration No': 'BAD REG', 'Chassis No': '', 'Engine No': 'ENG00000', 'Customer Name': 'Missing chassis', Mobile: '9999999999' });
    rows.push({ 'Dealer Code': 'NO-SUCH-DEALER', 'Invoice No': `INV-${stamp}-X2`, 'Registration No': 'OD02ZZ9999', 'Chassis No': 'MCHXXXXXXXXX99999', 'Engine No': 'ENGXX99999', 'Customer Name': 'Unknown dealer', Mobile: '9888888888' });
    rows.push({ 'Dealer Code': demo.dealerCodes[0], 'Invoice No': `INV-${stamp}-X3`, 'Registration No': 'OD05QQ0001', 'Chassis No': 'MCHNOTINVAHAN0001', 'Engine No': 'ENGNOVAHAN01', 'Customer Name': 'Not in VAHAN', Mobile: '9777777777' });
    return { csv: toCsv(rows), demo, tenantId: requestContext.tenantId() };
  }
}
