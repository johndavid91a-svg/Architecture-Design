import { resolve } from 'node:path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@adp/core'] })],
    build: {
      lib: { entry: resolve(__dirname, 'src/main/index.ts') },
      rollupOptions: {
        /**
         * Parser engines stay out of the bundle.
         *
         * `@adp/core` is deliberately bundled, and Rollup follows the dynamic
         * imports inside it — including `pdfjs-dist/legacy/build/pdf.mjs`. The
         * bundled copy keeps pdf.js's own relative import of
         * `./pdf.worker.mjs`, a file Rollup never emits, so the packaged app
         * died on the first PDF with "Setting up fake worker failed: Cannot
         * find module .../out/main/pdf.worker.mjs". Left external, the import
         * resolves from node_modules at runtime, where the worker sits beside
         * its own entry point exactly as its author intended.
         *
         * `web-ifc` and `dxf-parser` are listed for the same reason. web-ifc
         * already worked — it is a direct dependency of this package, so the
         * externalize plugin caught it — but it works by luck of where it is
         * declared rather than by intent, and these three are the engines whose
         * files must stay together.
         */
        external: ['pdfjs-dist', /^pdfjs-dist\//, 'web-ifc', /^web-ifc\//, 'dxf-parser'],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: resolve(__dirname, 'src/preload/index.ts') },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
      },
    },
    build: {
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/renderer/index.html') },
      },
    },
  },
});
