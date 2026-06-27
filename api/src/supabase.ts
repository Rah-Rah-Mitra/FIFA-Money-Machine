import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config';

// Optional: the API boots and serves catalog/playback even without Supabase.
// Analytics + analysis endpoints require it and return 503 if unset.
export const supabase: SupabaseClient | null =
  config.supabaseUrl && config.supabaseKey
    ? createClient(config.supabaseUrl, config.supabaseKey, { auth: { persistSession: false } })
    : null;

export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error('Supabase not configured: set SUPABASE_URL and SUPABASE_SERVICE_KEY');
  }
  return supabase;
}
