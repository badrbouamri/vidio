import json
import uuid

import log


def test_info_writes_one_parseable_json_line(capsys):
    log.info("test.event", foo="bar")
    out = capsys.readouterr().out.strip()
    parsed = json.loads(out)
    assert parsed["level"] == "info"
    assert parsed["event"] == "test.event"
    assert parsed["foo"] == "bar"
    assert "time" in parsed


def test_error_includes_exception_message_and_traceback(capsys):
    try:
        raise ValueError("boom")
    except ValueError as exc:
        log.error("test.failure", exc, job_id="j1")

    err = capsys.readouterr().err.strip()
    parsed = json.loads(err)
    assert parsed["level"] == "error"
    assert parsed["error"] == "boom"
    assert "ValueError" in parsed["traceback"]
    assert parsed["job_id"] == "j1"


def test_warn_goes_to_stderr(capsys):
    log.warn("test.warning", note="careful")
    err = capsys.readouterr().err.strip()
    parsed = json.loads(err)
    assert parsed["level"] == "warn"
    assert parsed["note"] == "careful"


def test_error_does_not_crash_on_uuid_fields(capsys):
    """Regression: main.py's row dicts carry psycopg's uuid.UUID for
    job_id/project_id/etc, not str — plain json.dumps() raises on those,
    which previously took the *exception handler itself* down, crashing
    the whole worker instead of just failing one job. See
    docs/DECISIONS.md."""
    job_id = uuid.uuid4()
    try:
        raise ValueError("boom")
    except ValueError as exc:
        log.error("test.failure", exc, job_id=job_id)

    err = capsys.readouterr().err.strip()
    parsed = json.loads(err)
    assert parsed["job_id"] == str(job_id)
