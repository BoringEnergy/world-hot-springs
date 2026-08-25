import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // The dataset is the bulk of the payload; keep it out of the JS chunk so the
    // shell paints before the springs land.
    chunkSizeWarningLimit: 1200,
  },
});
