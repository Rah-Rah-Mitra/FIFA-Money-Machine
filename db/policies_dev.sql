-- DEV ONLY: lets the publishable (anon) key read/write the two tables when you don't have the
-- service-role key. The browser never holds a Supabase key here (it talks only to our API), so the
-- exposure is limited to whoever has the public anon key. For production, use SUPABASE_SERVICE_KEY
-- (bypasses RLS) and drop these policies.

drop policy if exists "dev anon rw events" on playback_events;
create policy "dev anon rw events" on playback_events
  for all to anon using (true) with check (true);

drop policy if exists "dev anon rw jobs" on analysis_jobs;
create policy "dev anon rw jobs" on analysis_jobs
  for all to anon using (true) with check (true);
