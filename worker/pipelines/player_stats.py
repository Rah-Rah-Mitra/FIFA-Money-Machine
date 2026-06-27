"""Fast per-player body-part usage stats via MediaPipe Pose (no PEAR / no GPU needed).
Feeds the stock-market UI."""


def run(ctx):
    import ingest
    import analyze_players

    cfg = ctx.config or {}
    fps = cfg.get("fps", 3)
    start = cfg.get("startSeconds")
    play = ingest.get_play_url(ctx.api_base, ctx.video_id)
    frames = ingest.extract_frames(play, f"{ctx.work_dir}/frames", fps=fps, max_seconds=cfg.get("maxSeconds", 20), start_seconds=start)
    stats = analyze_players.analyze_frames(frames, fps=fps, start_seconds=start or 0, cfg=cfg)

    players = stats["players"]
    conf = 0.0
    if players and stats["frameCount"]:
        avg = sum(p["framesSeen"] for p in players) / len(players)
        conf = round(min(1.0, avg / stats["frameCount"]), 2)
    return {"result": {**stats, "kind": "player_stats"}, "confidence": conf}
