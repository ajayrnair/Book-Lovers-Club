import { defineConfig } from 'vite';

const apiProxy = {
  '/api': {
    target: 'https://booklovers-lemon.vercel.app',
    changeOrigin: true,
  },
};

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2020',
    chunkSizeWarningLimit: 1600,
  },
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
});
