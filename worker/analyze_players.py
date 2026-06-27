"""Shared player analytics: YOLO+ByteTrack tracks -> per-player MediaPipe Pose landmarks ->
body-part 'usage' time series (the data behind the stock-market UI). Heavy deps are imported
lazily so the pure usage math (compute_usage) stays importable for the self-check."""
import os
import urllib.request

import numpy as np

_MODEL_URL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"


def _ensure_pose_model():
    d = os.path.join(os.path.dirname(__file__), "models")
    os.makedirs(d, exist_ok=True)
    path = os.path.join(d, "pose_landmarker_lite.task")
    if not os.path.exists(path):
        urllib.request.urlretrieve(_MODEL_URL, path)
    return path

# MediaPipe Pose 33-landmark groups -> 6 body parts shown as "tickers".
BODY_PARTS = {
    "head": [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    "torso": [11, 12, 23, 24],
    "left_arm": [11, 13, 15, 17, 19, 21],
    "right_arm": [12, 14, 16, 18, 20, 22],
    "left_leg": [23, 25, 27, 29, 31],
    "right_leg": [24, 26, 28, 30, 32],
}
PART_ORDER = ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"]


def compute_usage(seq, frame_range, buckets=12):
    """seq: list of (frame_idx, landmarks[33,3] world coords, meters). Returns per-part usage.
    'Usage' = summed 3D displacement of a part's landmarks between consecutive detected frames,
    bucketed over the clip's frame range. Pure numpy — unit tested."""
    f0, f1 = frame_range
    span = max(1, f1 - f0)
    parts = {p: {"series": [0.0] * buckets, "total": 0.0} for p in PART_ORDER}
    for i in range(1, len(seq)):
        (fa, la), (fb, lb) = seq[i - 1], seq[i]
        d = np.linalg.norm(np.asarray(lb) - np.asarray(la), axis=1)  # per-landmark displacement
        b = min(buckets - 1, int((fb - f0) / span * buckets))
        for p, idxs in BODY_PARTS.items():
            move = float(np.mean([d[k] for k in idxs]))
            parts[p]["series"][b] += move
            parts[p]["total"] += move
    grand = sum(p["total"] for p in parts.values()) or 1.0
    out = {}
    for p in PART_ORDER:
        s = parts[p]["series"]
        last, prev = s[-1], s[-2] if buckets >= 2 else 0.0
        out[p] = {
            "series": [round(v * 100, 3) for v in s],          # scale to readable "price"
            "total": round(parts[p]["total"] * 100, 3),
            "sharePct": round(parts[p]["total"] / grand * 100, 2),
            "changePct": round((last - prev) / prev * 100, 1) if prev > 1e-9 else 0.0,
            "price": round(last * 100, 3),
        }
    return out


def _hex(bgr):
    b, g, r = (int(max(0, min(255, c))) for c in bgr)
    return f"#{r:02x}{g:02x}{b:02x}"


def analyze_frames(frames, fps=2, start_seconds=0, cfg=None):
    """Detect+track players, run MediaPipe Pose per crop, return per-player body-part usage."""
    import cv2
    import torch
    from ultralytics import YOLO
    import supervision as sv
    import mediapipe as mp
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    cfg = cfg or {}
    buckets = cfg.get("buckets", 12)
    device = 0 if torch.cuda.is_available() else "cpu"
    model = YOLO(cfg.get("model", "yolov8n.pt"))
    tracker = sv.ByteTrack(frame_rate=int(fps))
    landmarker = vision.PoseLandmarker.create_from_options(
        vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=_ensure_pose_model()),
            running_mode=vision.RunningMode.IMAGE,
            num_poses=1,
        )
    )

    seqs = {}        # track_id -> [(frame_idx, world_landmarks)]
    colors = {}      # track_id -> [bgr torso samples]
    W = H = None
    n = 0
    for idx, fpath in enumerate(frames):
        img = cv2.imread(fpath)
        if img is None:
            continue
        n += 1
        H, W = img.shape[:2]
        res = model(img, classes=[0], conf=cfg.get("conf", 0.4), device=device, verbose=False)[0]
        det = tracker.update_with_detections(sv.Detections.from_ultralytics(res))
        for xyxy, tid in zip(det.xyxy, det.tracker_id):
            tid = int(tid)
            x1, y1, x2, y2 = (int(max(0, v)) for v in xyxy)
            crop = img[y1:y2, x1:x2]
            if crop.size == 0:
                continue
            th = y2 - y1
            torso = crop[int(th * 0.15): int(th * 0.5)]
            if torso.size:
                colors.setdefault(tid, []).append(torso.reshape(-1, 3).mean(axis=0))
            rgb = np.ascontiguousarray(cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
            res = landmarker.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb))
            if res.pose_world_landmarks:
                lm = np.array([[p.x, p.y, p.z] for p in res.pose_world_landmarks[0]], dtype=np.float32)
                seqs.setdefault(tid, []).append((idx, lm))
    landmarker.close()

    # team assignment via 2-means over mean jersey colour
    team_of = {}
    centers = None
    tids = [t for t in seqs if t in colors]
    if len(tids) >= 2:
        try:
            from sklearn.cluster import KMeans
            X = np.array([np.mean(colors[t], axis=0) for t in tids])
            km = KMeans(n_clusters=2, n_init=4, random_state=0).fit(X)
            centers = km.cluster_centers_
            for t, lab in zip(tids, km.labels_):
                team_of[t] = int(lab)
        except Exception:
            pass

    players = []
    for tid in sorted(seqs, key=lambda t: -len(seqs[t])):
        seq = seqs[tid]
        if len(seq) < 2:
            continue
        usage = compute_usage(seq, (0, max(1, n - 1)), buckets=buckets)
        team = team_of.get(tid)
        if centers is not None and team is not None:
            color = _hex(centers[team])
        elif tid in colors:
            color = _hex(np.mean(colors[tid], axis=0))
        else:
            color = "#888888"
        players.append({
            "trackId": tid,
            "tag": f"Player {len(players) + 1}",
            "team": team,
            "color": color,
            "framesSeen": len(seq),
            "totalMovement": round(sum(p["total"] for p in usage.values()), 2),
            "parts": usage,
        })

    return {
        "engine": "mediapipe",
        "fps": fps,
        "startSeconds": start_seconds,
        "frameCount": n,
        "frameSize": [W, H],
        "buckets": buckets,
        "partOrder": PART_ORDER,
        "players": players[: (cfg.get("maxPlayers", 24))],
    }
