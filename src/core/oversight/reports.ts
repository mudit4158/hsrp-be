import type { ReportingService } from '../../utility/reporting/reporting.service';
import type { OversightService } from './oversight.service';

const rupees = (p?: number | null) => (p == null ? '' : (p / 100).toFixed(2));
const day = (d?: Date | null) => (d ? new Date(d.getTime() + 5.5 * 3600_000).toISOString().replace('T', ' ').slice(0, 16) : '');
const range = (p: Record<string, string>) =>
  p.from || p.to ? { gte: p.from ? new Date(`${p.from}T00:00:00+05:30`) : undefined, lte: p.to ? new Date(`${p.to}T23:59:59+05:30`) : undefined } : undefined;
const DATES = [
  { name: 'from', label: 'From', type: 'date' as const },
  { name: 'to', label: 'To', type: 'date' as const },
];

/** HSRP reports, registered with the generic Reporting utility. Each reads through the owning module's service. */
export function registerReports(reporting: ReportingService, o: OversightService) {
  reporting.register({
    code: 'orders-register',
    name: 'Orders register',
    description: 'Every order with channel, status, dealer and amount.',
    params: [...DATES, { name: 'status', label: 'Status', type: 'text' }, { name: 'stateCode', label: 'State', type: 'select', options: ['WB', 'OD'] }],
    columns: [
      { key: 'orderNo', label: 'Order no' },
      { key: 'createdAt', label: 'Received (IST)' },
      { key: 'channel', label: 'Channel' },
      { key: 'orderType', label: 'Type' },
      { key: 'status', label: 'Status' },
      { key: 'stateCode', label: 'State' },
      { key: 'dealer', label: 'Dealer' },
      { key: 'regnNo', label: 'Registration' },
      { key: 'vehicleClass', label: 'Class' },
      { key: 'amount', label: 'Amount (₹)' },
    ],
    run: async (p) => {
      const scope = await o.scope.where();
      const rows = await o.orders.rawQuery({ ...scope, ...(p.status ? { status: { in: p.status.split(',') } } : {}), ...(p.stateCode ? { stateCode: p.stateCode } : {}), ...(range(p) ? { createdAt: range(p) } : {}) });
      const dealers = await o.masters.dealers([...new Set(rows.map((r) => r.dealerId).filter(Boolean) as string[])]);
      return rows.map((r) => ({ ...r, createdAt: day(r.createdAt), dealer: dealers.find((d) => d.id === r.dealerId)?.code ?? '', amount: rupees(r.amountPaise) }));
    },
  });

  reporting.register({
    code: 'fitments',
    name: 'Fitments and VAHAN posts',
    description: 'Fitments recorded by dealers and the state of their VAHAN post.',
    params: DATES,
    columns: [
      { key: 'fittedAt', label: 'Fitted (IST)' },
      { key: 'orderNo', label: 'Order no' },
      { key: 'regnNo', label: 'Registration' },
      { key: 'dealer', label: 'Dealer' },
      { key: 'frontLaserCode', label: 'Front' },
      { key: 'rearLaserCode', label: 'Rear' },
      { key: 'vahanStatus', label: 'VAHAN' },
      { key: 'postedAt', label: 'Posted (IST)' },
      { key: 'vahanReply', label: 'VAHAN reply' },
    ],
    run: async (p) => {
      const scope = await o.scope.current();
      const r = range(p);
      const rows = await o.fitment.list({ dealerId: scope.dealerId, from: r?.gte, to: r?.lte });
      const orders = await o.orders.byIds(rows.map((x) => x.orderId));
      const dealers = await o.masters.dealers([...new Set(rows.map((x) => x.dealerId))]);
      return rows.map((x) => ({
        ...x,
        fittedAt: day(x.fittedAt),
        postedAt: day(x.postedAt),
        orderNo: orders.find((y) => y.id === x.orderId)?.orderNo,
        regnNo: orders.find((y) => y.id === x.orderId)?.regnNo,
        dealer: dealers.find((d) => d.id === x.dealerId)?.code,
      }));
    },
  });

  reporting.register({
    code: 'challans',
    name: 'Delivery challans',
    description: 'Challans by dealer with plate count and inward state.',
    params: [{ name: 'status', label: 'Status', type: 'select', options: ['CREATED', 'INWARDED', 'CANCELLED'] }],
    columns: [
      { key: 'challanNo', label: 'Challan no' },
      { key: 'createdAt', label: 'Created (IST)' },
      { key: 'dealerName', label: 'Dealer' },
      { key: 'plates', label: 'Plates' },
      { key: 'status', label: 'Status' },
      { key: 'inwardedAt', label: 'Inwarded (IST)' },
    ],
    run: async (p) => (await o.dispatch.list({ status: p.status })).map((c) => ({ ...c, createdAt: day(c.createdAt), inwardedAt: day(c.inwardedAt) })),
  });

  reporting.register({
    code: 'stock',
    name: 'Plate stock by station',
    description: 'Plates per station and product by status.',
    params: [],
    columns: [
      { key: 'station', label: 'Station' },
      { key: 'productCode', label: 'Product' },
      { key: 'AVAILABLE', label: 'Available' },
      { key: 'ALLOCATED', label: 'Allocated' },
      { key: 'FITTED', label: 'Fitted' },
      { key: 'SCRAPPED', label: 'Scrapped' },
    ],
    run: async () => (await o.inventory.stockByStation()).flatMap((s) => s.products.map((p) => ({ station: s.stationCode, ...p }))),
  });

  reporting.register({
    code: 'complaints',
    name: 'Complaints and ageing',
    description: 'Complaints against their 15-day limit.',
    params: [{ name: 'status', label: 'Status', type: 'select', options: ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED'] }],
    columns: [
      { key: 'ticketNo', label: 'Ticket' },
      { key: 'categoryCode', label: 'Category' },
      { key: 'title', label: 'Title' },
      { key: 'createdAt', label: 'Raised (IST)' },
      { key: 'dueAt', label: 'Due (IST)' },
      { key: 'status', label: 'Status' },
      { key: 'ageDays', label: 'Age (days)' },
      { key: 'overdue', label: 'Overdue' },
    ],
    run: async (p) => (await o.tickets.list({ status: p.status, page: 1, pageSize: 5000 })).items.map((t) => ({ ...t, createdAt: day(t.createdAt), dueAt: day(t.dueAt), overdue: t.overdue ? 'yes' : 'no' })),
  });

  reporting.register({
    code: 'wallets',
    name: 'Wallet balances',
    description: 'Balance, held amount, credit limit and available funds per wallet.',
    params: [],
    columns: [
      { key: 'name', label: 'Wallet' },
      { key: 'balance', label: 'Balance (₹)' },
      { key: 'held', label: 'Held (₹)' },
      { key: 'credit', label: 'Credit limit (₹)' },
      { key: 'available', label: 'Available (₹)' },
    ],
    run: async () =>
      (await o.wallets.list()).map((w) => ({ name: w.name, balance: rupees(w.balancePaise), held: rupees(w.heldPaise), credit: rupees(w.creditLimitPaise), available: rupees(w.availablePaise) })),
  });

  reporting.register({
    code: 'rejections',
    name: 'Plate rejections',
    description: 'QC and dealer rejections with the station decision.',
    params: [{ name: 'status', label: 'Status', type: 'select', options: ['PENDING', 'APPROVED', 'DISAPPROVED'] }],
    columns: [
      { key: 'createdAt', label: 'Raised (IST)' },
      { key: 'orderNo', label: 'Order no' },
      { key: 'source', label: 'Source' },
      { key: 'positions', label: 'Plates' },
      { key: 'reason', label: 'Reason' },
      { key: 'status', label: 'Decision' },
      { key: 'remarks', label: 'Remarks' },
    ],
    run: async (p) => {
      const rows = await o.rejections.list(p.status ? { status: p.status } : {});
      const orders = await o.orders.byIds(rows.map((r) => r.orderId));
      return rows.map((r) => ({ ...r, createdAt: day(r.createdAt), orderNo: orders.find((x) => x.id === r.orderId)?.orderNo, positions: r.positions.join(' + ') }));
    },
  });
}
