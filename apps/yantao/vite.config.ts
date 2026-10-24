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
    // 2026-10-24：不清空 dist。宿主按请求从磁盘读这份 dist（frontend-static），
    // 运行中的工作台随时可能因为一次刷新/热替换重新取资源——默认的「先清空再
    // 写」会在这几秒里让 index 与 assets 双双 404，表现为白屏。保留旧哈希资产
    // 让构建期间任意时刻读到的都是一份自洽的快照；代价是历史资产会累积。
    emptyOutDir: false,
    sourcemap: true,
    // Declare the HTML shell explicitly: the third-party-notices gate
    // (scripts/browser-bundled-externals.ts) resolves each browser app's
    // entries from rollupOptions.input and requires an .html page there.
    rollupOptions: {
      input: {
        index: src('./index.html'),
      },
    },
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
