import { copyFile, mkdir, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'cloudbase/functions/api');
const esbuild = path.join(root, 'node_modules/.bin/esbuild');

await mkdir(outputDir, { recursive: true });
await rm(path.join(outputDir, 'index.js'), { force: true });

const args = [
  path.join(root, 'cloudbase/functions/web-entry.ts'),
  '--bundle',
  '--platform=node',
  '--format=cjs',
  '--target=node20',
  '--loader:.md=text',
  `--outfile=${path.join(outputDir, 'index.js')}`,
];

await new Promise((resolve, reject) => {
  const child = spawn(esbuild, args, { cwd: root, stdio: 'inherit' });
  child.on('error', reject);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`CloudBase function build failed with exit code ${code}`)));
});

// CloudBase static hosting needs a fallback document for direct SPA routes.
const staticIndex = path.join(root, 'dist/index.html');
try {
  await copyFile(staticIndex, path.join(root, 'dist/404.html'));
} catch {
  // Keep the function bundle usable when this script is run independently.
}
