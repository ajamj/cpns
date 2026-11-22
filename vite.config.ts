import { defineConfig } from 'vite';
import path from 'path';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  root: '.',
  publicDir: 'public',
  build: {
    outDir: 'dist',
    sourcemap: true,
    minify: 'esbuild',
    target: 'es2022',
    modulePreload: { polyfill: false },
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-db': ['dexie'],
          'vendor-charts': ['chart.js'],
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
    VitePWA({
      registerType: 'autoUpdate',
      injectRegister: null,
      manifest: false,
      workbox: {
        globPatterns: ['**/*.{js,css,html,json,png,svg,woff2}'],
        navigateFallback: '/index.html',
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