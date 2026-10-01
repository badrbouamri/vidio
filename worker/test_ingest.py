import uuid

import ingest


def test_source_dir_accepts_a_uuid_object(tmp_path, monkeypatch):
    """Regression: main.py's project rows carry psycopg's uuid.UUID for
    `id`, not str. os.path.join (which source_dir used directly) rejects
    anything that isn't str/bytes/PathLike, so every ingest job crashed
    here immediately — the very first thing every job stage does,
    regardless of source type. See docs/DECISIONS.md."""
    monkeypatch.setattr(ingest, "STORAGE_DIR", str(tmp_path))
    project_id = uuid.uuid4()

    path = ingest.source_dir(project_id)

    assert path == str(tmp_path / str(project_id))
    assert (tmp_path / str(project_id)).is_dir()


def test_source_dir_still_accepts_a_plain_string(tmp_path, monkeypatch):
    monkeypatch.setattr(ingest, "STORAGE_DIR", str(tmp_path))

    path = ingest.source_dir("already-a-string")

    assert path == str(tmp_path / "already-a-string")
