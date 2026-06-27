"""GPU YOLO-pose engine. Full-frame multi-person 2D keypoints + ByteTrack IDs at higher fps than the
old MediaPipe-per-crop path (and it actually uses the GPU). Produces rich per-player metrics + a
position heatmap + compact per-frame keypoints for the client-side skeleton overlay."""
import numpy as np
import metrics as M


def _iou(a, b):
    ix1, iy1 = max(a[0], b[0]), max(a[1], b[1])
    ix2, iy2 = min(a[2], b[2]), min(a[3], b[3])
    inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
    ua = (a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter
    return inter / ua if ua > 0 else 0.0


def _hex(bgr):
    b, g, r = (int(max(0, min(255, c))) for c in bgr)
    return f"#{r:02x}{g:02x}{b:02x}"


def analyze(api_base, video_id, work_dir, cfg=None):
    import cv2
    import torch
    import ingest
    from ultralytics import YOLO
    import supervision as sv

    cfg = cfg or {}
    fps = cfg.get("fps", 10)
    start = cfg.get("startSeconds")
    buckets = cfg.get("buckets", 12)
    device = 0 if torch.cuda.is_available() else "cpu"

    frames = ingest.frames_for(
        api_base, video_id, f"{work_dir}/frames", fps=fps,
        max_seconds=cfg.get("maxSeconds", 20), start_seconds=start, height=cfg.get("height", 720),
    )
    model = YOLO(cfg.get("model", "yolo11s-pose.pt"))
    tracker = sv.ByteTrack(frame_rate=int(fps))

    seqs, colors = {}, {}
    W = H = None
    n = 0
    for idx, fp in enumerate(frames):
        img = cv2.imread(fp)
        if img is None:
            continue
        n += 1
        H, W = img.shape[:2]
        res = model(img, imgsz=cfg.get("imgsz", 960), conf=cfg.get("conf", 0.35), classes=[0], device=device, verbose=False)[0]
        if res.keypoints is None or res.boxes is None or len(res.boxes) == 0:
            continue
        kpts = res.keypoints.data.cpu().numpy()       # (N,17,3) x,y,conf
        oboxes = res.boxes.xyxy.cpu().numpy()         # (N,4)
        det = tracker.update_with_detections(sv.Detections.from_ultralytics(res))
        for xyxy, tid in zip(det.xyxy, det.tracker_id):
            tid = int(tid)
            j = int(np.argmax([_iou(xyxy, ob) for ob in oboxes]))  # match tracked box -> keypoints
            k = kpts[j]
            x1, y1, x2, y2 = (float(v) for v in xyxy)
            seqs.setdefault(tid, []).append({"f": idx, "kp": k[:, :2].astype(float), "c": k[:, 2].astype(float), "box": (x1, y1, x2 - x1, y2 - y1)})
            cy1, cy2 = int(y1 + (y2 - y1) * 0.2), int(y1 + (y2 - y1) * 0.5)
            crop = img[max(0, cy1):max(0, cy2), max(0, int(x1)):max(0, int(x2))]
            if crop.size:
                colors.setdefault(tid, []).append(crop.reshape(-1, 3).mean(0))

    # team assignment via 2-means on jersey colour
    team_of, centers = {}, None
    tids = [t for t in seqs if t in colors]
    if len(tids) >= 2:
        try:
            from sklearn.cluster import KMeans
            X = np.array([np.mean(colors[t], 0) for t in tids])
            km = KMeans(n_clusters=2, n_init=4, random_state=0).fit(X)
            centers = km.cluster_centers_
            for t, lab in zip(tids, km.labels_):
                team_of[t] = int(lab)
        except Exception:
            pass

    players, keypoints = [], {}
    GH, GW = 8, 12
    for tid in sorted(seqs, key=lambda t: -len(seqs[t])):
        seq = seqs[tid]
        if len(seq) < 2:
            continue
        a = M.analyze_track(seq, fps, buckets=buckets, frame_span=max(1, n - 1))
        heat = np.zeros((GH, GW))
        for s in seq:
            pel = (s["kp"][11] + s["kp"][12]) / 2
            gx = min(GW - 1, max(0, int(pel[0] / max(1, W) * GW)))
            gy = min(GH - 1, max(0, int(pel[1] / max(1, H) * GH)))
            heat[gy, gx] += 1
        if heat.max() > 0:
            heat = heat / heat.max()
        team = team_of.get(tid)
        color = _hex(centers[team]) if (centers is not None and team is not None) else (_hex(np.mean(colors[tid], 0)) if tid in colors else "#888888")
        a["metrics"]["screenTimePct"] = round(len(seq) / max(1, n) * 100, 1)
        players.append({
            "trackId": tid, "tag": f"Player {len(players) + 1}", "team": team, "color": color,
            "framesSeen": len(seq), "parts": a["parts"], "metrics": a["metrics"], "activity": a["activity"],
            "heat": [[round(v, 3) for v in row] for row in heat.tolist()],
        })
        keypoints[str(tid)] = [{
            "f": s["f"],
            "k": [[round(float(s["kp"][i][0] / max(1, W)), 4), round(float(s["kp"][i][1] / max(1, H)), 4), round(float(s["c"][i]), 2)] for i in range(17)],
        } for s in seq]

    players = players[: cfg.get("maxPlayers", 24)]
    keep = {str(p["trackId"]) for p in players}
    keypoints = {k: v for k, v in keypoints.items() if k in keep}
    M.work_rate(players)
    return {
        "engine": "yolo-pose", "fps": fps, "startSeconds": start or 0, "frameCount": n,
        "frameSize": [W, H], "buckets": buckets, "partOrder": M.PART_ORDER,
        "players": players, "keypoints": keypoints,
    }
