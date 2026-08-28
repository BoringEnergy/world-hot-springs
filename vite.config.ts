import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Vite does not read PORT on its own. Honouring it lets a supervisor
    // assign a free port instead of colliding with whatever already holds
    // the default. Nothing here is bound to a fixed port -- no OAuth
    // callback, no webhook, no CORS allowlist -- so any port will do.
    port: Number(process.env.PORT) || 5177,
  },
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
