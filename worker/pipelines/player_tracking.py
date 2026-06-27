"""Player detection + tracking on a highlight clip: YOLOv8 + ByteTrack, team colour clustering,
and a coarse position heatmap. Heavy deps imported lazily so the worker boots without them."""


def _team_color(img, xyxy):
    # mean BGR of the torso region (upper-middle of the bbox) as a cheap jersey descriptor.
    x1, y1, x2, y2 = [int(v) for v in xyxy]
    h = y2 - y1
    crop = img[y1 + int(h * 0.15): y1 + int(h * 0.5), x1:x2]
    if crop.size == 0:
        return [0.0, 0.0, 0.0]
    return crop.reshape(-1, 3).mean(axis=0).tolist()


def run(ctx):
    import cv2
    import numpy as np
    from ultralytics import YOLO
    import supervision as sv
    import ingest

    cfg = ctx.config or {}
    fps = cfg.get("fps", 2)
    max_seconds = cfg.get("maxSeconds", 60)
    grid_w, grid_h = cfg.get("gridW", 12), cfg.get("gridH", 8)

    frames = ingest.frames_for(ctx.api_base, ctx.video_id, f"{ctx.work_dir}/frames", fps=fps, max_seconds=max_seconds, start_seconds=cfg.get("startSeconds"))
    if not frames:
        return {"result": {"status": "no_frames"}, "confidence": None}

    model = YOLO(cfg.get("model", "yolov8n.pt"))  # default small; pass "yolov8x.pt" for accuracy
    tracker = sv.ByteTrack(frame_rate=int(fps))

    tracks: dict[int, dict] = {}
    colors: list[list[float]] = []
    color_owner: list[int] = []
    heat = np.zeros((grid_h, grid_w), dtype=float)
    H = W = None

    for idx, fpath in enumerate(frames):
        img = cv2.imread(fpath)
        if img is None:
            continue
        H, W = img.shape[:2]
        res = model(img, classes=[0], conf=cfg.get("conf", 0.4), verbose=False)[0]
        det = sv.Detections.from_ultralytics(res)
        det = tracker.update_with_detections(det)
        for xyxy, tid in zip(det.xyxy, det.tracker_id):
            tid = int(tid)
            x1, y1, x2, y2 = xyxy
            cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
            t = tracks.setdefault(tid, {"frames": 0, "path": [], "first": idx, "last": idx})
            t["frames"] += 1
            t["last"] = idx
            t["path"].append([round(float(cx), 1), round(float(cy), 1)])
            gx = min(grid_w - 1, int(cx / W * grid_w))
            gy = min(grid_h - 1, int(cy / H * grid_h))
            heat[gy, gx] += 1
            colors.append(_team_color(img, xyxy))
            color_owner.append(tid)

    # team assignment via 2-means over jersey colours (best-effort)
    team_of: dict[int, int] = {}
    if len(colors) >= 2:
        try:
            from sklearn.cluster import KMeans
            labels = KMeans(n_clusters=2, n_init=4, random_state=0).fit_predict(np.array(colors))
            from collections import Counter
            for tid in set(color_owner):
                votes = [int(labels[i]) for i, o in enumerate(color_owner) if o == tid]
                team_of[tid] = Counter(votes).most_common(1)[0][0]
        except Exception:
            pass

    def path_len(p):
        return float(sum(((p[i][0] - p[i - 1][0]) ** 2 + (p[i][1] - p[i - 1][1]) ** 2) ** 0.5 for i in range(1, len(p))))

    summary = sorted(
        (
            {
                "trackId": tid,
                "framesSeen": t["frames"],
                "team": team_of.get(tid),
                "pathLengthPx": round(path_len(t["path"]), 1),
                "lastCentroid": t["path"][-1] if t["path"] else None,
            }
            for tid, t in tracks.items()
        ),
        key=lambda r: -r["framesSeen"],
    )

    total = heat.sum() or 1.0
    result = {
        "framesProcessed": len(frames),
        "fps": fps,
        "frameSize": [W, H],
        "trackCount": len(tracks),
        "tracks": summary[: cfg.get("maxTracks", 40)],
        "heatmap": (heat / total).round(4).tolist(),  # normalized grid_h x grid_w (UI/mplsoccer can render)
        "note": "Highlights are cut/zoomed/multi-angle; tracks reset across shot boundaries. Pixel-space only.",
    }
    # confidence ~ how consistently players were tracked
    avg_frames = (sum(t["frames"] for t in tracks.values()) / len(tracks)) if tracks else 0
    confidence = round(min(1.0, avg_frames / max(1, len(frames))), 2)
    return {"result": result, "confidence": confidence}
