import type { VehicleCategory } from '@prisma/client';
import type { VahanLookupReply } from '../ports/vehicle-registry.port';
import { judgeOemVehicle, judgeStateRules, judgeVahanReply } from './validation-steps';

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

describe('OEM vehicle data step', () => {
  const order = { orderType: 'NEW', chassisNo: 'MA1234567890ABCDE', engineNo: 'EK12345678' };
  const record = { oemName: 'Kranti Autos', model: 'Kranti Sprint', engineNo: 'EK12345678', dealerCode: 'WB01', invoiceDate: '2026-10-01' };

  it('passes when chassis, engine and dealer match', () => {
    expect(judgeOemVehicle(order, record, { orderDealerCode: 'WB01' })).toMatchObject({ ok: true, message: expect.stringContaining('supplied to WB01') });
  });
  it('rejects a chassis that is not in the OEM data', () => {
    expect(judgeOemVehicle(order, null, { oemName: 'Kranti Autos' })).toMatchObject({ ok: false, reason: expect.stringContaining('not in Kranti Autos') });
  });
  it('rejects an engine number that does not match the chassis', () => {
    const r = judgeOemVehicle({ ...order, engineNo: 'EK99999999' }, record, { orderDealerCode: 'WB01' });
    expect(r).toMatchObject({ ok: false, reason: expect.stringContaining('does not match') });
  });
  it('rejects an order from a dealer the vehicle was not supplied to', () => {
    expect(judgeOemVehicle(order, record, { orderDealerCode: 'WB02' }).ok).toBe(false);
  });
  it('skips the dealer check when the record has no dealer', () => {
    expect(judgeOemVehicle(order, { ...record, dealerCode: null }, { orderDealerCode: 'WB02' }).ok).toBe(true);
  });
  it('does not apply to old-vehicle or replacement orders', () => {
    expect(judgeOemVehicle({ ...order, orderType: 'OLD' }, null, {}).ok).toBe(true);
    expect(judgeOemVehicle({ ...order, orderType: 'REPLACEMENT' }, null, {}).ok).toBe(true);
  });
});
