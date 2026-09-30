import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { cloudflare } from '@cloudflare/vite-plugin';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const isCloudflareBuild = mode === 'cloudflare';
  return {
      plugins: [react(), ...(isCloudflareBuild ? [cloudflare()] : [])],
    // GitHub Pages is served from the custom-domain root in production.
    // Keep an override available for a repository-subpath preview.
    base: mode === 'pages' ? (env.VITE_PAGES_BASE || '/') : '/',
    server: {
      port: Number(env.VITE_PORT || '5174'),
      proxy: {
        '/api': `http://127.0.0.1:${env.PORT || '8787'}`,
      },
    },
  };
});
