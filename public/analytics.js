// Player analytics: body-part "usage" as a stock-market-style dashboard, fed by a generated scene.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const videoId = params.get('video');

const PART_META = {
  head: { label: 'HEAD', color: '#e3b341' },
  torso: { label: 'CORE', color: '#56b6e0' },
  left_arm: { label: 'L.ARM', color: '#3fb950' },
  right_arm: { label: 'R.ARM', color: '#a371f7' },
  left_leg: { label: 'L.LEG', color: '#f0883e' },
  right_leg: { label: 'R.LEG', color: '#db61a2' },
};

let scene = null;      // job result with players[]
let players = [];      // merged with tag overrides
let partOrder = Object.keys(PART_META);
let sel = 0;
let hls = null;

async function json(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

async function load() {
  if (!videoId) { $('title').textContent = 'No video specified'; return; }
  let details = {};
  try { details = await json(`/videos/${videoId}`); } catch {}
  $('title').textContent = `Player Analytics — ${details.title || videoId}`;

  const jobs = await json(`/videos/${videoId}/analysis`).catch(() => []);
  const done = jobs.filter((j) => j.status === 'done' && j.result && Array.isArray(j.result.players) && j.result.players.length);
  // prefer a mesh_scene (has overlay), else any with players
  const job = done.find((j) => j.pipeline === 'mesh_scene') || done[0];
  if (!job) {
    $('sub').textContent = 'No scene generated yet — run mesh_scene or player_stats from the markets page.';
    return;
  }
  scene = job.result;
  partOrder = scene.partOrder || partOrder;

  const tags = await json(`/videos/${videoId}/players`).catch(() => []);
  const tagBy = Object.fromEntries(tags.map((t) => [t.track_id, t]));
  players = scene.players.map((p) => ({ ...p, name: tagBy[p.trackId]?.name || p.tag }));

  $('sub').textContent = `${players.length} players · ${scene.frameCount} frames @ ${scene.fps}fps · engine ${scene.engine || 'mediapipe'}`;
  renderPlayers();
  setupVideo(scene.overlayUrl);
  selectPlayer(0);
}

function renderPlayers() {
  $('players').innerHTML = '';
  players.forEach((p, i) => {
    const chip = document.createElement('div');
    chip.className = 'chip' + (i === sel ? ' active' : '');
    chip.innerHTML = `<span class="dot" style="background:${p.color}"></span>`;
    const input = document.createElement('input');
    input.value = p.name;
    input.onclick = (e) => e.stopPropagation();
    input.onchange = () => saveName(p, input.value);
    chip.appendChild(input);
    const fs = document.createElement('span');
    fs.className = 'fs';
    fs.textContent = `${p.framesSeen}f`;
    chip.appendChild(fs);
    chip.onclick = () => selectPlayer(i);
    $('players').appendChild(chip);
  });
}

async function saveName(p, name) {
  p.name = name;
  try { await fetch(`/videos/${videoId}/players/${p.trackId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, team: p.team ?? null }) }); } catch {}
}

function selectPlayer(i) {
  sel = i;
  renderPlayers();
  renderChart();
  renderTable();
  renderHeat();
}

function curParts() { return players[sel].parts; }

// Display metrics from the per-bucket series. price = average intensity over ACTIVE buckets;
// change = trend in this part's *dominance* (its share within each bucket), so it varies per part
// instead of just tracking whether the player is on screen.
const _present = (a) => a.filter((v) => v > 1e-9);
const _avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
function metrics(parts, k) {
  const s = parts[k].series || [];
  const n = s.length || 1, h = Math.floor(n / 2);
  const price = _avg(_present(s));
  const tot = s.map((_, b) => partOrder.reduce((a, p) => a + (parts[p].series[b] || 0), 0));
  const sh = s.map((v, b) => (tot[b] > 1e-9 ? (v / tot[b]) * 100 : 0));
  const a = _avg(_present(sh.slice(0, h))), b = _avg(_present(sh.slice(h)));
  const change = a > 1e-9 ? ((b - a) / a) * 100 : 0;
  return { price, change, share: parts[k].sharePct };
}

// ---- line chart: each part over time buckets ----
function renderChart() {
  const parts = curParts();
  const W = 520, H = 200, pad = 6;
  const n = (parts[partOrder[0]].series || []).length || 1;
  const max = Math.max(1e-6, ...partOrder.flatMap((k) => parts[k].series));
  const x = (i) => pad + (i / Math.max(1, n - 1)) * (W - 2 * pad);
  const y = (v) => H - pad - (v / max) * (H - 2 * pad);
  const lines = partOrder.map((k) => {
    const pts = parts[k].series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    return `<polyline fill="none" stroke="${PART_META[k].color}" stroke-width="2" points="${pts}"/>`;
  }).join('');
  const legend = partOrder.map((k) => `<span style="color:${PART_META[k].color};margin-right:10px">■ ${PART_META[k].label}</span>`).join('');
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none" style="display:block">${lines}</svg>
    <div style="font-size:11px;margin-top:6px">${legend}</div>`;
}

// ---- ticker table ----
function spark(series, color) {
  const W = 110, H = 26, max = Math.max(1e-6, ...series), n = series.length;
  const pts = series.map((v, i) => `${(i / Math.max(1, n - 1) * W).toFixed(1)},${(H - (v / max) * (H - 2)).toFixed(1)}`).join(' ');
  return `<svg width="${W}" height="${H}"><polyline fill="none" stroke="${color}" stroke-width="1.5" points="${pts}"/></svg>`;
}
function renderTable() {
  const parts = curParts();
  $('rows').innerHTML = partOrder.map((k) => {
    const p = parts[k], m = metrics(parts, k), up = m.change >= 0;
    return `<tr>
      <td class="tick" style="color:${PART_META[k].color}">${PART_META[k].label}</td>
      <td>${m.price.toFixed(1)}</td>
      <td class="${up ? 'up' : 'down'}">${up ? '+' : ''}${m.change.toFixed(1)}%</td>
      <td>${m.share.toFixed(1)}%</td>
      <td>${spark(p.series, PART_META[k].color)}</td>
    </tr>`;
  }).join('');
}

// ---- heatmap (share-sized tiles, change-coloured) ----
function renderHeat() {
  const parts = curParts();
  $('heat').innerHTML = partOrder.map((k) => {
    const p = parts[k], m = metrics(parts, k), g = m.change >= 0;
    const inten = Math.min(0.85, 0.3 + Math.abs(m.change) / 100);
    const bg = g ? `rgba(63,185,80,${inten})` : `rgba(248,81,73,${inten})`;
    return `<div class="tile" style="flex-grow:${Math.max(2, m.share)};background:${bg}">
      <div>${PART_META[k].label}</div><small>${m.share.toFixed(0)}% · ${g ? '+' : ''}${m.change.toFixed(0)}%</small></div>`;
  }).join('');
}

// ---- video + transparent mesh overlay ----
async function setupVideo(overlayUrl) {
  const hl = $('hl');
  try {
    const pb = await json(`/videos/${videoId}/playback`);
    let manifest = pb.streamUrl;
    try { const pre = await json(pb.streamUrl); manifest = pre.playURL || pre.playUrl || pb.streamUrl; } catch {}
    if (window.Hls && Hls.isSupported()) { hls = new Hls(); hls.loadSource(manifest); hls.attachMedia(hl); }
    else hl.src = manifest;
    hl.addEventListener('loadedmetadata', () => { hl.currentTime = scene.startSeconds || 0; }, { once: true });
  } catch (e) { $('ovnote').textContent = 'highlight unavailable'; }

  const ov = $('ov');
  if (overlayUrl) { ov.src = overlayUrl; } else { $('ovnote').textContent = 'no mesh overlay (run mesh_scene on a GPU)'; }
  $('ovon').onchange = () => { ov.style.display = $('ovon').checked ? '' : 'none'; };
  $('playbtn').onclick = () => {
    hl.currentTime = scene.startSeconds || 0;
    hl.play().catch(() => {});
    ov.currentTime = 0; ov.play().catch(() => {});
  };
}

load().catch((e) => { $('sub').textContent = `Failed: ${e.message}`; });
