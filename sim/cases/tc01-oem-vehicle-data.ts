import { sendOemFile, showImportResult, showVehicleOnFile } from '../scenes/oem';
import type { TestCase } from '../core/types';

export const tc01: TestCase = {
  id: 'TC-01',
  title: 'OEM vehicle data file',
  kind: 'happy',
  goal: "Kranti's vehicle data file is imported: good rows are kept, bad rows go to the error report.",
  expected: ['One accepted row per vehicle in the file', '2 refused rows: no chassis; a dealer that does not sell Kranti', 'The vehicles are listed under "OEM vehicle data on file"'],
  steps: [sendOemFile, showImportResult, showVehicleOnFile('TC-02.car')],
};
