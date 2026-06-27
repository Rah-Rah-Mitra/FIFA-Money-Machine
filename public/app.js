// Minimal FIFA highlights player + analytics wiring. Vanilla, no build step.
const $ = (id) => document.getElementById(id);
const sessionId = crypto.randomUUID();
let hls = null;
let current = null; // current videoId
let heartbeat = null;

async function json(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

// ---------- catalog ----------
async function loadCatalog() {
  const items = await json('/catalog');
  const groups = {};
  for (const it of items) (groups[it.group] ??= []).push(it);
  const root = $('catalog');
  root.innerHTML = '';
  for (const g of Object.keys(groups).sort()) {
    const sec = document.createElement('div');
    sec.className = 'group';
    sec.innerHTML = `<h2>Group ${g}</h2>`;
    const grid = document.createElement('div');
    grid.className = 'groups';
    for (const it of groups[g]) {
      const card = document.createElement('div');
      card.className = 'card';
      const mins = it.durationSeconds ? `${Math.floor(it.durationSeconds / 60)}:${String(Math.round(it.durationSeconds % 60)).padStart(2, '0')}` : '';
      card.innerHTML = `<div class="thumb" style="background-image:url('${it.thumbnail ?? ''}')"></div>
        <div class="meta"><b>${it.title}</b><br><span>${mins}</span></div>`;
      card.onclick = () => play(it.videoId, it.title);
      grid.appendChild(card);
    }
    sec.appendChild(grid);
    root.appendChild(sec);
  }
}

// ---------- playback ----------
async function play(videoId, title) {
  current = videoId;
  $('player-wrap').style.display = 'block';
  $('panel').style.display = 'flex';
  $('now-title').textContent = title;
  window.scrollTo({ top: 0, behavior: 'smooth' });

  const pb = await json(`/videos/${videoId}/playback`);
  const video = $('video');
  if (pb.poster?.src) video.poster = pb.poster.src;

  // Uplynk preplay v2: streamUrl is a .json; resolve it to the actual playURL (.m3u8).
  let manifest = pb.streamUrl;
  try {
    const pre = await json(pb.streamUrl);
    manifest = pre.playURL || pre.playUrl || pb.streamUrl;
  } catch (e) {
    // ponytail: if the browser can't fetch Uplynk preplay directly (CORS), add a server proxy.
    console.warn('preplay resolve failed; trying streamUrl directly', e);
  }

  if (hls) { hls.destroy(); hls = null; }
  if (window.Hls && Hls.isSupported()) {
    hls = new Hls({ enableWorker: true });
    hls.loadSource(manifest);
    hls.attachMedia(video);
  } else {
    video.src = manifest; // Safari / iOS native HLS
  }
  wireEvents(video, videoId);
  loadAnalytics(videoId);
  loadPipelines(videoId);
}

// ---------- analytics event firing ----------
function send(videoId, type, video) {
  const body = JSON.stringify({
    type,
    positionSeconds: video.currentTime || 0,
    durationSeconds: Number.isFinite(video.duration) ? video.duration : undefined,
    sessionId,
    timestamp: Date.now(),
  });
  // keepalive so events survive navigation; beacon used on pagehide.
  fetch(`/videos/${videoId}/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body, keepalive: true }).catch(() => {});
}

function wireEvents(video, videoId) {
  video.onplay = () => {
    send(videoId, 'play', video);
    clearInterval(heartbeat);
    heartbeat = setInterval(() => { if (!video.paused) send(videoId, 'heartbeat', video); }, 10000);
  };
  video.onpause = () => { send(videoId, 'pause', video); clearInterval(heartbeat); };
  video.onseeked = () => send(videoId, 'seek', video);
  video.onended = () => { send(videoId, 'complete', video); clearInterval(heartbeat); loadAnalytics(videoId); };
  window.addEventListener('pagehide', () => {
    if (!current) return;
    const body = JSON.stringify({ type: 'heartbeat', positionSeconds: video.currentTime || 0, sessionId, timestamp: Date.now() });
    navigator.sendBeacon(`/videos/${current}/events`, new Blob([body], { type: 'application/json' }));
  }, { once: true });
}

async function loadAnalytics(videoId) {
  try {
    const a = await json(`/videos/${videoId}/analytics`);
    $('k-views').textContent = a.views;
    $('k-watch').textContent = a.avgWatchTimeSeconds ? a.avgWatchTimeSeconds.toFixed(1) : '0';
    $('k-compl').textContent = `${Math.round(a.completionRate * 100)}%`;
    $('bars').innerHTML = a.dropoff.map((v) => `<div style="height:${Math.max(2, v * 100)}%" title="${Math.round(v * 100)}%"></div>`).join('');
  } catch {
    $('k-views').textContent = '–'; // analytics store not configured yet
  }
}

// ---------- analysis pipelines + jobs ----------
let jobsTimer = null;

async function loadPipelines(videoId) {
  try {
    const pipes = await json('/pipelines');
    const sel = $('pipeline');
    sel.innerHTML = pipes.map((p) => `<option value="${p.id}">${p.id}${p.status !== 'ready' ? ` (${p.status})` : ''}</option>`).join('');
    const desc = () => {
      const p = pipes.find((x) => x.id === sel.value);
      $('pipeline-desc').textContent = p ? p.description : '';
      $('render').parentElement.style.display = sel.value === 'mesh_pose' ? '' : 'none';
    };
    sel.onchange = desc; desc();
    $('run').onclick = () => runJob(videoId);
    startJobsPolling(videoId);
  } catch {
    $('pipeline-desc').textContent = 'Pipelines unavailable.';
  }
}

async function runJob(videoId) {
  const pipeline = $('pipeline').value;
  const config = {};
  if (pipeline === 'mesh_pose' && $('render').checked) config.render = true;
  try {
    await json(`/videos/${videoId}/analyze`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pipeline, config }),
    });
    startJobsPolling(videoId);
  } catch (e) {
    $('jobs-hint').textContent = `Failed to queue: ${e.message}`;
  }
}

function startJobsPolling(videoId) {
  clearInterval(jobsTimer);
  pollJobs(videoId);
  jobsTimer = setInterval(() => pollJobs(videoId), 3000);
}

async function pollJobs(videoId) {
  let jobs;
  try { jobs = await json(`/videos/${videoId}/analysis`); }
  catch { clearInterval(jobsTimer); jobsTimer = null; return; }
  renderJobs(jobs);
  const queued = jobs.filter((j) => j.status === 'queued').length;
  const active = jobs.some((j) => j.status === 'queued' || j.status === 'running');
  if (!active) { clearInterval(jobsTimer); jobsTimer = null; }      // stop polling when nothing is pending
  $('jobs-hint').textContent = queued ? `${queued} job(s) queued — is the worker running?  .\\run-worker.ps1` : '';
}

function renderJobs(jobs) {
  const tbody = $('jobs').querySelector('tbody');
  tbody.innerHTML = jobs.slice(0, 12).map((j) => {
    const conf = j.confidence == null ? '–' : j.confidence;
    const overlay = j.result && j.result.overlayUrl
      ? `<button class="linkbtn" onclick="showOverlay('${j.result.overlayUrl}')">▶ overlay</button>` : '';
    return `<tr><td>${j.pipeline}</td><td><span class="badge s-${j.status}">${j.status}</span></td><td>${conf}</td><td>${overlay}</td></tr>`;
  }).join('') || '<tr><td colspan="4" class="note">No jobs yet — pick a pipeline and Analyze.</td></tr>';
}

function showOverlay(url) {
  const v = $('video');
  if (hls) { hls.destroy(); hls = null; }
  v.poster = ''; v.src = url; v.load(); v.play().catch(() => {});
  window.scrollTo({ top: 0, behavior: 'smooth' });
  $('jobs-hint').innerHTML = `Showing mesh overlay. <button class="linkbtn" onclick="play(current, document.getElementById('now-title').textContent)">↺ back to highlight</button>`;
}

loadCatalog().catch((e) => { $('catalog').innerHTML = `<p class="note">Failed to load catalog: ${e.message}</p>`; });
