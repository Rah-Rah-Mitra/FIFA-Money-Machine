import { requireSupabase } from './supabase';

export type PlaybackEvent = {
  type: 'play' | 'pause' | 'seek' | 'complete' | 'heartbeat';
  positionSeconds: number;
  durationSeconds?: number;
  sessionId: string;
  timestamp?: number | string;
};

export async function ingestEvent(videoId: string, e: PlaybackEvent): Promise<void> {
  const sb = requireSupabase();
  const ts = e.timestamp ? new Date(e.timestamp).toISOString() : new Date().toISOString();
  const { error } = await sb.from('playback_events').insert({
    video_id: videoId,
    session_id: e.sessionId,
    type: e.type,
    position_seconds: e.positionSeconds ?? 0,
    duration_seconds: e.durationSeconds ?? null,
    ts,
  });
  if (error) throw new Error(error.message);
}

type Row = { session_id: string; type: string; position_seconds: number; duration_seconds: number | null };

export type Analytics = {
  views: number;
  avgWatchTimeSeconds: number;
  completionRate: number;
  dropoff: number[]; // retention at each decile (10%..100%)
};

// Pure aggregation — unit tested directly.
export function aggregate(rows: Row[]): Analytics {
  const sessions = new Map<string, { maxPos: number; duration: number; completed: boolean }>();
  for (const r of rows) {
    let s = sessions.get(r.session_id);
    if (!s) {
      s = { maxPos: 0, duration: 0, completed: false };
      sessions.set(r.session_id, s);
    }
    s.maxPos = Math.max(s.maxPos, r.position_seconds || 0);
    if (r.duration_seconds) s.duration = Math.max(s.duration, r.duration_seconds);
    if (r.type === 'complete') s.completed = true;
  }
  const list = [...sessions.values()];
  const views = list.length;
  if (!views) return { views: 0, avgWatchTimeSeconds: 0, completionRate: 0, dropoff: Array(10).fill(0) };

  const avgWatchTimeSeconds = list.reduce((a, s) => a + s.maxPos, 0) / views;
  const completionRate =
    list.filter((s) => s.completed || (s.duration > 0 && s.maxPos / s.duration >= 0.9)).length / views;
  const dropoff = Array.from({ length: 10 }, (_, i) => {
    const thresh = (i + 1) / 10;
    const reached = list.filter((s) => s.duration > 0 && s.maxPos / s.duration >= thresh).length;
    return reached / views;
  });
  return { views, avgWatchTimeSeconds, completionRate, dropoff };
}

export async function getAnalytics(videoId: string): Promise<Analytics> {
  const sb = requireSupabase();
  // ponytail: pull rows and aggregate in-process. Ceiling: move to a SQL view / RPC if a video
  // accumulates very large event volumes.
  const { data, error } = await sb
    .from('playback_events')
    .select('session_id,type,position_seconds,duration_seconds')
    .eq('video_id', videoId);
  if (error) throw new Error(error.message);
  return aggregate((data ?? []) as Row[]);
}
