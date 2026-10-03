import uuid

import blob_client
import ingest
from validation import ProbeInfo


def test_download_source_fetches_a_public_url_for_upload_sources(tmp_path, monkeypatch):
    """Stateless-worker refactor: every stage re-downloads the source fresh
    (no local file survives between stages/container restarts). "upload"
    sources are a public Blob URL set by /api/upload — fetched directly."""
    captured = {}

    def fake_download_upload(storage_key, dest_dir):
        captured["storage_key"] = storage_key
        captured["dest_dir"] = dest_dir
        return f"{dest_dir}/source"

    monkeypatch.setattr(ingest, "download_upload", fake_download_upload)
    project = {
        "id": uuid.uuid4(),
        "source_type": "upload",
        "storage_key": "https://example.public.blob.vercel-storage.com/abc",
    }

    path = ingest.download_source(project, str(tmp_path))

    assert path == f"{tmp_path}/source"
    assert captured["storage_key"] == project["storage_key"]


def test_download_source_uses_blob_client_for_youtube_sources(tmp_path, monkeypatch):
    """"youtube" sources are a private-store key (set by run(), after
    yt-dlp) — fetched via the internal blob proxy, not a plain HTTP GET."""
    captured = {}

    def fake_download(key, dest_path):
        captured["key"] = key
        captured["dest_path"] = dest_path
        return dest_path

    monkeypatch.setattr(blob_client, "download", fake_download)
    project = {
        "id": uuid.uuid4(),
        "source_type": "youtube",
        "storage_key": "sources/proj-1/source.mp4",
    }

    path = ingest.download_source(project, str(tmp_path))

    assert path == str(tmp_path / "source.mp4")
    assert captured["key"] == "sources/proj-1/source.mp4"


def test_run_uploads_youtube_download_to_blob_and_returns_its_key(tmp_path, monkeypatch):
    """Regression: a YouTube-ingested source used to be left as a bare local
    path on projects.storage_key — only the container that ran ingest could
    ever read it again. Confirm run() now uploads it and persists a Blob
    key instead, so transcribe/render (possibly in a different container
    after a redeploy) can still fetch it. See docs/DECISIONS.md."""
    monkeypatch.setattr(ingest, "STORAGE_DIR", str(tmp_path))
    local_video = tmp_path / "downloaded.mp4"
    local_video.write_bytes(b"fake-mp4-bytes")

    monkeypatch.setattr(ingest, "download_youtube", lambda url, dest_dir: str(local_video))
    monkeypatch.setattr(
        ingest, "probe", lambda path: ProbeInfo(duration_s=12.0, has_audio=True, has_video=True)
    )
    monkeypatch.setattr(ingest, "validate_probe", lambda info: None)

    captured = {}

    def fake_upload(key, path, content_type):
        captured["key"] = key
        captured["path"] = path
        captured["content_type"] = content_type
        return "sources/proj-1/source.mp4"

    monkeypatch.setattr(blob_client, "upload", fake_upload)

    project_id = uuid.uuid4()
    result = ingest.run(
        {"id": project_id, "source_type": "youtube", "source_url": "https://youtu.be/x"}
    )

    assert result == {"duration_s": 12.0, "storage_key": "sources/proj-1/source.mp4"}
    assert captured["key"] == f"sources/{project_id}/source.mp4"
    assert captured["path"] == str(local_video)
    assert captured["content_type"] == "video/mp4"


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
