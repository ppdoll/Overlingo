import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Production-only CSP. API keys live in this page, so no third-party scripts may run here:
// only our own bundle, Tesseract's worker/core/language files from jsDelivr, and calls to
// Anthropic and Gemini. `ipc:` and ipc.localhost are how the desktop app talks to its native side.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' ipc: http://ipc.localhost https://api.anthropic.com https://generativelanguage.googleapis.com https://cdn.jsdelivr.net blob: data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

const page = (name: string) => resolve(import.meta.dirname, name);

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'overlingo-csp',
      apply: 'build',
      transformIndexHtml: (html) =>
        html.replace(
          '<head>',
          `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CONTENT_SECURITY_POLICY}" />`,
        ),
    },
  ],
  build: {
    rollupOptions: {
      // The app, the user guide, and the desktop app's overlay, region selector and sample chat.
      input: {
        main: page('index.html'),
        guide: page('guide.html'),
        overlay: page('overlay.html'),
        selector: page('selector.html'),
        demo: page('demo.html'),
      },
    },
  },
  // Pre-bundled up front: otherwise opening the overlay or selector window for the first time in
  // dev makes Vite re-optimize and reload every window, which resets the app.
  optimizeDeps: {
    include: [
      '@tauri-apps/api/core',
      '@tauri-apps/api/event',
      '@tauri-apps/api/window',
      '@tauri-apps/api/webviewWindow',
      '@tauri-apps/plugin-opener',
    ],
  },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
