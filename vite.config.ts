import { defineConfig } from 'vite';

export default defineConfig({
  base: '/site/',
  server: {
    host: true,
    port: 5173
  }
});
