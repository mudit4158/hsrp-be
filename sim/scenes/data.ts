import { CONFIG } from '../core/config';
import type { Ctx, PreparedVehicle, RunState, Step, TestCase } from '../core/types';
import type { Api } from '../core/api';

/**
 * Data preparation, run once at the start of every simulation run: registers fresh fictional vehicles in mock
 * VAHAN for every vehicle the selected cases declare (`vehicles` on each case), so the run never depends on
 * leftovers from an earlier run. Role names are "<case id>.<vehicle name>".
 */
export async function prepareData(api: Api, cases: TestCase[], run: RunState) {
  const specs = cases.flatMap((c) =>
    (c.vehicles ?? []).map((v) => ({
      role: `${c.id}.${v.name}`,
      title: `${c.id} · ${v.title}`,
      expected: c.title,
      category: v.category,
      inOemFile: v.inOemFile ?? true,
      engineMismatch: v.engineMismatch ?? false,
      oem: v.oem ?? 'KRANTI',
    })),
  );
  if (!specs.length) return;
  const sheet = await api.post('/simulator/new-vehicle-demo', { vehicles: specs });
  for (const v of sheet.vehicles as PreparedVehicle[]) run.vehicles[v.role] = v;
}

/** Shows the prepared data on the Simulator page so the viewer sees which vehicle each case uses. */
export const showPreparedData: Step = {
  who: 'admin',
  say: 'Fresh vehicles for this run are registered in mock VAHAN; the table shows which case uses which vehicle',
  async run(c: Ctx) {
    const w = await c.web.as('admin');
    await w.nav('Simulator');
    await w.waitText('New-vehicle demo batch');
    await w.show(w.page.locator('.card', { hasText: 'New-vehicle demo batch' }).locator('table'), c.pace.read * 2);
  },
};

/** Sends the run's OEM vehicle data file through the import without showing it (when TC-01 is not selected). */
export async function uploadOemFileQuietly(api: Api, run: RunState) {
  const job = await api.post('/simulator/new-vehicle-demo/upload');
  await api.waitFor('OEM vehicle data import', () => api.get(`/imports/${job.id}`), (j: any) => j.job.status === 'DONE');
  run.oemFileUploaded = true;
}

export const OEM_NAME = CONFIG.oemName;
