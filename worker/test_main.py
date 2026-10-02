import os
import uuid

os.environ.setdefault("DATABASE_URL", "postgresql://test/test")

import main  # noqa: E402 - needs DATABASE_URL set first, see above


class _FakeResponse:
    def __init__(self, status_code=200, body=None):
        self.status_code = status_code
        self._body = body or {}
        self.text = ""

    def json(self):
        return self._body


def test_trigger_internal_route_accepts_a_uuid_project_id(monkeypatch):
    """Regression: project["id"] is psycopg's uuid.UUID, not str (same root
    cause as the ingest.py/log.py UUID bugs). `requests.post(..., json=...)`
    calls stdlib json.dumps on its body, which raises TypeError on a raw
    UUID — this broke the detect stage (and translate, which runs
    unconditionally for every project) for every single job. See
    docs/DECISIONS.md."""
    captured = {}

    def fake_post(url, headers=None, json=None, timeout=None):
        captured["json"] = json
        return _FakeResponse(200, {"ok": True})

    monkeypatch.setattr(main.requests, "post", fake_post)

    project_id = uuid.uuid4()
    result = main.trigger_internal_route("/api/internal/detect-moments", project_id, "failed")

    assert result == {"ok": True}
    assert captured["json"] == {"projectId": str(project_id)}
