import type { PlateReading } from '../ports/plate-reader.port';

export type PlateOcrResult = { result: 'PASS' | 'FAIL'; read: string | null; reason: string };

/** Letters and digits only, upper case: "WB 02 KF-5437" → "WB02KF5437". */
export const normalizePlate = (s: string | null | undefined) => (s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** "WB02KF5437" → "WB 02 KF 5437", the way the plate prints it. */
export function formatPlate(regnNo: string) {
  const m = /^([A-Z]{2})(\d{1,2})([A-Z]{0,3})(\d{1,4})$/.exec(normalizePlate(regnNo));
  return m ? [m[1], m[2], m[3], m[4]].filter(Boolean).join(' ') : regnNo;
}

/**
 * The OCR rule (D45). Pure, unit-tested. The check passes only when the text read from the photo contains the ordered
 * registration number exactly (spaces and punctuation ignored); anything else, including nothing read, fails.
 */
export function judgePlate(expectedRegnNo: string, reading: PlateReading): PlateOcrResult {
  const expected = normalizePlate(expectedRegnNo);
  const read = normalizePlate(reading.text);
  if (!read) return { result: 'FAIL', read: null, reason: 'No registration number could be read from the photo' };
  if (read.includes(expected)) return { result: 'PASS', read, reason: `Read ${formatPlate(expected)}` };
  return { result: 'FAIL', read, reason: `Photo reads "${reading.text?.trim().replace(/\s+/g, ' ')}", the order is for ${formatPlate(expected)}` };
}
