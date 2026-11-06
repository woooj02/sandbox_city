import { defineConfig } from 'vite';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
const root = resolve(import.meta.dirname, '../..');
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim().length > 0;
const hash = createHash('sha256');
const files = execFileSync('git', ['ls-files', '-co', '--exclude-standard', '--', 'packages', 'scripts', 'package.json', 'package-lock.json'], { cwd: root, encoding: 'utf8' }).trim().split('\n').sort();
for (const file of files) hash.update(file).update(readFileSync(resolve(root, file)));
const sourceHash = hash.digest('hex');
const build = { revision, dirty, sourceHash, builtAt: new Date().toISOString() };
export default defineConfig({
  define: { __BUILD__: JSON.stringify(`${revision.slice(0, 7)}${dirty ? ' + local changes' : ''} · source ${sourceHash.slice(0, 12)}`) },
  plugins: [react(), { name: 'build-identity', generateBundle() { this.emitFile({ type: 'asset', fileName: 'build.json', source: JSON.stringify(build) }); } }],
  worker: { format: 'es' },
  build: {
    rolldownOptions: {
      output: {
        // the big libraries in their own chunks: they download in parallel and stay cached across app changes
        codeSplitting: {
          groups: [
            { name: 'ag-grid', test: /node_modules[\\/]ag-grid/, priority: 3 },
            { name: 'pixi', test: /node_modules[\\/](pixi|@pixi)/, priority: 2 },
            { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/, priority: 1 },
          ],
        },
      },
    },
  },
  server: { host: true, port: 5173, proxy: { '/api': 'http://localhost:8787', '/ws': { target: 'ws://localhost:8787', ws: true } } },
});
