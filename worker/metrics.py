"""Rich per-player analytics from 2D pose keypoints (COCO-17), size-normalised by bbox so distant
players are treated fairly. Pure numpy — unit tested. Feeds the stock-market + Hudl-style UI."""
import numpy as np

# COCO-17: 0 nose,1-2 eyes,3-4 ears,5-6 shoulders,7-8 elbows,9-10 wrists,11-12 hips,13-14 knees,15-16 ankles
COCO_PARTS = {
    "head": [0, 1, 2, 3, 4],
    "torso": [5, 6, 11, 12],
    "left_arm": [5, 7, 9],
    "right_arm": [6, 8, 10],
    "left_leg": [11, 13, 15],
    "right_leg": [12, 14, 16],
}
PART_ORDER = ["head", "torso", "left_arm", "right_arm", "left_leg", "right_leg"]
CONF = 0.3


def _pelvis(kp):
    return (kp[11] + kp[12]) / 2.0


def _neck(kp):
    return (kp[5] + kp[6]) / 2.0


def analyze_track(seq, fps, buckets=12, frame_span=1):
    """seq: list of dicts {f:int, kp:(17,2) px, c:(17,) conf, box:(x,y,w,h) px} sorted by f.
    Returns {parts, metrics, activity}."""
    n = len(seq)
    parts = {p: {"series": [0.0] * buckets, "total": 0.0} for p in PART_ORDER}
    speeds, leans, stances, verticals = [], [], [], []
    distance = 0.0
    f0 = seq[0]["f"]
    span = max(1, frame_span)

    for i in range(1, n):
        a, b = seq[i - 1], seq[i]
        h = max(1e-3, (a["box"][3] + b["box"][3]) / 2.0)   # bbox height = body-length unit
        df = max(1, b["f"] - a["f"])
        bk = min(buckets - 1, int((b["f"] - f0) / span * buckets))
        # per-part usage (mean confident-keypoint displacement, in body-lengths)
        for p, idxs in COCO_PARTS.items():
            ds = []
            for k in idxs:
                if a["c"][k] > CONF and b["c"][k] > CONF:
                    ds.append(np.linalg.norm(b["kp"][k] - a["kp"][k]) / h)
            if ds:
                move = float(np.mean(ds)) / df
                parts[p]["series"][bk] += move
                parts[p]["total"] += move
        # pelvis speed (proxy) in body-lengths / second
        pa, pb = _pelvis(a["kp"]), _pelvis(b["kp"])
        step = np.linalg.norm(pb - pa) / h
        distance += step
        speeds.append(step / df * fps)
        if (pa[1] - pb[1]) / h / df * fps > 1.5:   # upward burst -> jump/header proxy
            verticals.append(1)

    # posture: torso lean from vertical (deg) + stance width
    for s in seq:
        kp, c, box = s["kp"], s["c"], s["box"]
        if c[5] > CONF and c[6] > CONF and c[11] > CONF and c[12] > CONF:
            v = _neck(kp) - _pelvis(kp)
            leans.append(abs(np.degrees(np.arctan2(v[0], -v[1]))))   # 0 = upright
        if c[15] > CONF and c[16] > CONF and box[2] > 1:
            stances.append(abs(kp[15][0] - kp[16][0]) / box[2])

    grand = sum(p["total"] for p in parts.values()) or 1.0
    steps = max(1, n - 1)
    half = buckets // 2
    part_out = {}
    for p in PART_ORDER:
        sser = parts[p]["series"]
        ca = sum(sser[:half]) / max(1, half)
        cb = sum(sser[half:]) / max(1, buckets - half)
        part_out[p] = {
            "series": [round(v * 100, 3) for v in sser],
            "total": round(parts[p]["total"] * 100, 3),
            "sharePct": round(parts[p]["total"] / grand * 100, 2),
            "changePct": round((cb - ca) / ca * 100, 1) if ca > 1e-9 else 0.0,
            "price": round(parts[p]["total"] / steps * 100, 3),
        }

    larm, rarm = parts["left_arm"]["total"], parts["right_arm"]["total"]
    lleg, rleg = parts["left_leg"]["total"], parts["right_leg"]["total"]
    left, right = larm + lleg, rarm + rleg
    sym = abs(left - right) / (left + right) if (left + right) > 1e-9 else 0.0
    sp = np.array(speeds) if speeds else np.array([0.0])
    sprint_thr = 2.0
    sprints = int(np.sum((sp[1:] > sprint_thr) & (sp[:-1] <= sprint_thr))) if len(sp) > 1 else int(sp[0] > sprint_thr)
    activity = [round(sum(parts[p]["series"][b] for p in PART_ORDER) * 100, 2) for b in range(buckets)]

    metrics = {
        "distance": round(distance, 2),                      # body-lengths travelled (pelvis)
        "avgSpeed": round(float(sp.mean()), 2),              # body-lengths / s
        "maxSpeed": round(float(sp.max()), 2),
        "sprints": sprints,
        "symmetryPct": round(sym * 100, 1),                  # 0 = balanced L/R
        "dominantSide": "left" if left >= right else "right",
        "leanDeg": round(float(np.mean(leans)), 1) if leans else 0.0,
        "stanceWidth": round(float(np.mean(stances)), 2) if stances else 0.0,
        "verticalActions": len(verticals),
        "totalMovement": round(grand * 100, 2),
    }
    return {"parts": part_out, "metrics": metrics, "activity": activity}


def work_rate(players):
    """Composite 0..100 'work rate' index, ranked across the players in this scene."""
    if not players:
        return
    d = np.array([p["metrics"]["distance"] for p in players]) + 1e-9
    m = np.array([p["metrics"]["totalMovement"] for p in players]) + 1e-9
    score = (d / d.max()) * 0.5 + (m / m.max()) * 0.5
    for p, s in zip(players, score):
        p["metrics"]["workRate"] = round(float(s) * 100, 1)
