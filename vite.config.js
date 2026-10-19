import { defineConfig } from 'vite';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Builds sw.js from src/sw.js with the final (hashed) file list, so the
// offline cache is versioned automatically on every build.
function serviceWorker() {
  return {
    name: 'releve-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle).filter(f => !f.endsWith('.map'));
      const assets = ['./', ...files, 'manifest.webmanifest',
        'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
      const version = createHash('sha256').update(files.sort().join('|')).digest('hex').slice(0, 10);
      const source = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
        .replace('__VERSION__', `releve-${version}`)
        .replace('__ASSETS__', JSON.stringify(assets));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}

export default defineConfig({
  plugins: [serviceWorker()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: {
    // `npm run dev` runs the Pages Functions (with local KV) on 8788
    proxy: { '/api': 'http://localhost:8788' },
  },
});
