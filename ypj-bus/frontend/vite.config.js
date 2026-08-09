import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Vite doesn't read PORT on its own — without this it silently falls
    // back to 5173/5174 whenever that's taken, which breaks the dev-server
    // proxy when something else (autoPort, another instance) assigns a
    // different port via PORT.
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    proxy: {
      '/api': 'http://localhost:3001',
    },
  },
});
