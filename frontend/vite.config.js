import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Blockly is the bulk of the app and changes only when we upgrade
        // it — its own chunk keeps user caches warm across our deploys.
        manualChunks: {
          blockly: ['blockly', '@blockly/toolbox-search'],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.js'],
  },
});
