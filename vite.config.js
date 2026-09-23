import { defineConfig } from 'vite';
export default defineConfig({
  build: { target: 'es2022', sourcemap: true },
  server: { host: '0.0.0.0' },
  preview: { host: '0.0.0.0', port: 4173, strictPort: true }
});
