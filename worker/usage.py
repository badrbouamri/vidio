"""
M7.2: usage metering (source-minutes-processed) and per-job cost logging
(NFR cost control). Cost estimation is pure/unit-tested; DB writes are kept
separate so the math can be tested without a live database.

Per-unit cost figures are rough estimates [ASSUMPTION], not pulled from a
live pricing API — see docs/DECISIONS.md.
"""

STT_COST_PER_MINUTE = 0.006  # OpenAI Whisper API
TTS_COST_PER_1K_CHARS = 0.015  # OpenAI tts-1
COMPUTE_COST_PER_MINUTE = 0.01  # rough render-worker compute estimate


def estimate_stt_cost(duration_s: float) -> float:
    return round((duration_s / 60) * STT_COST_PER_MINUTE, 6)


def estimate_tts_cost(char_count: int) -> float:
    return round((char_count / 1000) * TTS_COST_PER_1K_CHARS, 6)


def estimate_compute_cost(wall_clock_s: float) -> float:
    return round((wall_clock_s / 60) * COMPUTE_COST_PER_MINUTE, 6)


def record_source_minutes(conn, user_id: str, project_id: str, duration_s: float) -> None:
    """FR-42: usage metered in source-minutes-processed."""
    minutes = duration_s / 60
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO usage_events (user_id, project_id, type, minutes, credits) "
            "VALUES (%s, %s, 'source_processing', %s, 0)",
            (user_id, project_id, minutes),
        )
        cur.execute(
            "UPDATE users SET minutes_used_period = minutes_used_period + %s WHERE id = %s",
            (minutes, user_id),
        )
    conn.commit()


def record_dubbing_credits(conn, user_id: str, project_id: str, minutes: float) -> None:
    """FR-42: dubbing consumes extra credits, tracked separately from the
    source-minutes meter that gates new projects."""
    with conn.cursor() as cur:
        cur.execute(
            "INSERT INTO usage_events (user_id, project_id, type, minutes, credits) "
            "VALUES (%s, %s, 'dubbing', 0, %s)",
            (user_id, project_id, minutes),
        )
    conn.commit()


def record_job_cost(conn, job_id: str, cost_usd: float) -> None:
    """NFR cost control: per-job cost (STT/LLM/TTS/compute)."""
    if cost_usd <= 0:
        return
    with conn.cursor() as cur:
        cur.execute("UPDATE jobs SET cost_usd = cost_usd + %s WHERE id = %s", (cost_usd, job_id))
    conn.commit()
