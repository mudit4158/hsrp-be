/**
 * Architecture rules (handover section 4). `pnpm lint:deps` fails the build when any is broken.
 */
module.exports = {
  forbidden: [
    {
      name: 'utility-must-not-import-core',
      comment: 'Utilities are generic and reusable: they must never know about HSRP core modules.',
      severity: 'error',
      from: { path: '^src/utility' },
      to: { path: '^src/core' },
    },
    {
      name: 'utility-must-not-import-adapters',
      comment: 'Utilities depend on ports they define; adapters are bound at the composition root.',
      severity: 'error',
      from: { path: '^src/utility' },
      to: { path: '^src/adapters' },
    },
    {
      name: 'core-must-not-import-adapters',
      comment: 'Core depends on port interfaces only (ports and adapters).',
      severity: 'error',
      from: { path: '^src/core' },
      to: { path: '^src/adapters' },
    },
    {
      name: 'adapters-must-not-import-core-services',
      comment: 'Adapters may implement core ports but must not reach into core module internals.',
      severity: 'error',
      from: { path: '^src/adapters' },
      to: { path: '^src/core/(?!ports)' },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '\\.spec\\.ts$' },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.json' },
  },
};
