/** Deterministic generator for the mock VAHAN table. Every record is fictional. */

export function rng(seed: number) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(arr: readonly T[]) => arr[Math.floor(next() * arr.length)],
    weighted: <T>(items: Array<[T, number]>) => {
      const total = items.reduce((s, [, w]) => s + w, 0);
      let r = next() * total;
      for (const [v, w] of items) {
        if ((r -= w) <= 0) return v;
      }
      return items[items.length - 1][0];
    },
  };
}

export type Pool =
  | 'seed-new'
  | 'seed-old'
  | 'seed-repl'
  | 'demo-new'
  | 'oem-zenmo-sample'
  | 'oem-kranti-sample'
  | 'demo-old'
  | 'demo-has-plates'
  | 'garbled-post'
  | 'bad-category';

export interface SeedVehicle {
  regnNo: string;
  chassisNo: string;
  engineNo: string;
  stateCd: string;
  offCd: string;
  maker: string;
  fuel: string;
  vchType: string;
  vchCatg: string;
  norms: string;
  regnDate: string;
  hsrpFrontLaserCode: string | null;
  hsrpRearLaserCode: string | null;
  scenario: Pool;
}

const POOLS: Array<[Pool, number]> = [
  ['seed-new', 72],
  ['seed-old', 22],
  ['seed-repl', 8],
  ['demo-new', 26],
  ['oem-zenmo-sample', 12],
  ['oem-kranti-sample', 20],
  ['demo-old', 12],
  ['demo-has-plates', 8],
  ['garbled-post', 2],
  ['bad-category', 1],
];

/** Pools of vehicles registered after the new-vehicle cut-off. */
export const NEW_POOLS: readonly Pool[] = ['seed-new', 'demo-new', 'oem-zenmo-sample', 'oem-kranti-sample', 'garbled-post', 'bad-category'];

export const ALNUM = 'ABCDEFGHJKLMNPRSTUVWXYZ0123456789';
const OTHER_MAKERS = ['DEMO MOTORS (FICTIONAL)', 'SAMPLE CYCLES (FICTIONAL)', 'TEST TRUCKS (FICTIONAL)'];

export function generateVehicles(): SeedVehicle[] {
  const r = rng(20261010);
  const out: SeedVehicle[] = [];
  const used = new Set<string>();
  const str = (n: number) => Array.from({ length: n }, () => r.pick(ALNUM.split(''))).join('');
  const dmy = (y: number, m: number, d: number) => `${String(d).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}`;

  for (const state of ['WB', 'OD']) {
    for (const [pool, count] of POOLS) {
      for (let i = 0; i < count; i++) {
        const isNew = NEW_POOLS.includes(pool);
        const office = r.int(1, 30);
        let regnNo: string;
        do regnNo = `${state}${String(office).padStart(2, '0')}${r.pick(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K'])}${r.pick(['A', 'B', 'C', 'D', 'E', 'M', 'N', 'P', 'R', 'S'])}${String(r.int(1, 9999)).padStart(4, '0')}`;
        while (used.has(regnNo));
        used.add(regnNo);
        let vchCatg = r.weighted<string>([['2WN', 45], ['LMV', 30], ['3WT', 9], ['LPV', 6], ['HGV', 7], ['TRL', 3]]);
        if (pool === 'bad-category') vchCatg = 'XYZ';
        if (pool === 'oem-zenmo-sample' || pool === 'oem-kranti-sample') vchCatg = r.pick(['2WN', 'LMV', 'LMV']);
        const maker =
          pool === 'oem-zenmo-sample'
            ? 'ZENMO MOTORS (FICTIONAL)'
            : pool === 'oem-kranti-sample'
              ? 'KRANTI AUTOS (FICTIONAL)'
              : r.weighted<string>([['ZENMO MOTORS (FICTIONAL)', 35], ['KRANTI AUTOS (FICTIONAL)', 35], [r.pick(OTHER_MAKERS), 30]]);
        const fuel = vchCatg === '2WN' ? r.weighted<string>([['PETROL', 80], ['ELECTRIC', 20]]) : r.weighted<string>([['PETROL', 45], ['DIESEL', 30], ['CNG', 15], ['ELECTRIC', 10]]);
        const regnDate = isNew ? dmy(r.int(2020, 2026), r.int(1, 9), r.int(1, 28)) : dmy(r.int(2006, 2018), r.int(1, 12), r.int(1, 28));
        const norms = isNew ? (r.next() < 0.9 ? 'BHARAT STAGE VI' : 'BHARAT STAGE IV') : r.pick(['BHARAT STAGE IV', 'BHARAT STAGE III', 'BHARAT STAGE II']);
        const hasPlates = pool === 'seed-repl' || pool === 'demo-has-plates';
        out.push({
          regnNo,
          chassisNo: `M${r.pick(['A', 'B', 'C', 'D'])}${str(10)}${String(r.int(10000, 99999))}`,
          engineNo: `${r.pick(['E', 'K', 'G'])}${str(4)}${String(r.int(10000, 99999))}`,
          stateCd: state,
          offCd: `${state}${String(office).padStart(2, '0')}`,
          maker,
          fuel,
          vchType: ['LPV', '3WT', 'HGV', 'TRL', '2WT'].includes(vchCatg) ? 'TRANSPORT' : 'NON TRANSPORT',
          vchCatg,
          norms,
          regnDate,
          hsrpFrontLaserCode: hasPlates ? `ZZ${String(r.int(1_000_000_000, 9_999_999_999))}` : null,
          hsrpRearLaserCode: hasPlates ? `ZZ${String(r.int(1_000_000_000, 9_999_999_999))}` : null,
          scenario: pool,
        });
      }
    }
  }
  return out;
}
