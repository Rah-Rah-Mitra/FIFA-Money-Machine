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

// Videos that have a generated mesh scene (for the "analytics available" badge + analytics view).
export async function listScenes() {
  const sb = requireSupabase();
  const { data, error } = await sb
    .from('analysis_jobs')
    .select('id,video_id,pipeline,result,created_at')
    .in('pipeline', ['full_analysis', 'pose_scene', 'mesh_scene'])
    .eq('status', 'done')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function getPlayerTags(videoId: string) {
  const sb = requireSupabase();
  const { data, error } = await sb.from('player_tags').select('track_id,name,team').eq('video_id', videoId);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function setPlayerTag(videoId: string, trackId: number, name: string | null, team: number | null) {
  const sb = requireSupabase();
  const { error } = await sb
    .from('player_tags')
    .upsert({ video_id: videoId, track_id: trackId, name, team, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
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
