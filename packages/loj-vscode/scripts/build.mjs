import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { build } from 'esbuild';

const packageRoot = resolve(import.meta.dirname, '..');
const outFile = resolve(packageRoot, 'dist', 'extension.cjs');

rmSync(resolve(packageRoot, 'dist'), { recursive: true, force: true });
mkdirSync(dirname(outFile), { recursive: true });

await build({
  entryPoints: [resolve(packageRoot, 'src', 'extension.ts')],
  outfile: outFile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  sourcemap: true,
  packages: 'bundle',
  external: ['vscode'],
  banner: {
    js: 'const __import_meta_url = require("node:url").pathToFileURL(__filename).href;',
  },
  define: {
    'import.meta.url': '__import_meta_url',
  },
  logLevel: 'info',
});
