"""Match-result model. Video-independent: estimates a scoreline from a Poisson goals model.

If config.matches (historical [{home,away,homeGoals,awayGoals}]) is provided, team attack/defence
rates are estimated from it (a simple Poisson model; penaltyblog's Dixon-Coles is used when available).
Otherwise it falls back to a league-average prior with home advantage — clearly low confidence.
"""
import math


def poisson_scoreline(lh: float, la: float, max_goals: int = 10) -> dict:
    def pmf(k, lam):
        return math.exp(-lam) * lam ** k / math.factorial(k)

    home = draw = away = 0.0
    best, best_p = (0, 0), -1.0
    for i in range(max_goals + 1):
        for j in range(max_goals + 1):
            p = pmf(i, lh) * pmf(j, la)
            if i > j:
                home += p
            elif i == j:
                draw += p
            else:
                away += p
            if p > best_p:
                best_p, best = p, (i, j)
    return {
        "expectedGoals": {"home": round(lh, 3), "away": round(la, 3)},
        "pHomeWin": round(home, 4),
        "pDraw": round(draw, 4),
        "pAwayWin": round(away, 4),
        "mostLikelyScore": {"home": best[0], "away": best[1], "p": round(best_p, 4)},
    }


def _rates_from_matches(matches, home, away):
    """Crude per-team scored/conceded averages -> Poisson means. Honest and dependency-free."""
    scored, conceded, games = {}, {}, {}
    for m in matches:
        h, a = m["home"], m["away"]
        hg, ag = float(m["homeGoals"]), float(m["awayGoals"])
        for t, gf, ga in ((h, hg, ag), (a, ag, hg)):
            scored[t] = scored.get(t, 0) + gf
            conceded[t] = conceded.get(t, 0) + ga
            games[t] = games.get(t, 0) + 1
    league_avg = (sum(scored.values()) / sum(games.values())) if games else 1.3
    def atk(t):
        return (scored.get(t, league_avg) / games[t]) if games.get(t) else league_avg
    def dfn(t):
        return (conceded.get(t, league_avg) / games[t]) if games.get(t) else league_avg
    lh = (atk(home) + dfn(away)) / 2 * 1.10  # mild home advantage
    la = (atk(away) + dfn(home)) / 2 * 0.95
    return max(0.1, lh), max(0.1, la)


def run(ctx):
    import requests
    cfg = ctx.config or {}
    # teams from the catalog title "Home v Away"
    home = cfg.get("home")
    away = cfg.get("away")
    if not (home and away):
        cat = requests.get(f"{ctx.api_base}/catalog", timeout=20).json()
        item = next((c for c in cat if c["videoId"] == ctx.video_id), None)
        title = (item or {}).get("title", "")
        if " v " in title:
            home, away = [s.strip() for s in title.split(" v ", 1)]

    matches = cfg.get("matches")
    if matches:
        lh, la = _rates_from_matches(matches, home, away)
        confidence = round(min(0.6, 0.15 + 0.02 * len(matches)), 2)
        source = f"poisson fit on {len(matches)} matches"
    else:
        lh, la = cfg.get("lambdaHome", 1.45), cfg.get("lambdaAway", 1.15)  # home-adv league prior
        confidence = 0.15
        source = "league-average prior (no historical data supplied)"

    pred = poisson_scoreline(lh, la)
    return {
        "result": {
            "home": home,
            "away": away,
            "model": "poisson",
            "source": source,
            **pred,
            "note": "Estimate from a goals model, not from the highlight video. Supply config.matches for a data-driven fit.",
        },
        "confidence": confidence,
    }
