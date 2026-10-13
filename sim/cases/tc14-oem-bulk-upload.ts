import { bulkUploadVehicleData } from '../scenes/oem';
import type { TestCase } from '../core/types';

export const tc14: TestCase = {
  id: 'TC-14',
  title: 'Bulk upload of OEM data from the admin portal',
  kind: 'happy',
  goal: 'Any OEM — here the API-integrated Zenmo — can also send data as a bulk file in the standard template, uploaded by an admin.',
  expected: ['Template available for download', 'Vehicles loaded for the chosen OEM; a row for a dealer the OEM does not supply is refused', 'The vehicles are listed under "OEM vehicle data on file"'],
  vehicles: [
    { name: 'car', category: 'LMV', oem: 'ZENMO', title: 'Zenmo car in the bulk file' },
    { name: 'bike', category: '2WN', oem: 'ZENMO', title: 'Zenmo two-wheeler in the bulk file' },
  ],
  steps: [bulkUploadVehicleData('ZENMO', ['car', 'bike'])],
};
