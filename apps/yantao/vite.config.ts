import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { clientBuildEnvironmentDefines } from '../../scripts/client-build-environment.ts'

const src = (rel: string): string => fileURLToPath(new URL(rel, import.meta.url))

export default defineConfig({
  // Relative asset URLs: dsh serves this dist from the site root.
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    outDir: 'dist',
    sourcemap: true,
  },
  resolve: {
    // One React copy: the shell and every plugin must share element identity.
    dedupe: ['react', 'react-dom'],
    // The vendored Cordis loader's only Node import.
    alias: [{ find: /^node:module$/, replacement: src('./src/node-module-stub.ts') }],
  },
  define: {
    // Same contract as apps/web: `process.env` must not survive into browser
    // code — an unresolved `process` would throw at boot and leave a blank
    // page. This also carries the public DSH_CLIENT_* build values.
    ...clientBuildEnvironmentDefines(process.env),
    // vendored loader internal.ts: fromInternal() probes the Node major —
    // "0.0.0" takes neither branch, returning the empty internal slot the
    // shell boot fills with the client module loader.
    'process.versions.node': '"0.0.0"',
    'process.execArgv': '[]',
    'process.env.CORDIS_SHARED': 'undefined',
  },
})
