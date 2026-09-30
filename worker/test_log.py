import json

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
