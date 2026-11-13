import { defineConfig } from 'vite';
// hydra-synth was written for bundlers that provide Node's `global`
export default defineConfig({
  server: { port: 5174, host: '127.0.0.1' },
  define: { global: 'globalThis' },
  optimizeDeps: { esbuildOptions: { define: { global: 'globalThis' } }, rolldownOptions: { transform: { define: { global: 'globalThis' } } } },
  build: { target: 'es2022' },
});
