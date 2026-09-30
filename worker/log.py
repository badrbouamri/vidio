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
    return json.dumps(
        {"level": level, "event": event, "time": datetime.now(timezone.utc).isoformat(), **fields}
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
