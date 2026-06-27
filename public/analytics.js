// Player analytics dashboard: live skeleton overlay + Hudl-style report card, charts, heatmap,
// radar comparison, and the PEAR key-moment ultrazoom. Vanilla, no deps.
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const videoId = params.get('video');

const PART_META = {
  head: { label: 'HEAD', color: '#e3b341' }, torso: { label: 'CORE', color: '#56b6e0' },
  left_arm: { label: 'L.ARM', color: '#3fb950' }, right_arm: { label: 'R.ARM', color: '#a371f7' },
  left_leg: { label: 'L.LEG', color: '#f0883e' }, right_leg: { label: 'R.LEG', color: '#db61a2' },
};
const EDGES = [[5,7],[7,9],[6,8],[8,10],[5,6],[5,11],[6,12],[11,12],[11,13],[13,15],[12,14],[14,16],[0,5],[0,6]];

let scene = null, players = [], partOrder = Object.keys(PART_META), sel = 0, hls = null, kp = null;

const j = async (u, o) => { const r = await fetch(u, o); if (!r.ok) throw new Error(`${r.status} ${u}`); return r.json(); };

async function renderHub() {
  $('title').textContent = 'Analytics'; $('hub').style.display = 'block';
  const [scenes, catalog] = await Promise.all([j('/scenes').catch(() => []), j('/catalog').catch(() => [])]);
  const meta = Object.fromEntries(catalog.map((c) => [c.videoId, c]));
  const seen = new Set(), items = [];
  for (const s of scenes) if (!seen.has(s.video_id)) { seen.add(s.video_id); items.push(s); }
  $('hubgrid').innerHTML = items.length ? items.map((s) => {
    const m = meta[s.video_id] || {}, n = s.result?.players?.length || 0;
    return `<a class="scard" href="/analytics.html?video=${s.video_id}"><div class="th" style="background-image:url('${m.thumbnail || ''}')"></div>
      <div class="m"><b>${m.title || s.video_id}</b><br><span>${n} players · analytics</span></div></a>`;
  }).join('') : '<p class="muted">No analytics yet — run full_analysis on a match from Markets.</p>';
}

async function load() {
  if (!videoId) return renderHub();
  $('dash').style.display = 'grid';
  let d = {}; try { d = await j(`/videos/${videoId}`); } catch {}
  $('title').textContent = `Player Analytics — ${d.title || videoId}`;
  const jobs = await j(`/videos/${videoId}/analysis`).catch(() => []);
  const done = jobs.filter((x) => x.status === 'done' && x.result?.players?.length);
  const job = done.find((x) => x.pipeline === 'full_analysis') || done.find((x) => x.pipeline === 'pose_scene') || done[0];
  if (!job) { $('sub').textContent = 'No scene yet — run full_analysis from Markets.'; return; }
  scene = job.result; partOrder = scene.partOrder || partOrder;
  const tags = await j(`/videos/${videoId}/players`).catch(() => []);
  const tagBy = Object.fromEntries(tags.map((t) => [t.track_id, t]));
  players = scene.players.map((p) => ({ ...p, name: tagBy[p.trackId]?.name || p.tag }));
  $('sub').textContent = `${players.length} players · ${scene.frameCount} frames @ ${scene.fps}fps · ${scene.engine}`;
  if (scene.keypointsUrl) kp = await j(scene.keypointsUrl).catch(() => null);
  renderPlayers(); fillCompare(); setupVideo(); setupKeyMoment(); selectPlayer(0);
}

function renderPlayers() {
  $('players').innerHTML = '';
  players.forEach((p, i) => {
    const chip = document.createElement('div'); chip.className = 'chip' + (i === sel ? ' active' : '');
    chip.innerHTML = `<span class="dot" style="background:${p.color}"></span>`;
    const inp = document.createElement('input'); inp.value = p.name;
    inp.onclick = (e) => e.stopPropagation(); inp.onchange = () => saveName(p, inp.value);
    chip.appendChild(inp);
    const fs = document.createElement('span'); fs.className = 'fs'; fs.textContent = `${p.framesSeen}f`; chip.appendChild(fs);
    chip.onclick = () => selectPlayer(i); $('players').appendChild(chip);
  });
}
async function saveName(p, name) { p.name = name; fillCompare(); try { await fetch(`/videos/${videoId}/players/${p.trackId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, team: p.team ?? null }) }); } catch {} }

function selectPlayer(i) { sel = i; renderPlayers(); renderScorecard(); renderChart(); renderActivity(); renderHeat(); renderTable(); renderRadar(); if (kp) paint(); }
const cur = () => players[sel];

// ---- report card ----
function gauge(v) {
  const r = 46, c = 2 * Math.PI * r, off = c * (1 - v / 100);
  $('gauge').innerHTML = `<circle cx="55" cy="55" r="${r}" fill="none" stroke="#222c38" stroke-width="9"/>
    <circle cx="55" cy="55" r="${r}" fill="none" stroke="var(--accent)" stroke-width="9" stroke-linecap="round"
      stroke-dasharray="${c}" stroke-dashoffset="${off}" transform="rotate(-90 55 55)"/>
    <text x="55" y="52" text-anchor="middle" fill="#e6edf3" font-size="22" font-weight="700">${Math.round(v)}</text>
    <text x="55" y="70" text-anchor="middle" fill="#8b98a5" font-size="10">WORK RATE</text>`;
}
function renderScorecard() {
  const p = cur(), m = p.metrics; $('sc-name').textContent = p.name;
  gauge(m.workRate || 0);
  const k = [['distance', m.distance, 'body-len'], ['maxSpeed', m.maxSpeed, 'bl/s max'], ['sprints', m.sprints, 'bursts'],
    ['symmetryPct', m.symmetryPct + '%', `L/R (${m.dominantSide})`], ['leanDeg', m.leanDeg + '°', 'posture'], ['screenTimePct', (m.screenTimePct || 0) + '%', 'screen']];
  $('kpis').innerHTML = k.map(([_, v, lbl]) => `<div class="kpi"><b>${v}</b><span>${lbl}</span></div>`).join('');
}

// ---- usage chart / table (share-trend metrics) ----
const _pos = (a) => a.filter((v) => v > 1e-9), _avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
function metrics(parts, k) {
  const s = parts[k].series || [], n = s.length || 1, h = Math.floor(n / 2);
  const price = _avg(_pos(s));
  const tot = s.map((_, b) => partOrder.reduce((a, p) => a + (parts[p].series[b] || 0), 0));
  const sh = s.map((v, b) => tot[b] > 1e-9 ? v / tot[b] * 100 : 0);
  const a = _avg(_pos(sh.slice(0, h))), b = _avg(_pos(sh.slice(h)));
  return { price, change: a > 1e-9 ? (b - a) / a * 100 : 0, share: parts[k].sharePct };
}
function renderChart() {
  const parts = cur().parts, W = 520, H = 190, pad = 6;
  const n = parts[partOrder[0]].series.length || 1, max = Math.max(1e-6, ...partOrder.flatMap((k) => parts[k].series));
  const x = (i) => pad + i / Math.max(1, n - 1) * (W - 2 * pad), y = (v) => H - pad - v / max * (H - 2 * pad);
  const lines = partOrder.map((k) => `<polyline fill="none" stroke="${PART_META[k].color}" stroke-width="2" points="${parts[k].series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')}"/>`).join('');
  $('chart').innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" preserveAspectRatio="none">${lines}</svg>
    <div style="font-size:11px;margin-top:6px">${partOrder.map((k) => `<span style="color:${PART_META[k].color};margin-right:9px">■ ${PART_META[k].label}</span>`).join('')}</div>`;
}
function spark(s, c) { const W = 110, H = 24, m = Math.max(1e-6, ...s), n = s.length; return `<svg width="${W}" height="${H}"><polyline fill="none" stroke="${c}" stroke-width="1.5" points="${s.map((v, i) => `${(i / Math.max(1, n - 1) * W).toFixed(1)},${(H - v / m * (H - 2)).toFixed(1)}`).join(' ')}"/></svg>`; }
function renderTable() {
  const parts = cur().parts;
  $('rows').innerHTML = partOrder.map((k) => { const m = metrics(parts, k), up = m.change >= 0;
    return `<tr><td class="tick" style="color:${PART_META[k].color}">${PART_META[k].label}</td><td>${m.price.toFixed(1)}</td>
      <td class="${up ? 'up' : 'down'}">${up ? '+' : ''}${m.change.toFixed(1)}%</td><td>${m.share.toFixed(1)}%</td><td>${spark(parts[k].series, PART_META[k].color)}</td></tr>`; }).join('');
}
function renderActivity() {
  const a = cur().activity || [], m = Math.max(1e-6, ...a);
  $('activity').innerHTML = a.map((v) => `<div style="height:${Math.max(2, v / m * 100)}%" title="${v}"></div>`).join('');
}
function renderHeat() {
  const h = cur().heat || [], gw = (h[0] || []).length || 12;
  $('heat').style.gridTemplateColumns = `repeat(${gw},1fr)`;
  $('heat').innerHTML = h.flat().map((v) => `<div style="background:rgba(63,185,80,${(0.08 + v * 0.9).toFixed(2)})"></div>`).join('');
}

// ---- radar comparison ----
function fillCompare() {
  $('cmp').innerHTML = '<option value="-1">team avg</option>' + players.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
  $('cmp').onchange = renderRadar;
}
function axesFor(p) {
  return { 'work': p.metrics.workRate || 0, 'dist': p.metrics.distance, 'speed': p.metrics.maxSpeed,
    'sprints': p.metrics.sprints, 'move': p.metrics.totalMovement, 'balance': 100 - p.metrics.symmetryPct };
}
function renderRadar() {
  const A = axesFor(cur());
  const cmpI = Number($('cmp').value);
  const B = cmpI >= 0 ? axesFor(players[cmpI]) : (() => { const o = {}; for (const k of Object.keys(A)) o[k] = players.reduce((s, p) => s + axesFor(p)[k], 0) / players.length; return o; })();
  const keys = Object.keys(A), maxv = {};
  keys.forEach((k) => maxv[k] = Math.max(1e-6, ...players.map((p) => axesFor(p)[k])));
  const C = 110, R = 80, poly = (O, col, fill) => {
    const pts = keys.map((k, i) => { const ang = -Math.PI / 2 + i / keys.length * 2 * Math.PI, r = O[k] / maxv[k] * R; return `${(C + r * Math.cos(ang)).toFixed(1)},${(C + r * Math.sin(ang)).toFixed(1)}`; }).join(' ');
    return `<polygon points="${pts}" fill="${fill}" stroke="${col}" stroke-width="2"/>`;
  };
  const grid = [0.5, 1].map((g) => `<polygon points="${keys.map((k, i) => { const ang = -Math.PI / 2 + i / keys.length * 2 * Math.PI; return `${(C + R * g * Math.cos(ang)).toFixed(1)},${(C + R * g * Math.sin(ang)).toFixed(1)}`; }).join(' ')}" fill="none" stroke="#222c38"/>`).join('');
  const labels = keys.map((k, i) => { const ang = -Math.PI / 2 + i / keys.length * 2 * Math.PI; return `<text x="${(C + (R + 14) * Math.cos(ang)).toFixed(0)}" y="${(C + (R + 14) * Math.sin(ang)).toFixed(0)}" fill="#8b98a5" font-size="9" text-anchor="middle">${k}</text>`; }).join('');
  $('radar').innerHTML = `<svg viewBox="0 0 220 220" width="100%">${grid}${poly(B, '#8b98a5', 'rgba(139,152,165,.12)')}${poly(A, cur().color, 'rgba(63,185,80,.18)')}${labels}</svg>
    <div style="font-size:11px"><span style="color:${cur().color}">■ ${cur().name}</span> &nbsp; <span class="muted">■ ${cmpI >= 0 ? players[cmpI].name : 'team avg'}</span></div>`;
}

// ---- video + live skeleton overlay ----
let raf = null;
function frameRect(cv) {
  const [fw, fh] = scene.frameSize || [16, 9], va = fw / fh, ca = cv.width / cv.height;
  let w, h; if (va > ca) { w = cv.width; h = w / va; } else { h = cv.height; w = h * va; }
  return { x: (cv.width - w) / 2, y: (cv.height - h) / 2, w, h };
}
function paint() {                       // draw current frame once (called by rAF + timeupdate/seek)
  const cv = $('skel'), ctx = cv.getContext('2d'); const wrap = cv.parentElement;
  if (cv.width !== wrap.clientWidth || cv.height !== wrap.clientHeight) { cv.width = wrap.clientWidth; cv.height = wrap.clientHeight; }
  ctx.clearRect(0, 0, cv.width, cv.height);
  if (!kp || !$('skelon').checked) return;
  const f = Math.round(($('hl').currentTime - (scene.startSeconds || 0)) * scene.fps);
  const rect = frameRect(cv);
  const toXY = (x, y) => [rect.x + x * rect.w, rect.y + y * rect.h];
  const drawOne = (track, color, lw) => {
    const e = track.reduce((best, t) => Math.abs(t.f - f) < Math.abs((best?.f ?? 1e9) - f) ? t : best, null);
    if (!e || Math.abs(e.f - f) > 2) return;
    ctx.lineWidth = lw; ctx.strokeStyle = color; ctx.fillStyle = color;
    for (const [a, b] of EDGES) { const ka = e.k[a], kb = e.k[b]; if (ka[2] > 0.3 && kb[2] > 0.3) { const [x1, y1] = toXY(ka[0], ka[1]), [x2, y2] = toXY(kb[0], kb[1]); ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); } }
    for (const pt of e.k) if (pt[2] > 0.3) { const [x, y] = toXY(pt[0], pt[1]); ctx.beginPath(); ctx.arc(x, y, lw + 1, 0, 7); ctx.fill(); }
  };
  if ($('allon').checked) players.forEach((p) => { if (p !== cur()) drawOne(kp[String(p.trackId)] || [], 'rgba(139,152,165,.55)', 2); });
  drawOne(kp[String(cur().trackId)] || [], cur().color, 3.5);
}
function loop() { paint(); raf = requestAnimationFrame(loop); }
async function setupVideo() {
  const hl = $('hl');
  try {
    const pb = await j(`/videos/${videoId}/playback`); let man = pb.streamUrl;
    try { const pre = await j(pb.streamUrl); man = pre.playURL || pre.playUrl || man; } catch {}
    if (window.Hls && Hls.isSupported()) { hls = new Hls(); hls.loadSource(man); hls.attachMedia(hl); } else hl.src = man;
    hl.addEventListener('loadedmetadata', () => { hl.currentTime = scene.startSeconds || 0; }, { once: true });
  } catch { $('ovnote').textContent = 'highlight unavailable'; }
  $('playbtn').onclick = () => { hl.currentTime = scene.startSeconds || 0; hl.play().catch(() => {}); };
  $('kmbtn').onclick = () => { const ov = $('ov'); const on = ov.style.display === 'none'; ov.style.display = on ? '' : 'none'; if (on && scene.keyMoment?.meshUrl) { ov.src = scene.keyMoment.meshUrl; ov.play().catch(() => {}); } };
  $('skelon').onchange = paint; $('allon').onchange = paint;
  hl.ontimeupdate = paint; hl.onseeked = paint;   // robust even if rAF is throttled
  if (raf) cancelAnimationFrame(raf); loop();
}
function setupKeyMoment() {
  const km = scene.keyMoment;
  if (km?.meshUrl) { $('km').src = km.meshUrl; $('kmnote').textContent = `${km.tag} · ${km.startSeconds}s for ${km.durationSeconds}s · ${km.meshFrames} mesh frames @ ${km.fps}fps (PEAR SMPLX, transparent)`; }
  else { $('kmnote').textContent = 'No key-moment mesh (run full_analysis on a GPU).'; }
}

load().catch((e) => { $('sub').textContent = `Failed: ${e.message}`; });
