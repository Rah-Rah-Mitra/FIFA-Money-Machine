import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { requireSupabase } from './supabase';

// Single source of truth shared with the Python worker (repo-root pipelines.json).
const here = dirname(fileURLToPath(import.meta.url));
export type Pipeline = { id: string; status: string; gpu: boolean; description: string };
export const PIPELINES: Pipeline[] = JSON.parse(
  readFileSync(resolve(here, '..', '..', 'pipelines.json'), 'utf8'),
);
export const PIPELINE_IDS = new Set(PIPELINES.map((p) => p.id));

export async function enqueueJob(videoId: string, pipeline: string, cfg?: Record<string, unknown>): Promise<string> {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('analysis_jobs')
    .insert({ video_id: videoId, pipeline, config: cfg ?? {} })
    .select('id')
    .single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function listJobs(videoId: string) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('analysis_jobs')
    .select('*')
    .eq('video_id', videoId)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function listRecentJobs(limit = 50, status?: string) {
  const sb = requireSupabase();
  let q = sb
    .from('analysis_jobs')
    .select('id,video_id,pipeline,status,confidence,error,created_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (status) q = q.eq('status', status);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getJob(videoId: string, jobId: string) {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('analysis_jobs')
    .select('*')
    .eq('video_id', videoId)
    .eq('id', jobId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}
