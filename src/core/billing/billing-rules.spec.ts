import { cycleBoundary, periodLabel, previousBoundary, resolveBillTo } from './billing-rules';

const ist = (s: string) => new Date(`${s}+05:30`);

describe('billing cycles (IST)', () => {
  it('weekly cycles close on Monday 00:00 IST', () => {
    // Wednesday 14 Oct 2026 → Monday 12 Oct 2026
    expect(cycleBoundary('WEEKLY', ist('2026-10-14T10:00:00'))).toEqual(ist('2026-10-12T00:00:00'));
    // Monday just after midnight IST counts as the new week
    expect(cycleBoundary('WEEKLY', ist('2026-10-12T00:05:00'))).toEqual(ist('2026-10-12T00:00:00'));
    // Sunday late evening IST is still the previous week (it is already Monday in no timezone that matters here)
    expect(cycleBoundary('WEEKLY', ist('2026-10-11T23:50:00'))).toEqual(ist('2026-10-05T00:00:00'));
    expect(previousBoundary('WEEKLY', ist('2026-10-12T00:00:00'))).toEqual(ist('2026-10-05T00:00:00'));
  });
  it('monthly cycles close on the 1st 00:00 IST', () => {
    expect(cycleBoundary('MONTHLY', ist('2026-10-14T10:00:00'))).toEqual(ist('2026-10-01T00:00:00'));
    expect(previousBoundary('MONTHLY', ist('2026-10-01T00:00:00'))).toEqual(ist('2026-09-01T00:00:00'));
    expect(previousBoundary('MONTHLY', ist('2026-01-01T00:00:00'))).toEqual(ist('2025-12-01T00:00:00'));
  });
  it('labels a period with its last billed day', () => {
    expect(periodLabel(ist('2026-09-01T00:00:00'), ist('2026-10-01T00:00:00'))).toBe('01-09-2026 to 30-09-2026');
  });
});

describe('bill-to', () => {
  it('uses the OEM × dealer setting, then the OEM default, then the OEM', () => {
    expect(resolveBillTo('DEALER', 'OEM', true)).toBe('DEALER');
    expect(resolveBillTo(undefined, 'DEALER', true)).toBe('DEALER');
    expect(resolveBillTo(undefined, undefined, true)).toBe('OEM');
  });
  it('bills the OEM when the order has no dealer', () => {
    expect(resolveBillTo('DEALER', undefined, false)).toBe('OEM');
  });
});
