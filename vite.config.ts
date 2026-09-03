import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const API_BASE_URL = 'https://magiccoffee-api.onrender.com';

export default defineConfig({
  plugins: [react()],
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
