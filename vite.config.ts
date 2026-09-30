import { defineConfig } from 'vite';

export default defineConfig({
  worker: { format: 'es' },
  server: { host: '127.0.0.1', port: 5173 },
  build: {
    rolldownOptions: {
      output: { codeSplitting: { groups: [{ name: 'map-engine', test: /node_modules/ }] } },
    },
  },
});
