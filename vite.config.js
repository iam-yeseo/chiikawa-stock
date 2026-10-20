import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  plugins: [{name:'local-app-csp',apply:'build',transformIndexHtml(){return [{tag:'meta',attrs:{'http-equiv':'Content-Security-Policy',content:"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"},injectTo:'head-prepend'}];}}],
  build: {
    target: 'es2022',
    rollupOptions: { input: { settings: resolve('index.html'), pet: resolve('pet.html') } }
  },
  server: { host: '127.0.0.1', port: 5173, strictPort: true }
});
