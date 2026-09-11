import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const { build } = await import('vite');

const isExternal = (id) => (
  id === 'react' || id.startsWith('react/')
  || id === 'react-dom' || id.startsWith('react-dom/')
  || id === 'lucide-react' || id.startsWith('lucide-react/')
  || id === 'typescript' || id.startsWith('typescript/')
  || id === '@graphvideo/kernel' || id.startsWith('@graphvideo/kernel/')
  || id === '@graphvideo/sdk' || id.startsWith('@graphvideo/sdk/')
  || id === '@graphvideo/workbench' || id.startsWith('@graphvideo/workbench/')
  || id === '@graphvideo/backend-sdk' || id.startsWith('@graphvideo/backend-sdk/')
  || id.startsWith('node:')
);

const packages = [
  {
    dir: 'core',
    entries: { index: 'src/index.ts', 'effect-harness': 'src/effect-harness.ts' },
  },
  {
    dir: join('sdk', 'backend'),
    entries: { index: 'index.ts' },
    copy: [['plugin-manifest.d.mts', 'dist/plugin-manifest.d.mts']],
  },
  {
    dir: 'workbench',
    entries: { index: 'src/index.ts' },
  },
  {
    dir: 'sdk',
    entries: {
      index: 'index.ts',
      'client/index': 'client/index.ts',
      'tokens/index': 'tokens/index.ts',
      'ui/index': 'ui/index.ts',
      'testing/index': 'testing/index.ts',
      'contract/index': 'contract/index.ts',
      'analysis/index': 'analysis/index.ts',
    },
  },
];

for (const pkg of packages) {
  const dir = join(root, pkg.dir);
  rmSync(join(dir, 'dist'), { recursive: true, force: true });
  execFileSync(process.execPath, [tsc, '-p', join(dir, 'tsconfig.build.json')], { cwd: root, stdio: 'inherit' });
  for (const [name, entry] of Object.entries(pkg.entries)) {
    await build({
      root: dir,
      configFile: false,
      logLevel: 'warn',
      build: {
        outDir: join(dir, 'dist'),
        emptyOutDir: false,
        lib: {
          entry: join(dir, entry),
          formats: ['es'],
          fileName: () => `${name}.mjs`,
        },
        rollupOptions: { external: isExternal },
      },
    });
  }
  for (const [from, to] of pkg.copy ?? []) {
    const source = join(dir, from);
    if (existsSync(source)) {
      mkdirSync(dirname(join(dir, to)), { recursive: true });
      cpSync(source, join(dir, to));
    }
  }
  console.log(`[packages] built ${pkg.dir}`);
}
