import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    rollupOptions: {
      output: {
        // MapLibre is ~1MB of the bundle and changes far less often than the
        // app code. Splitting it lets the UI shell parse and paint while the
        // map engine is still arriving, and keeps it cached across deploys.
        manualChunks: { maplibre: ['maplibre-gl'] },
      },
    },
    chunkSizeWarningLimit: 1100,
  },
});
