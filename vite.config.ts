import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const API_BASE_URL = 'https://magiccoffee-api.onrender.com';

export default defineConfig({
  plugins: [react({ jsxImportSource: '@magiccoffee/i18n-runtime' })],
  resolve: {
    alias: {
      '@magiccoffee/i18n-runtime': path.resolve(__dirname, 'src/i18n/runtime'),
    },
  },
  optimizeDeps: {
    exclude: [
      '@magiccoffee/i18n-runtime',
      '@magiccoffee/i18n-runtime/jsx-runtime',
      '@magiccoffee/i18n-runtime/jsx-dev-runtime',
    ],
  },
  server: {
    port: 5370,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/api': API_BASE_URL,
      '/health': API_BASE_URL,
      '/uploads': API_BASE_URL,
    },
  },
});
