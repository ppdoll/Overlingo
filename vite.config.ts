import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// Production-only CSP. API keys live in this page, so no third-party scripts may run here:
// only our own bundle, Tesseract's worker/core/language files from jsDelivr, and calls to Anthropic.
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net blob:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://api.anthropic.com https://cdn.jsdelivr.net blob: data:",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "style-src 'self' 'unsafe-inline'",
  "object-src 'none'",
  "base-uri 'self'",
].join('; ');

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
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
