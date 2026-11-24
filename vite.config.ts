import fs from 'node:fs';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

/**
 * GitHub Pages serves 404.html for unknown paths. Copying index.html there
 * keeps hash-route deep links working without a server-side rewrite rule.
 */
function copyIndexTo404(): Plugin {
  let outDir = 'dist';
  return {
    name: 'copy-index-to-404',
    apply: 'build',
    configResolved(config) {
      outDir = config.build.outDir;
    },
    writeBundle() {
      const index = path.resolve(outDir, 'index.html');
      if (fs.existsSync(index)) {
        fs.copyFileSync(index, path.resolve(outDir, '404.html'));
      }
    },
  };
}

export default defineConfig({
  root: '.',
  publicDir: 'public',
  // Project-scope Pages URLs need a sub-path base; a custom domain keeps '/'.
  // Example: VITE_BASE=/cpns/ npm run build
  base: process.env.VITE_BASE || '/',
  build: {
    outDir: 'dist',
    // Source maps are development-only: they are the largest files in dist/
    // and are not useful to end users of the offline PWA.
    sourcemap: false,
    minify: 'esbuild',
    target: 'es2022',
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-db': ['dexie'],
          'vendor-utils': ['date-fns', 'mitt', 'zod'],
          'vendor-editor': ['easymde'],
          'vendor-search': ['fuse.js'],
          'vendor-virtual': ['@tanstack/virtual-core'],
        },
      },
    },
  },
  optimizeDeps: {
    include: ['easymde'],
    esbuildOptions: {
      target: 'es2022',
    },
  },
  plugins: [
    copyIndexTo404(),
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,png,svg,woff2}'],
        navigateFallback: '/offline.html',
        navigateFallbackDenylist: [/^\/sw\.js$/],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
    }),
  ],
  server: {
    port: 5173,
    https: false,
  },
  resolve: {
    alias: {
      '@': '/src',
      '@shared': '/src/shared',
      '@features': '/src/features',
      '@core': '/src/core',
      '@db': '/src/db',
      'easymde': path.resolve(__dirname, 'node_modules/easymde/dist/easymde.min.js'),
    },
  },
});