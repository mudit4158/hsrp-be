import { parseFitmentReply } from './fitment/vahan-reply';
import { bestRule, chargeApplies } from './pricing/price-match';
import { istDmy, parseDate } from './shared/subjects';

describe('VAHAN fitment reply parsing', () => {
  it('recognises success', () => {
    expect(parseFitmentReply('HSRP details updated successfully for WB02AB1234')).toBe('SUCCESS');
  });
  it('recognises known failures', () => {
    expect(parseFitmentReply('Vehicle WB02AB1234 not found')).toBe('FAILED');
    expect(parseFitmentReply('Invalid fixation date format')).toBe('FAILED');
  });
  it('treats anything else as unknown (retry, then manual queue)', () => {
    expect(parseFitmentReply('ERR#5503 <html>Gateway Timeout</html>')).toBe('UNKNOWN');
    expect(parseFitmentReply('')).toBe('UNKNOWN');
  });
});

describe('pricing', () => {
  const base = { stateCode: 'WB', vehicleClass: 'LMV', orderType: 'NEW', plateSet: 'BOTH', vehicleType: null, oemCode: null, effectiveFrom: new Date('2024-01-01'), effectiveTo: null };
  const q = { stateCode: 'WB', vehicleClass: 'LMV', vehicleType: 'NON_TRANSPORT', oemCode: 'ZENMO', orderType: 'NEW', plateSet: 'BOTH', at: new Date('2026-10-01') };
  it('prefers the OEM-specific rule', () => {
    const rules = [{ ...base, id: 'generic' }, { ...base, id: 'oem', oemCode: 'ZENMO' }];
    expect(bestRule(rules, q)?.id).toBe('oem');
  });
  it('honours effective dates', () => {
    const rules = [
      { ...base, id: 'old', effectiveTo: new Date('2025-01-01') },
      { ...base, id: 'new', effectiveFrom: new Date('2025-01-01') },
    ];
    expect(bestRule(rules, q)?.id).toBe('new');
    expect(bestRule(rules, { ...q, at: new Date('2024-06-01') })?.id).toBe('old');
  });
  it('matches extra charges by condition', () => {
    expect(chargeApplies({ greenStrip: true }, { greenStrip: true })).toBe(true);
    expect(chargeApplies({ channel: ['CUSTOMER_PORTAL'] }, { channel: 'DEALER_APP' })).toBe(false);
  });
});

describe('dates', () => {
  it('formats the VAHAN fixation date as dd-mm-yyyy in IST', () => {
    expect(istDmy(new Date('2026-10-10T20:00:00Z'))).toBe('11-10-2026');
  });
  it('parses VAHAN and ISO dates', () => {
    expect(parseDate('05-07-2021')?.toISOString().slice(0, 10)).toBe('2021-07-05');
    expect(parseDate('2021-07-05')?.toISOString().slice(0, 10)).toBe('2021-07-05');
    expect(parseDate('July 5')).toBeNull();
  });
});
