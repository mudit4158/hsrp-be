import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

/** Proves the architecture check fails the build when a utility imports a core module (rule 1). */
describe('dependency rules', () => {
  const apiRoot = path.resolve(__dirname, '../..');
  const bin = path.join(apiRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'depcruise.cmd' : 'depcruise');

  function cruise(files: Record<string, string>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hsrp-deps-'));
    for (const [rel, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), content);
    }
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { module: 'commonjs' } }));
    fs.copyFileSync(path.join(apiRoot, '.dependency-cruiser.cjs'), path.join(dir, '.dependency-cruiser.cjs'));
    const res = spawnSync(bin, ['src', '--config', '.dependency-cruiser.cjs'], { cwd: dir, encoding: 'utf8', shell: process.platform === 'win32' });
    fs.rmSync(dir, { recursive: true, force: true });
    return res;
  }

  it('fails when a utility imports core', () => {
    const res = cruise({
      'src/core/orders/order.ts': 'export const order = 1;\n',
      'src/utility/wallet/wallet.ts': "import { order } from '../../core/orders/order';\nexport const w = order;\n",
    });
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toMatch(/utility-must-not-import-core/);
  });

  it('fails when core imports an adapter', () => {
    const res = cruise({
      'src/adapters/vahan/mock.ts': 'export const mock = 1;\n',
      'src/core/orders/order.ts': "import { mock } from '../../adapters/vahan/mock';\nexport const o = mock;\n",
    });
    expect(res.status).not.toBe(0);
    expect(res.stdout + res.stderr).toMatch(/core-must-not-import-adapters/);
  });

  it('passes when core imports a utility', () => {
    const res = cruise({
      'src/utility/wallet/wallet.ts': 'export const w = 1;\n',
      'src/core/orders/order.ts': "import { w } from '../../utility/wallet/wallet';\nexport const o = w;\n",
    });
    expect(res.status).toBe(0);
  });
});
