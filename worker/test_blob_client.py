"""Stateless-worker refactor: blob_client is the worker's only path to the
private Blob store (via the Next.js /api/internal/blob proxy — no official
Vercel Blob client for Python). These mock requests.post/get the same way
test_main.py mocks trigger_internal_route's requests.post."""

import os

os.environ.setdefault("APP_BASE_URL", "http://localhost:3000")
os.environ.setdefault("WORKER_INTERNAL_SECRET", "test-secret")

import blob_client  # noqa: E402


class _FakeResponse:
    def __init__(self, json_body=None, content=b""):
        self._json = json_body or {}
        self._content = content

    def raise_for_status(self):
        pass

    def json(self):
        return self._json

    def iter_content(self, chunk_size):
        yield self._content

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_upload_posts_file_with_key_and_returns_stored_key(tmp_path, monkeypatch):
    src = tmp_path / "clip.wav"
    src.write_bytes(b"fake-audio-bytes")
    captured = {}

    def fake_post(url, headers=None, data=None, files=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        captured["data"] = data
        captured["files"] = files
        return _FakeResponse(json_body={"key": "dub-audio/clip-1.wav", "url": "https://x/dub-audio/clip-1.wav"})

    monkeypatch.setattr(blob_client.requests, "post", fake_post)

    key = blob_client.upload("dub-audio/clip-1.wav", str(src), "audio/wav")

    assert key == "dub-audio/clip-1.wav"
    assert captured["url"] == "http://localhost:3000/api/internal/blob"
    assert captured["headers"] == {"x-worker-secret": "test-secret"}
    assert captured["data"] == {"key": "dub-audio/clip-1.wav"}
    assert "file" in captured["files"]


def test_download_writes_response_bytes_to_dest_path(tmp_path, monkeypatch):
    dest = tmp_path / "source.mp4"
    captured = {}

    def fake_get(url, headers=None, params=None, timeout=None, stream=None):
        captured["url"] = url
        captured["params"] = params
        return _FakeResponse(content=b"fake-video-bytes")

    monkeypatch.setattr(blob_client.requests, "get", fake_get)

    result = blob_client.download("sources/proj-1/source.mp4", str(dest))

    assert result == str(dest)
    assert dest.read_bytes() == b"fake-video-bytes"
    assert captured["params"] == {"key": "sources/proj-1/source.mp4"}
