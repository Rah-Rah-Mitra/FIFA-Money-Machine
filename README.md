# FIFA 26 Highlights — API + Analytics

Watch the 2026 World Cup highlights (sourced from FIFA Plus) through a small web UI, with a
playback-analytics layer and an extensible analysis-job layer (player tracking, match modelling,
and PEAR human-mesh reconstruction).

## Architecture

```
Browser (public/)  ──HTTP──>  Node/Express API (api/)  ──>  Supabase (Postgres)
  hls.js player                 wraps FIFA CMS, playback        playback_events
  analytics + analyze           analytics, job orchestration     analysis_jobs (queue + results)
                                                                      ▲
                              Python worker (worker/) ────────────────┘ polls jobs, writes results
                                CV: YOLOv8 + ByteTrack
                                modelling: Poisson / penaltyblog
                                mesh: PEAR (its own env) ──> D:\PEAR\.venv  (GPU)
```

- **Metadata** (`/catalog`, `/videos/:id`) is cached. **Playback** (`/videos/:id/playback`) is a
  short-lived signed Uplynk credential and is never cached.
- `analysis_jobs` is both the queue and the result store. The worker polls it.

## Setup

1. **API deps**: `npm install --prefix api`
2. **Supabase**: run `db/schema.sql` in the Supabase SQL editor (or `python db/setup.py`). Tables have
   RLS enabled — the backend uses the **service-role key** which bypasses RLS.
3. **.env** (repo root, gitignored — copy from `.env.example`): set `SUPABASE_URL`,
   `SUPABASE_SERVICE_KEY`, and (for the worker) `PEAR_DIR` / `PEAR_PYTHON`.
4. **Worker deps** (separate Python env): `pip install -r worker/requirements.txt` + `ffmpeg` on PATH.

## Run

```bash
npm start --prefix api          # http://localhost:3000  (UI at /, docs at /docs)
.\run-worker.ps1                # start the analysis worker (loop). --once for a single job.
```

`run-worker.ps1` / `run-worker.bat` auto-use the isolated worker venv if present. Create it once:

```bash
python -m venv worker/.venv
worker/.venv/Scripts/pip install -r worker/requirements.txt   # ffmpeg is bundled via imageio-ffmpeg
```

The UI shows a **jobs panel** (pipeline · status · confidence) for the open video; queued jobs stay
queued until the worker runs them. `GET /jobs?status=queued` lists jobs globally.

**Mesh overlay:** pick `mesh_pose`, tick *render mesh overlay*, Analyze. When the job finishes, a
**▶ overlay** button appears in the jobs panel and plays the rendered mesh video in the player.
Requires the GPU PEAR env; overlays are written to `public/analysis/<jobId>.mp4`.

### Troubleshooting

- **Logs looping on `/analysis/...` / a job stuck "queued"** → no worker is running. Start it with
  `.\run-worker.ps1`. The API no longer logs the poll endpoints, and the UI stops polling once no job
  is queued/running.
- **`mesh_pose` returns `gpu_required`** → no CUDA; set `PEAR_DIR`/`PEAR_PYTHON` to a GPU PEAR install.
- **GPU sits idle** → the worker venv must have a CUDA torch build (the default PyPI torch is CPU-only):
  `worker/.venv/Scripts/pip install --index-url https://download.pytorch.org/whl/cu126 torch torchvision`.
- **Uplynk 403 in the worker** → handled (ffmpeg sends a browser UA + retries). On Python 3.13 MediaPipe
  ships only the Tasks API (no legacy `mp.solutions`) — the code uses `PoseLandmarker` accordingly.
- **Restart workers after pulling code** — long-running `worker.py` loops cache the pipeline registry.

## Endpoints

| Method | Path | Notes |
|---|---|---|
| GET | `/catalog` | all highlights, grouped (cached) |
| GET | `/videos/:id` | normalized metadata (cached) |
| GET | `/videos/:id/playback` | Uplynk bundle + `streamUrl` (never cached) |
| POST | `/videos/:id/events` | ingest play/pause/seek/complete/heartbeat |
| GET | `/videos/:id/analytics` | views, avg watch, completion, decile drop-off |
| GET | `/pipelines` | registered analysis pipelines |
| POST | `/videos/:id/analyze` | enqueue `{pipeline, config?}` → `{jobId}` |
| GET | `/videos/:id/analysis[/:jobId]` | job status + result |

Full schema at `/openapi.yaml` (rendered at `/docs`).

## Analysis pipelines (`worker/pipelines/`)

| id | status | what |
|---|---|---|
| `video_metadata` | ready | echoes normalized metadata (reference) |
| `playback_stats` | ready | snapshot of playback analytics |
| `player_tracking` | ready | YOLOv8 + ByteTrack, team colour clustering, position heatmap |
| `match_model` | ready | Poisson/Dixon-Coles scoreline estimate (pass `config.matches` for a data fit) |
| `mesh_pose` | experimental | PEAR SMPLX mesh per player → camera-space kinematics (**GPU**) |
| `player_stats` | ready | per-player body-part usage via MediaPipe Pose (fast) — feeds the stock-market UI |
| `mesh_scene` | ready | body-part usage + a **transparent** PEAR mesh-overlay `.webm` (**GPU**) |
| `pose_scene` | ready | **default engine** — GPU YOLO-pose multi-person keypoints + rich metrics + a keypoints file for the live skeleton overlay (fast, ~30× PEAR's per-frame speed) |
| `full_analysis` | ready | `pose_scene` **+** an auto PEAR **ultrazoom** mesh of the key player's busiest window (cropped + low-res so PEAR runs at ~12 fps, smooth). The full demo. (**GPU**) |

### What the dashboard shows (Hudl-style)

Live skeleton overlay synced to the highlight (per-player + all-players toggle); a **report card**
(work-rate gauge + distance / max-speed / sprints / L-R symmetry / posture lean / screen-time);
body-part **usage-over-time** chart + **tickers** (price/change/share + sparkline); **activity
timeline**; **position heatmap**; **radar comparison** (vs another player or team avg); and the
**key-moment PEAR ultrazoom** mesh. All metrics are size-normalised by bbox so distant players are
fair. Reach it from the **Analytics** nav (a hub of analysed matches) or the 📊 badge on Markets.

GPU note: the worker venv must have CUDA torch (see Troubleshooting). `pose_scene` runs many players
fast; run several workers in parallel for light jobs, but serialise `full_analysis` (PEAR) to stay
within 8 GB VRAM.

### Player analytics (stock-market UI)

Generate a scene (`mesh_scene`, or `player_stats` for stats-only) → the video gets a 📊 badge →
open `analytics.html?video=<id>`. Each tracked player is a "stock"; each body part (HEAD, CORE,
L/R ARM, L/R LEG) is a ticker with usage intensity, a dominance-trend change%, share, and a
sparkline, plus a usage-over-time chart, a share heatmap, and the transparent mesh overlay layered
on the highlight. Players auto-tag as "Player N" with their team colour — click a name to rename
(persists per video). Body-part usage = summed 3D displacement of each part's MediaPipe world
landmarks over screen time.

Content-analytics results carry a `confidence` and a feasibility note: highlights are heavily
cut/zoomed, so derived player stats are estimates and match-result prediction is low-confidence.
`match_model` sidesteps this by modelling from goal data, not the video.

### mesh_pose / PEAR

Reuses the existing `D:\PEAR` install (its own `.venv`, py3.9 + CUDA + pytorch3d, `yolov8x.pt`,
SMPLX/FLAME assets). The worker shells out to `$PEAR_PYTHON` running `worker/pear_adapter.py`
(detect → crop → EHM → per-detection SMPLX joints JSON); `mesh_pose` links detections across frames
and derives kinematics. Needs an NVIDIA GPU; on a CPU box the job returns `gpu_required`.

## Tests

```bash
npm test --prefix api           # normalizer units + network-gated live integration (Argentina v Algeria)
python worker/test_pipelines.py # pure pipeline logic (Poisson, IoU tracking)
```

## Security

`.env` is gitignored. The browser talks only to this API, never to Supabase. Use the service-role
key server-side only. The DB password shared during setup should be rotated.
