import type { Ctx, Step } from '../core/types';

/** TC-01: the OEM vehicle data file goes through the import on screen. */
export const sendOemFile: Step = {
  who: 'admin',
  say: "Kranti's vehicle data file for this run is sent to the import (as if the OEM uploaded it)",
  async run(c) {
    const w = await c.web.as('admin');
    await w.nav('Simulator');
    await w.clickButton('Send Kranti file to the import');
    await w.waitText(/is being processed/);
    c.run.oemFileUploaded = true;
  },
};

export const showImportResult: Step = {
  who: 'admin',
  say: 'OEM files & uploads: good rows are on file; the two bad rows are refused with a reason (error report)',
  async run(c) {
    const jobs = await c.api.get('/imports?pageSize=5');
    const job = jobs.items.find((j: any) => j.profileCode === 'OEM_KRANTI_VEHICLES');
    const done = await c.api.waitFor('vehicle data import', () => c.api.get(`/imports/${job.id}`), (j: any) => j.job.status === 'DONE');
    const expectOk = Object.values(c.run.vehicles).filter((v) => v.inOemFile).length;
    if (done.job.errorRows !== 2 || done.job.okRows !== expectOk) throw new Error(`Import: ${done.job.okRows} accepted (expected ${expectOk}), ${done.job.errorRows} refused (expected 2)`);
    const w = await c.web.as('admin');
    await w.nav('OEM files & uploads');
    await w.click(w.row(job.filename).first());
    const m = w.modal();
    await w.show(m.locator('tbody tr', { hasText: 'error' }).first(), c.pace.read * 2);
    await w.click(m.locator('.modal-head button').first());
  },
};

export function showVehicleOnFile(caseVehicle: string): Step {
  return {
    who: 'admin',
    say: 'OEM vehicle data on file: the vehicle the next case orders is listed with its engine, model and dealer',
    async run(c) {
      const v = c.run.vehicles[caseVehicle];
      const w = await c.web.as('admin');
      const card = w.page.locator('.card', { hasText: 'OEM vehicle data on file' });
      await w.type(w.field('Chassis, engine or model', card), v.chassisNo);
      await card.locator('tbody tr', { hasText: v.chassisNo }).waitFor({ timeout: 10_000 });
      await w.show(card.locator('tbody tr', { hasText: v.chassisNo }).first(), c.pace.read * 1.5);
    },
  };
}

/**
 * Admin bulk upload of OEM data with the standard template (D47): choose the OEM and the data type, attach the filled
 * template (the case's vehicles plus one row for a dealer the OEM does not supply), load, check the result.
 */
export function bulkUploadVehicleData(oemCode: 'ZENMO' | 'KRANTI', vehicles: string[]): Step {
  return {
    who: 'admin',
    say: `Admin bulk-uploads ${oemCode === 'ZENMO' ? 'Zenmo' : 'Kranti'} vehicle data with the standard template; good rows load, a row for a dealer the OEM does not supply is refused`,
    async run(c: Ctx) {
      const rows = vehicles.map((n) => c.vehicle(n));
      const csv = [
        'Chassis No,Engine No,Model,Category,Dealer Code,Invoice No,Invoice Date',
        ...rows.map((v, i) => `${v.chassisNo},${v.engineNo},${v.model},${v.vchCatg},WB01,${c.case.id}-INV-${i + 1},01-10-2026`),
        `MZBADDEALER${Date.now().toString().slice(-6)},EZBAD00001,${rows[0].model},LMV,WB03,${c.case.id}-INV-BAD,01-10-2026`,
      ].join('\n');
      const w = await c.web.as('admin');
      await w.nav('OEM files & uploads');
      const card = w.page.locator('.card', { hasText: 'Bulk upload OEM data' });
      await w.pointAt(card);
      await w.select(w.field('OEM', card), oemCode === 'ZENMO' ? 'Zenmo' : 'Kranti');
      await w.select(w.field('Data', card), 'OEM_VEHICLES_STANDARD');
      await w.show(w.button('Download template', card), c.pace.read / 2);
      const input = w.field('Filled template (CSV)', card);
      await w.pointAt(input);
      await input.setInputFiles({ name: `${oemCode.toLowerCase()}-vehicle-data.csv`, mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await w.clickButton('Upload and load', card);
      const jobs = await c.api.waitFor('bulk upload job', () => c.api.get('/imports?pageSize=3'), (j: any) => j.items[0]?.profileCode === 'OEM_VEHICLES_STANDARD');
      const done = await c.api.waitFor('rows loaded', () => c.api.get(`/imports/${jobs.items[0].id}`), (j: any) => j.job.status === 'DONE');
      if (done.job.okRows !== rows.length || done.job.errorRows !== 1) throw new Error(`Bulk upload: ${done.job.okRows} loaded (expected ${rows.length}), ${done.job.errorRows} refused (expected 1)`);
      const m = w.modal();
      await m.locator('tbody tr').first().waitFor({ timeout: 15_000 });
      await c.say(`${done.job.okRows} vehicles loaded for ${oemCode}; 1 row refused: dealer WB03 is not mapped to this OEM`);
      await w.show(m.locator('table'), c.pace.read * 2);
      await w.click(m.locator('.modal-head button').first());
      const list = w.page.locator('.card', { hasText: 'OEM vehicle data on file' });
      await w.type(w.field('Chassis, engine or model', list), rows[0].chassisNo);
      await list.locator('tbody tr', { hasText: rows[0].chassisNo }).waitFor({ timeout: 10_000 });
      await w.show(list.locator('tbody tr', { hasText: rows[0].chassisNo }).first(), c.pace.read * 1.5);
    },
  };
}
