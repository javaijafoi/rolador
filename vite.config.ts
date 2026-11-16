import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Identificador da versão: hash do commit no Vercel, ou data/hora em build local.
const BUILD_ID = (process.env.VERCEL_GIT_COMMIT_SHA ?? '').slice(0, 7) || Date.now().toString(36);

export default defineConfig({
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [
    react(),
    {
      // Publica /version.json para o app descobrir que existe versão nova.
      name: 'version-json',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ id: BUILD_ID, builtAt: new Date().toISOString() }) });
      },
    },
  ],
});
