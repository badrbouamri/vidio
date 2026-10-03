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


class _FakeCursor:
    def __init__(self, fetchall_results):
        self._fetchall_results = fetchall_results
        self.executed = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.executed.append((" ".join(sql.split()), params))

    def fetchall(self):
        return self._fetchall_results.pop(0)


class _FakeConn:
    def __init__(self, fetchall_results):
        self._fetchall_results = fetchall_results
        self.committed = False
        self.cursors = []

    def cursor(self):
        cur = _FakeCursor(self._fetchall_results)
        self.cursors.append(cur)
        return cur

    def commit(self):
        self.committed = True


def test_requeue_stuck_jobs_requeues_running_jobs_past_the_timeout():
    """Crash recovery for the stateless worker (no Railway volume, no local
    state survives a container restart): a job left 'running' from a
    previous process is orphaned and must be requeued on startup so the
    pipeline actually resumes instead of hanging forever."""
    job_id, project_id = uuid.uuid4(), uuid.uuid4()
    conn = _FakeConn(fetchall_results=[[(job_id, project_id, "render")]])

    rows = main.requeue_stuck_jobs(conn)

    assert rows == [(job_id, project_id, "render")]
    assert conn.committed
    jobs_sql, jobs_params = conn.cursors[0].executed[0]
    assert "UPDATE jobs SET status = 'queued'" in jobs_sql
    assert "WHERE status = 'running' AND started_at <" in jobs_sql
    projects_sql, projects_params = conn.cursors[0].executed[1]
    assert "UPDATE projects SET status = 'queued'" in projects_sql
    assert projects_params == ([project_id],)


def test_requeue_stuck_jobs_skips_the_projects_update_when_nothing_is_stuck():
    conn = _FakeConn(fetchall_results=[[]])

    rows = main.requeue_stuck_jobs(conn)

    assert rows == []
    assert len(conn.cursors[0].executed) == 1  # no projects UPDATE issued
