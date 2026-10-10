/** Subject types the core uses when it hands work to generic utilities. */
export const SUBJECT = {
  order: 'hsrp.order',
  dealer: 'hsrp.dealer',
  station: 'hsrp.station',
  oem: 'hsrp.oem',
  fitment: 'hsrp.fitment',
  rejection: 'hsrp.rejection',
  challan: 'hsrp.challan',
  jobCard: 'hsrp.job-card',
  walletGroup: 'hsrp.wallet-group',
} as const;

export const APPROVAL = {
  replacementOrder: 'replacement-order',
  plateRejection: 'plate-rejection',
  dealerOnboarding: 'dealer-onboarding',
} as const;

/** Formats a Date as dd-mm-yyyy in IST (VAHAN's fixation date format). */
export function istDmy(d: Date) {
  const ist = new Date(d.getTime() + 5.5 * 3600_000);
  return `${String(ist.getUTCDate()).padStart(2, '0')}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}-${ist.getUTCFullYear()}`;
}

/** YYYY-MM-DD of a Date in IST. */
export function istDate(d: Date = new Date()) {
  return new Date(d.getTime() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

/** Parses dd-mm-yyyy or yyyy-mm-dd into a UTC date. */
export function parseDate(s: string): Date | null {
  let m = s.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return null;
}
