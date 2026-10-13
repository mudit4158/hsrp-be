/** Billing rules (D46). Pure and unit-tested; dates are cut in India Standard Time. */

export type PaymentMode = 'PREPAID' | 'POSTPAID';
export type BillingCycle = 'WEEKLY' | 'MONTHLY';
export type BillTo = 'OEM' | 'DEALER';

export const PAYMENT_MODES: PaymentMode[] = ['PREPAID', 'POSTPAID'];
export const BILLING_CYCLES: BillingCycle[] = ['WEEKLY', 'MONTHLY'];
export const BILL_TO: BillTo[] = ['OEM', 'DEALER'];

const IST_MS = 5.5 * 3600_000;
const DAY = 86_400_000;

/** Midnight IST of the IST calendar day containing `d`, as a UTC instant. */
function istMidnight(d: Date) {
  const ist = new Date(d.getTime() + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - IST_MS);
}

/** The most recent cycle boundary at or before `now`: Monday 00:00 IST (weekly) or the 1st 00:00 IST (monthly). */
export function cycleBoundary(cycle: BillingCycle, now: Date): Date {
  const midnight = istMidnight(now);
  const ist = new Date(midnight.getTime() + IST_MS);
  if (cycle === 'WEEKLY') {
    const sinceMonday = (ist.getUTCDay() + 6) % 7; // Monday = 0
    return new Date(midnight.getTime() - sinceMonday * DAY);
  }
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), 1) - IST_MS);
}

/** The boundary one cycle before `boundary`. */
export function previousBoundary(cycle: BillingCycle, boundary: Date): Date {
  if (cycle === 'WEEKLY') return new Date(boundary.getTime() - 7 * DAY);
  const ist = new Date(boundary.getTime() + IST_MS);
  return new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1) - IST_MS);
}

/** "06 Oct 2026 – 12 Oct 2026" (the end is the last day billed, i.e. the day before `to`). */
export function periodLabel(from: Date, to: Date) {
  const fmt = (d: Date) => new Date(d.getTime() + IST_MS).toISOString().slice(0, 10).split('-').reverse().join('-');
  return `${fmt(from)} to ${fmt(new Date(to.getTime() - 1))}`;
}

/** Charges go to the bill-to party set for the OEM × dealer pair, else the OEM's default, else the OEM. */
export function resolveBillTo(pairSetting: string | undefined, oemDefault: string | undefined, hasDealer: boolean): BillTo {
  const pick = (v?: string) => (v === 'OEM' || v === 'DEALER' ? v : undefined);
  const chosen = pick(pairSetting) ?? pick(oemDefault) ?? 'OEM';
  return chosen === 'DEALER' && !hasDealer ? 'OEM' : chosen;
}

/** Scope id of an OEM × dealer setting. */
export const pairScope = (oemCode: string, dealerCode: string) => ({ type: 'oem-dealer', id: `${oemCode}:${dealerCode}` });
