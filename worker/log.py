"""
M8.2: structured logs (the other half — Sentry — is blocked; see
docs/DECISIONS.md). One JSON line per event on stdout so any log
drain/aggregator can parse it without a schema.
"""

import json
import sys
import traceback
from datetime import datetime, timezone


def _line(level: str, event: str, **fields) -> str:
    # default=str: callers often pass psycopg row values straight through
    # (job_id, project_id, clip_id are uuid.UUID, not str) — without this,
    # a single non-JSON-serializable field here raises and takes the
    # exception handler calling log.error() down with it, crashing the
    # whole worker instead of just failing the one job (see
    # docs/DECISIONS.md).
    return json.dumps(
        {"level": level, "event": event, "time": datetime.now(timezone.utc).isoformat(), **fields},
        default=str,
    )


def info(event: str, **fields) -> None:
    print(_line("info", event, **fields))


def warn(event: str, **fields) -> None:
    print(_line("warn", event, **fields), file=sys.stderr)


def error(event: str, exc: BaseException, **fields) -> None:
    print(
        _line(
            "error",
            event,
            error=str(exc),
            traceback=traceback.format_exc(),
            **fields,
        ),
        file=sys.stderr,
    )
