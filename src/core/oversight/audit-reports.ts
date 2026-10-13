import type { Order } from '@prisma/client';
import type { ReportingService } from '../../utility/reporting/reporting.service';
import type { OversightService } from './oversight.service';

const day = (d?: Date | null) => (d ? new Date(d.getTime() + 5.5 * 3600_000).toISOString().replace('T', ' ').slice(0, 19) : '');
const range = (p: Record<string, string>) =>
  p.from || p.to ? { gte: p.from ? new Date(`${p.from}T00:00:00+05:30`) : undefined, lte: p.to ? new Date(`${p.to}T23:59:59+05:30`) : undefined } : undefined;
const DATES = [
  { name: 'from', label: 'From', type: 'date' as const },
  { name: 'to', label: 'To', type: 'date' as const },
];
const STEP_LABEL: Record<string, string> = {
  'oem-catalogue-check': 'OEM catalogue',
  'oem-vehicle-data': 'OEM vehicle data',
  'vahan-check': 'VAHAN',
  'state-eligibility-rules': 'State rules',
  pricing: 'Pricing',
};

/** Orders in the caller's scope matching the order-level filters (number, registration, dates). */
async function scopedOrders(o: OversightService, p: Record<string, string>, extra: Record<string, unknown> = {}) {
  const scope = await o.scope.where();
  const q = p.orderNo?.trim().toUpperCase();
  return o.orders.rawQuery({
    ...scope,
    ...extra,
    ...(q ? { OR: [{ orderNo: { contains: q } }, { regnNo: { contains: q } }] } : {}),
    ...(range(p) ? { createdAt: range(p) } : {}),
  }) as Promise<Order[]>;
}

async function userNames(o: OversightService) {
  const users = await o.identity.listUsers();
  return new Map(users.map((u) => [u.id, u.username]));
}

async function oemCodes(o: OversightService, ids: Array<string | null | undefined>) {
  const uniq = [...new Set(ids.filter(Boolean) as string[])];
  const oems = await Promise.all(uniq.map((id) => o.masters.oem(id)));
  return new Map(oems.filter(Boolean).map((x) => [x!.id, x!.code]));
}

/** Audit-style reports: every status change, every validation step, everything exchanged with OEMs, every laser code. */
export function registerAuditReports(reporting: ReportingService, o: OversightService) {
  reporting.register({
    code: 'order-history',
    name: 'Order history',
    description: 'Every status change of every order: when, from and to which status, why, and by whom.',
    params: [...DATES, { name: 'orderNo', label: 'Order or registration', type: 'text' }],
    columns: [
      { key: 'at', label: 'When (IST)' },
      { key: 'orderNo', label: 'Order no' },
      { key: 'regnNo', label: 'Registration' },
      { key: 'dealer', label: 'Dealer' },
      { key: 'from', label: 'From' },
      { key: 'to', label: 'To' },
      { key: 'trigger', label: 'Trigger' },
      { key: 'by', label: 'By' },
      { key: 'note', label: 'Note' },
    ],
    run: async (p) => {
      const orders = await scopedOrders(o, p);
      const [history, names, dealers] = await Promise.all([
        o.orders.historyFor(orders.map((x) => x.id)),
        userNames(o),
        o.masters.dealers([...new Set(orders.map((x) => x.dealerId).filter(Boolean) as string[])]),
      ]);
      const byId = new Map(orders.map((x) => [x.id, x]));
      return history.map((h) => {
        const ord = byId.get(h.orderId);
        return {
          at: day(h.createdAt),
          orderNo: ord?.orderNo,
          regnNo: ord?.regnNo,
          dealer: dealers.find((d) => d.id === ord?.dealerId)?.code ?? '',
          from: h.fromStatus ?? '',
          to: h.toStatus,
          trigger: h.trigger,
          by: h.actorId ? (names.get(h.actorId) ?? h.actorId) : 'system',
          note: h.note ?? '',
        };
      });
    },
  });

  reporting.register({
    code: 'order-validations',
    name: 'Order validation results',
    description: 'Each validation step run on each order (OEM data, VAHAN, state rules, pricing) with its result.',
    params: [...DATES, { name: 'orderNo', label: 'Order or registration', type: 'text' }, { name: 'outcome', label: 'Result', type: 'select', options: ['PASS', 'FAIL'] }],
    columns: [
      { key: 'at', label: 'When (IST)' },
      { key: 'orderNo', label: 'Order no' },
      { key: 'regnNo', label: 'Registration' },
      { key: 'channel', label: 'Channel' },
      { key: 'step', label: 'Step' },
      { key: 'outcome', label: 'Result' },
      { key: 'message', label: 'Message' },
      { key: 'status', label: 'Order status now' },
    ],
    run: async (p) => {
      const orders = await scopedOrders(o, p);
      const byId = new Map(orders.map((x) => [x.id, x]));
      const rows = await o.orders.validationsFor(orders.map((x) => x.id));
      return rows
        .filter((v) => !p.outcome || v.outcome === p.outcome)
        .map((v) => {
          const ord = byId.get(v.orderId);
          return { at: day(v.createdAt), orderNo: ord?.orderNo, regnNo: ord?.regnNo, channel: ord?.channel, step: STEP_LABEL[v.step] ?? v.step, outcome: v.outcome, message: v.message ?? '', status: ord?.status };
        });
    },
  });

  reporting.register({
    code: 'oem-history',
    name: 'OEM history',
    description: 'Everything exchanged with OEMs: vehicle data and order files, orders received, orders checked against OEM data, status callbacks.',
    params: [...DATES, { name: 'oemCode', label: 'OEM', type: 'select', options: ['KRANTI', 'ZENMO'] }],
    columns: [
      { key: 'at', label: 'When (IST)' },
      { key: 'oem', label: 'OEM' },
      { key: 'event', label: 'Event' },
      { key: 'reference', label: 'Reference' },
      { key: 'orderNo', label: 'Order no' },
      { key: 'result', label: 'Result' },
      { key: 'detail', label: 'Detail' },
    ],
    run: async (p) => {
      const r = range(p);
      const [jobs, calls, oemOrders] = await Promise.all([
        o.imports.jobs({ targetTypes: ['hsrp.oem-vehicle', 'hsrp.oem-order'], from: r?.gte, to: r?.lte }),
        o.calls.list({ system: 'OEM', from: r?.gte, to: r?.lte }),
        scopedOrders(o, { from: p.from, to: p.to }, { OR: [{ channel: { in: ['OEM_API', 'OEM_FILE'] } }, { oemId: { not: null } }] }),
      ]);
      const checks = await o.orders.validationsFor(oemOrders.map((x) => x.id), 'oem-vehicle-data');
      const byId = new Map(oemOrders.map((x) => [x.id, x]));
      const codes = await oemCodes(o, oemOrders.map((x) => x.oemId));
      const vehicleCounts = await o.oemData.countsByJob(jobs.filter((j) => j.targetType === 'hsrp.oem-vehicle').map((j) => j.id));
      const rows: Array<Record<string, unknown> & { ts: number }> = [];

      for (const j of jobs) {
        const vehicleFile = j.targetType === 'hsrp.oem-vehicle';
        rows.push({
          ts: j.createdAt.getTime(),
          at: day(j.createdAt),
          oem: j.context.oemCode ?? '',
          event: vehicleFile ? 'Vehicle data file received' : 'Order file received',
          reference: j.filename,
          orderNo: '',
          result: `${j.totalRows} rows: ${j.okRows} accepted, ${j.errorRows} refused`,
          detail: vehicleFile ? `${vehicleCounts[j.id] ?? 0} vehicles on file from this upload` : `${j.status === 'DONE' ? 'Processed' : 'Processing'} · ${j.profileName}`,
        });
      }
      for (const ord of oemOrders.filter((x) => x.channel === 'OEM_API' || x.channel === 'OEM_FILE')) {
        rows.push({
          ts: ord.createdAt.getTime(),
          at: day(ord.createdAt),
          oem: codes.get(ord.oemId ?? '') ?? '',
          event: ord.channel === 'OEM_API' ? 'Order received by API' : 'Order received in file',
          reference: ord.sourceRef ?? '',
          orderNo: ord.orderNo,
          result: ord.status,
          detail: ord.rejectionReason ?? '',
        });
      }
      for (const v of checks) {
        const ord = byId.get(v.orderId);
        rows.push({
          ts: v.createdAt.getTime(),
          at: day(v.createdAt),
          oem: codes.get(ord?.oemId ?? '') ?? '',
          event: 'Order checked against OEM vehicle data',
          reference: ord?.chassisNo ?? '',
          orderNo: ord?.orderNo,
          result: v.outcome,
          detail: v.message ?? '',
        });
      }
      for (const c of calls) {
        const req = (c.request ?? {}) as Record<string, string>;
        const ord = c.subjectId ? byId.get(c.subjectId) : undefined;
        rows.push({
          ts: c.createdAt.getTime(),
          at: day(c.createdAt),
          oem: req.oem ?? '',
          event: c.operation === 'status-callback' ? `Status sent to OEM: ${req.status}` : c.operation === 'catalogue-check' ? 'OEM catalogue check' : c.operation,
          reference: req.ref ?? req.chassisNo ?? '',
          orderNo: ord?.orderNo ?? '',
          result: c.outcome,
          detail: c.error ?? '',
        });
      }
      return rows
        .filter((x) => !p.oemCode || x.oem === p.oemCode)
        .sort((a, b) => b.ts - a.ts)
        .map(({ ts: _ts, ...rest }) => rest);
    },
  });

  reporting.register({
    code: 'plate-photo-checks',
    name: 'Plate photo checks (OCR)',
    description: 'Every OCR reading of a plate photo, after embossing and at fitment, with what was read and the result.',
    params: [...DATES, { name: 'orderNo', label: 'Order or registration', type: 'text' }, { name: 'result', label: 'Result', type: 'select', options: ['PASS', 'FAIL'] }],
    columns: [
      { key: 'at', label: 'When (IST)' },
      { key: 'stage', label: 'Stage' },
      { key: 'orderNo', label: 'Order no' },
      { key: 'expected', label: 'Ordered registration' },
      { key: 'position', label: 'Plate' },
      { key: 'laserCode', label: 'Laser code' },
      { key: 'readText', label: 'Read from the photo' },
      { key: 'result', label: 'Result' },
      { key: 'reason', label: 'Reason' },
      { key: 'engine', label: 'OCR engine' },
      { key: 'by', label: 'By' },
    ],
    run: async (p) => {
      const orders = await scopedOrders(o, p);
      const ids = orders.map((x) => x.id);
      const [emboss, fit, names] = await Promise.all([o.production.photoChecksFor(ids), o.fitment.photoChecks(ids), userNames(o)]);
      const byId = new Map(orders.map((x) => [x.id, x]));
      return [
        ...emboss.map((c) => ({ ...c, stage: 'Embossing (station)' })),
        ...fit.map((c) => ({ ...c, stage: c.fitmentId ? 'Fitment (dealer)' : 'Fitment (dealer) — refused', laserCode: '' })),
      ]
        .filter((c) => !p.result || c.result === p.result)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map((c) => ({
          at: day(c.createdAt),
          stage: c.stage,
          orderNo: byId.get(c.orderId)?.orderNo,
          expected: c.expected,
          position: c.position,
          laserCode: c.laserCode ?? '',
          readText: c.readText ?? '(nothing read)',
          result: c.result,
          reason: c.reason,
          engine: c.engine,
          by: c.actorId ? (names.get(c.actorId) ?? c.actorId) : '',
        }));
    },
  });

  reporting.register({
    code: 'laser-code-audit',
    name: 'Laser code audit',
    description: 'Every laser code issued to an order: job card, QC, challan, dealer inward, fitment and VAHAN, and why an allocation was closed.',
    params: [...DATES, { name: 'laserCode', label: 'Laser code', type: 'text' }, { name: 'orderNo', label: 'Order or registration', type: 'text' }],
    columns: [
      { key: 'laserCode', label: 'Laser code' },
      { key: 'product', label: 'Product' },
      { key: 'box', label: 'Box' },
      { key: 'plateStatus', label: 'Plate now' },
      { key: 'orderNo', label: 'Order no' },
      { key: 'regnNo', label: 'Registration' },
      { key: 'position', label: 'Position' },
      { key: 'allocatedAt', label: 'Issued (IST)' },
      { key: 'jobCardNo', label: 'Job card' },
      { key: 'ocr', label: 'Photo OCR' },
      { key: 'qc', label: 'QC' },
      { key: 'challanNo', label: 'Challan' },
      { key: 'inward', label: 'Dealer inward' },
      { key: 'fittedAt', label: 'Fitted (IST)' },
      { key: 'vahan', label: 'VAHAN' },
      { key: 'allocation', label: 'Allocation' },
      { key: 'closeReason', label: 'Closed because' },
    ],
    run: async (p) => {
      const r = range(p);
      const orders = p.orderNo ? await scopedOrders(o, { orderNo: p.orderNo }) : await scopedOrders(o, {});
      const allocations = await o.inventory.allocations({ from: r?.gte, to: r?.lte, laserCode: p.laserCode, orderIds: orders.map((x) => x.id) });
      const orderIds = [...new Set(allocations.map((a) => a.orderId))];
      const [plates, cards, qcs, lines, fitments, ocr] = await Promise.all([
        o.inventory.platesByCodes([...new Set(allocations.map((a) => a.laserCode))]),
        o.production.jobCardsByIds([...new Set(allocations.map((a) => a.jobCardId).filter(Boolean) as string[])]),
        o.production.qcRecordsFor(orderIds),
        o.dispatch.linesForAllocations(allocations.map((a) => a.id)),
        o.fitment.forOrders(orderIds),
        o.production.photoChecksFor(orderIds),
      ]);
      const challans = await o.dispatch.challansByIds([...new Set(lines.map((l) => l.challanId))]);
      const byId = new Map(orders.map((x) => [x.id, x]));
      return allocations.map((a) => {
        const plate = plates.find((x) => x.laserCode === a.laserCode);
        const line = lines.find((l) => l.allocationId === a.id);
        const fit = fitments.find((f) => f.orderId === a.orderId && (f.frontLaserCode === a.laserCode || f.rearLaserCode === a.laserCode));
        // QC records name positions, not laser codes (a PASS names none: it covers every plate of the order). The one
        // that applies is the first after this allocation was issued and before it was closed.
        const qc = qcs.find(
          (q) => q.orderId === a.orderId && (q.result === 'PASS' || q.positions.includes(a.position)) && q.createdAt >= a.createdAt && (!a.closedAt || q.createdAt <= a.closedAt),
        );
        const ord = byId.get(a.orderId);
        const photo = ocr.filter((c) => c.allocationId === a.id).at(-1);
        return {
          laserCode: a.laserCode,
          ocr: photo ? `${photo.result}${photo.readText ? ` (${photo.readText})` : ''}` : '',
          product: plate?.productCode ?? '',
          box: plate?.boxNo ?? '',
          plateStatus: plate?.status ?? '',
          orderNo: ord?.orderNo,
          regnNo: ord?.regnNo,
          position: a.position,
          allocatedAt: day(a.createdAt),
          jobCardNo: cards.find((c) => c.id === a.jobCardId)?.jobCardNo ?? '',
          qc: qc ? `${qc.result}${qc.reason ? ` (${qc.reason})` : ''}` : '',
          challanNo: line ? (challans.find((c) => c.id === line.challanId)?.challanNo ?? '') : '',
          inward: line ? `${line.inwardStatus}${line.rejectReason ? ` (${line.rejectReason})` : ''}` : '',
          fittedAt: fit ? day(fit.fittedAt) : '',
          vahan: fit?.vahanStatus ?? '',
          allocation: a.status,
          closeReason: a.closeReason ?? '',
        };
      });
    },
  });
}
