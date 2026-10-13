import { MockPlateReader, PLATE_MARKER } from '../../adapters/ocr/plate-reader.adapters';
import { formatPlate, judgePlate, normalizePlate } from './plate-ocr';

const reading = (text: string | null) => ({ text, confidence: 90, engine: 'test' });

describe('plate OCR rule', () => {
  it('normalises and formats registration numbers', () => {
    expect(normalizePlate('wb 02 kf-5437')).toBe('WB02KF5437');
    expect(formatPlate('WB02KF5437')).toBe('WB 02 KF 5437');
    expect(formatPlate('OD5A123')).toBe('OD 5 A 123');
  });
  it('passes when the photo reads the ordered registration number', () => {
    expect(judgePlate('WB02KF5437', reading('WB 02 KF 5437'))).toMatchObject({ result: 'PASS', read: 'WB02KF5437' });
  });
  it('passes when the number is read with extra marks around it (IND strip, borders)', () => {
    expect(judgePlate('WB02KF5437', reading('8 IND WB 02 KF 5437 |'))).toMatchObject({ result: 'PASS' });
  });
  it('fails when the photo reads another number', () => {
    const r = judgePlate('WB02KF5437', reading('WB 02 KF 5438'));
    expect(r).toMatchObject({ result: 'FAIL', read: 'WB02KF5438' });
    expect(r.reason).toContain('the order is for WB 02 KF 5437');
  });
  it('fails when nothing can be read', () => {
    expect(judgePlate('WB02KF5437', reading(null))).toMatchObject({ result: 'FAIL', read: null });
    expect(judgePlate('WB02KF5437', reading('  '))).toMatchObject({ result: 'FAIL' });
  });
});

describe('mock plate reader', () => {
  const mock = new MockPlateReader();
  it('reads the plate text a test image embeds', async () => {
    const img = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.from(`${PLATE_MARKER}WB 02 KF 5437`)]);
    await expect(mock.read(img)).resolves.toMatchObject({ text: 'WB 02 KF 5437', engine: 'mock' });
  });
  it('reads nothing from a photo without the marker', async () => {
    await expect(mock.read(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).resolves.toMatchObject({ text: null });
  });
});
