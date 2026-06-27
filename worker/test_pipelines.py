"""Dependency-free self-check for the pure pipeline logic.  Run: python test_pipelines.py"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from pipelines.match_model import poisson_scoreline, _rates_from_matches
from pipelines.mesh_pose import link_iou, kinematics, _iou
from analyze_players import compute_usage, PART_ORDER


def test_poisson():
    p = poisson_scoreline(1.6, 1.0)
    total = p["pHomeWin"] + p["pDraw"] + p["pAwayWin"]
    assert abs(total - 1.0) < 1e-3, total
    assert p["pHomeWin"] > p["pAwayWin"]  # higher home xG => more likely home win
    assert "mostLikelyScore" in p


def test_rates_from_matches():
    matches = [
        {"home": "A", "away": "B", "homeGoals": 3, "awayGoals": 0},
        {"home": "B", "away": "A", "homeGoals": 1, "awayGoals": 2},
    ]
    lh, la = _rates_from_matches(matches, "A", "B")
    assert lh > la, (lh, la)  # A clearly stronger


def test_iou_and_tracking():
    assert _iou([0, 0, 10, 10], [0, 0, 10, 10]) == 1.0
    assert _iou([0, 0, 10, 10], [100, 100, 110, 110]) == 0.0
    dets = [
        {"frame": 0, "bbox": [0, 0, 10, 20], "cam": [0, 0, 0], "joints_body": [[0, 0, 0]]},
        {"frame": 1, "bbox": [1, 0, 11, 20], "cam": [1, 0, 0], "joints_body": [[0, 0, 0]]},
        {"frame": 0, "bbox": [50, 50, 60, 70], "cam": [5, 5, 5], "joints_body": [[0, 0, 0]]},
    ]
    tracks = link_iou(dets)
    assert len(tracks) == 2, tracks  # two distinct players
    stats = kinematics(tracks, fps=2)
    moving = next(s for s in stats if s["framesSeen"] == 2)
    assert moving["camPathLength"] > 0


def test_body_usage():
    import numpy as np
    # only the right arm moves -> it should hold ~100% of usage share.
    moving = [11, 13, 15, 17, 19, 21, 12, 14, 16, 18, 20, 22]  # arm landmarks
    a = np.zeros((33, 3), dtype=float)
    b = np.zeros((33, 3), dtype=float)
    for k in [12, 14, 16, 18, 20, 22]:  # right arm only
        b[k] = [0.3, 0, 0]
    u = compute_usage([(0, a), (5, b)], (0, 5), buckets=4)
    assert len(u["right_arm"]["series"]) == 4
    assert u["right_arm"]["sharePct"] > u["left_arm"]["sharePct"]
    assert u["right_arm"]["total"] > 0
    assert set(u.keys()) == set(PART_ORDER)


if __name__ == "__main__":
    test_poisson()
    test_rates_from_matches()
    test_iou_and_tracking()
    test_body_usage()
    print("ok: all worker self-checks passed")
