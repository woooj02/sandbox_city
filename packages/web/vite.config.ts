import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { buildIdentity, buildLabel } from './build-identity';
const build = buildIdentity(resolve(import.meta.dirname, '../..'));
export default defineConfig({
  define: { __BUILD__: JSON.stringify(buildLabel(build)) },
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
