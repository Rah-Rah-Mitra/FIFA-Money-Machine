import { Router, type Request } from 'express';
import { z } from 'zod';
import { config } from './config';
import { cached } from './cache';
import * as fifa from './fifa';
import { buildCatalog } from './catalog';
import { ingestEvent, getAnalytics } from './events';
import { PIPELINES, PIPELINE_IDS, enqueueJob, listJobs, getJob, listRecentJobs } from './jobs';

export const VIDEO_ID = /^[A-Za-z0-9]{10,30}$/;

const eventSchema = z.object({
  type: z.enum(['play', 'pause', 'seek', 'complete', 'heartbeat']),
  positionSeconds: z.number().nonnegative().default(0),
  durationSeconds: z.number().positive().optional(),
  sessionId: z.string().min(1).max(128),
  timestamp: z.union([z.number(), z.string()]).optional(),
});

const analyzeSchema = z.object({
  pipeline: z.string(),
  config: z.record(z.any()).optional(),
});

const localeOf = (req: Request) => (typeof req.query.locale === 'string' ? req.query.locale : config.locale);

export function apiRouter(): Router {
  const r = Router();

  // Validate :id once for every route that uses it.
  r.param('id', (_req, res, next, id) => {
    if (!VIDEO_ID.test(id)) return res.status(400).json({ error: 'invalid videoId' });
    next();
  });

  r.get('/catalog', async (req, res, next) => {
    try {
      const locale = localeOf(req);
      const data = await cached(`catalog:${locale}`, config.cacheTtlMs, () => buildCatalog(locale));
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  r.get('/videos/:id', async (req, res, next) => {
    try {
      const locale = localeOf(req);
      const data = await cached(`details:${locale}:${req.params.id}`, config.cacheTtlMs, () =>
        fifa.getDetails(req.params.id, locale),
      );
      res.json(data);
    } catch (e) {
      next(e);
    }
  });

  r.get('/videos/:id/playback', async (req, res, next) => {
    try {
      const pb = await fifa.getPlayback(req.params.id, localeOf(req));
      // Geo: surface always; enforce only when a country header is present.
      const country = (req.headers['cf-ipcountry'] ?? req.headers['x-country']) as string | undefined;
      const blocked = String(pb.preplay.disallowedCountryCodes || '')
        .split(',')
        .map((s: string) => s.trim().toUpperCase())
        .filter(Boolean);
      if (country && blocked.includes(country.toUpperCase())) {
        return res.status(451).json({ error: 'geo-restricted', disallowedCountryCodes: pb.preplay.disallowedCountryCodes });
      }
      res.set('Cache-Control', 'no-store'); // short-lived signed credential
      res.json(pb);
    } catch (e) {
      next(e);
    }
  });

  r.post('/videos/:id/events', async (req, res, next) => {
    try {
      const body = eventSchema.parse(req.body);
      await ingestEvent(req.params.id, body);
      res.status(202).json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.get('/videos/:id/analytics', async (req, res, next) => {
    try {
      res.json(await getAnalytics(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  r.get('/pipelines', (_req, res) => res.json(PIPELINES));

  // Recent jobs across all videos (optionally ?status=queued|running|done|error).
  r.get('/jobs', async (req, res, next) => {
    try {
      const status = typeof req.query.status === 'string' ? req.query.status : undefined;
      const limit = Math.min(200, Number(req.query.limit) || 50);
      res.json(await listRecentJobs(limit, status));
    } catch (e) {
      next(e);
    }
  });

  r.post('/videos/:id/analyze', async (req, res, next) => {
    try {
      const body = analyzeSchema.parse(req.body);
      if (!PIPELINE_IDS.has(body.pipeline)) {
        return res.status(400).json({ error: `unknown pipeline; valid: ${[...PIPELINE_IDS].join(', ')}` });
      }
      const jobId = await enqueueJob(req.params.id, body.pipeline, body.config);
      res.status(202).json({ jobId });
    } catch (e) {
      next(e);
    }
  });

  r.get('/videos/:id/analysis', async (req, res, next) => {
    try {
      res.json(await listJobs(req.params.id));
    } catch (e) {
      next(e);
    }
  });

  r.get('/videos/:id/analysis/:jobId', async (req, res, next) => {
    try {
      const job = await getJob(req.params.id, req.params.jobId);
      if (!job) return res.status(404).json({ error: 'job not found' });
      res.json(job);
    } catch (e) {
      next(e);
    }
  });

  return r;
}
