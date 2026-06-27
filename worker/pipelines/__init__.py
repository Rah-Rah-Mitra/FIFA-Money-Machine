"""Pipeline registry. Each pipeline exposes run(ctx) -> {"result": dict, "confidence": float|None}.

Keep the ids here in sync with repo-root pipelines.json (the API reads that file).
"""
from dataclasses import dataclass

from . import video_metadata, playback_stats, player_tracking, match_model, mesh_pose, player_stats, mesh_scene, pose_scene, full_analysis


@dataclass
class Ctx:
    video_id: str
    config: dict
    api_base: str
    work_dir: str
    job_id: str = ""


REGISTRY = {
    "video_metadata": video_metadata.run,
    "playback_stats": playback_stats.run,
    "player_tracking": player_tracking.run,
    "match_model": match_model.run,
    "mesh_pose": mesh_pose.run,
    "player_stats": player_stats.run,
    "mesh_scene": mesh_scene.run,
    "pose_scene": pose_scene.run,
    "full_analysis": full_analysis.run,
}
