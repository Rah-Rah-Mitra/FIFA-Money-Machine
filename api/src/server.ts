import express, { type NextFunction, type Request, type Response } from 'express';
import pinoHttp from 'pino-http';
import rateLimit from 'express-rate-limit';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { ZodError } from 'zod';
import { config } from './config';
import { apiRouter } from './routes';
import { UpstreamError } from './fifa';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..');

const DOCS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>FIFA Highlights API</title>
<meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body><script id="api-reference" data-url="/openapi.yaml"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script></body></html>`;

export function createApp() {
  const app = express();
  // ponytail: no `trust proxy` — rate-limit keys on the socket IP (correct for direct serving) and
  // geo reads cf-ipcountry/x-country headers directly. Behind a real proxy, set `trust proxy` to the
  // proxy hop count via your deploy config so X-Forwarded-For can't be spoofed.
  // Quiet the high-frequency poll endpoints so the log doesn't loop on /analysis & /jobs polling.
  app.use(pinoHttp({
    autoLogging: {
      ignore: (req) => {
        const u = req.url ?? '';
        return u === '/health' || u.startsWith('/jobs') || /\/analysis(\/|\?|$)/.test(u);
      },
    },
  }));
  app.use(express.json({ limit: '64kb' }));
  app.use(rateLimit({
    windowMs: config.rateLimitWindowMs,
    max: config.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
  }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.get('/openapi.yaml', (_req, res) => {
    res.type('text/yaml').send(readFileSync(resolve(repoRoot, 'openapi.yaml'), 'utf8'));
  });
  app.get('/docs', (_req, res) => res.type('html').send(DOCS_HTML));

  app.use(apiRouter());
  app.use(express.static(resolve(repoRoot, 'public')));

  // Central error handler.
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'validation', details: err.issues });
    if (err instanceof UpstreamError) return res.status(err.status === 404 ? 404 : 502).json({ error: err.message });
    if (/Supabase not configured/.test(err?.message ?? '')) return res.status(503).json({ error: err.message });
    return res.status(500).json({ error: err?.message ?? 'internal error' });
  });

  return app;
}

// Start only when run directly (not when imported by tests).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createApp().listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`FIFA highlights API → http://localhost:${config.port}  (docs: /docs)`);
  });
}
