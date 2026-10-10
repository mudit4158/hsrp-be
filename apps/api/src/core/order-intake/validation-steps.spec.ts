import type { VehicleCategory } from '@prisma/client';
import type { VahanLookupReply } from '../ports/vehicle-registry.port';
import { judgeStateRules, judgeVahanReply } from './validation-steps';

const cutoff = new Date('2019-04-01');
const reply = (o: Partial<VahanLookupReply> = {}): VahanLookupReply => ({
  message: 'Success', fuel: 'PETROL', maker: 'DEMO', vchType: 'NON TRANSPORT', norms: 'BHARAT STAGE VI', vchCatg: 'LMV', regnDate: '15-06-2024',
  hsrpFrontLaserCode: '', hsrpRearLaserCode: '', stateCd: 'WB', offCd: 'WB02', ...o,
});
const cat = { vehicleClass: 'LMV' } as VehicleCategory;

describe('VAHAN validation step', () => {
  it('accepts a new vehicle registered after the cut-off', () => {
    expect(judgeVahanReply({ orderType: 'NEW', stateCode: 'WB' }, reply(), cutoff, cat).ok).toBe(true);
  });
  it('rejects a lookup miss with VAHAN’s message', () => {
    const r = judgeVahanReply({ orderType: 'NEW', stateCode: 'WB' }, reply({ message: 'Vehicle details not found' }), cutoff, cat);
    expect(r).toMatchObject({ ok: false, reason: 'VAHAN: Vehicle details not found' });
  });
  it('allows only a replacement when plates already exist', () => {
    const withPlates = reply({ hsrpFrontLaserCode: 'AB1234567890' });
    expect(judgeVahanReply({ orderType: 'NEW', stateCode: 'WB' }, withPlates, cutoff, cat).ok).toBe(false);
    expect(judgeVahanReply({ orderType: 'REPLACEMENT', stateCode: 'WB' }, withPlates, cutoff, cat).ok).toBe(true);
    expect(judgeVahanReply({ orderType: 'REPLACEMENT', stateCode: 'WB' }, reply(), cutoff, cat).ok).toBe(false);
  });
  it('applies the configurable new-vehicle cut-off', () => {
    expect(judgeVahanReply({ orderType: 'NEW', stateCode: 'WB' }, reply({ regnDate: '31-03-2019' }), cutoff, cat).ok).toBe(false);
    expect(judgeVahanReply({ orderType: 'NEW', stateCode: 'WB' }, reply({ regnDate: '01-04-2019' }), cutoff, cat).ok).toBe(true);
    expect(judgeVahanReply({ orderType: 'OLD', stateCode: 'WB' }, reply({ regnDate: '01-04-2019' }), cutoff, cat).ok).toBe(false);
  });
  it('rejects a vehicle registered in another state', () => {
    expect(judgeVahanReply({ orderType: 'NEW', stateCode: 'OD' }, reply(), cutoff, cat).ok).toBe(false);
  });
  it('rejects an unknown vehicle category', () => {
    expect(judgeVahanReply({ orderType: 'NEW', stateCode: 'WB' }, reply(), cutoff, null).ok).toBe(false);
  });
});

describe('state eligibility rules', () => {
  const odisha = { requireMobile: true, allowedVehicleClasses: ['2W', 'LMV'], rtoPrefixes: ['OD'] };
  it('passes with the base (empty) rule pack', () => {
    expect(judgeStateRules({ mobile: null }, {}, {}).ok).toBe(true);
  });
  it('enforces the Odisha demo pack', () => {
    expect(judgeStateRules({ mobile: null }, odisha, { vehicleClass: 'LMV', offCd: 'OD02' }).ok).toBe(false);
    expect(judgeStateRules({ mobile: '9000000001' }, odisha, { vehicleClass: 'HMV', offCd: 'OD02' }).ok).toBe(false);
    expect(judgeStateRules({ mobile: '9000000001' }, odisha, { vehicleClass: 'LMV', offCd: 'WB02' }).ok).toBe(false);
    expect(judgeStateRules({ mobile: '9000000001' }, odisha, { vehicleClass: 'LMV', offCd: 'OD02' }).ok).toBe(true);
  });
});
