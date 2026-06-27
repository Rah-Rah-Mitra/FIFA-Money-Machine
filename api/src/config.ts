import { config as loadEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// Load the repo-root .env regardless of cwd (config.ts lives at api/src/).
const here = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(here, '..', '..', '.env') });

export const config = {
  port: Number(process.env.PORT ?? 3000),
  locale: process.env.LOCALE ?? 'en',
  cacheTtlMs: Number(process.env.CACHE_TTL_MS ?? 600_000),
  rateLimitWindowMs: Number(process.env.RATE_LIMIT_WINDOW_MS ?? 60_000),
  rateLimitMax: Number(process.env.RATE_LIMIT_MAX ?? 120),
  fifaBase: 'https://cxm-api.fifa.com/fifaplusweb/api',
  supabaseUrl: process.env.SUPABASE_URL ?? '',
  // service-role key preferred (bypasses RLS); falls back to anon for read-only setups.
  supabaseKey: process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY || '',
};
