import os

from retention import RETENTION_SECONDS, sweep_old_source_files


def _make_project_dir(base, project_id, mtime):
    path = os.path.join(base, project_id)
    os.makedirs(path)
    with open(os.path.join(path, "source.mp4"), "w") as f:
        f.write("x")
    os.utime(path, (mtime, mtime))
    return path


def test_removes_directories_older_than_retention_window(tmp_path):
    now = 1_700_000_000.0
    old_dir = _make_project_dir(str(tmp_path), "old-project", now - RETENTION_SECONDS - 10)
    _make_project_dir(str(tmp_path), "fresh-project", now - 60)

    removed = sweep_old_source_files(str(tmp_path), now=now)

    assert removed == ["old-project"]
    assert not os.path.exists(old_dir)
    assert os.path.exists(os.path.join(str(tmp_path), "fresh-project"))


def test_keeps_directories_within_the_window(tmp_path):
    now = 1_700_000_000.0
    _make_project_dir(str(tmp_path), "recent", now - RETENTION_SECONDS + 3600)

    removed = sweep_old_source_files(str(tmp_path), now=now)

    assert removed == []
    assert os.path.exists(os.path.join(str(tmp_path), "recent"))


def test_boundary_at_exactly_the_retention_window_is_removed(tmp_path):
    now = 1_700_000_000.0
    _make_project_dir(str(tmp_path), "boundary", now - RETENTION_SECONDS)

    removed = sweep_old_source_files(str(tmp_path), now=now)

    assert removed == ["boundary"]


def test_ignores_stray_files_at_the_top_level(tmp_path):
    with open(os.path.join(str(tmp_path), "not-a-project-dir.txt"), "w") as f:
        f.write("x")

    removed = sweep_old_source_files(str(tmp_path), now=1_700_000_000.0)

    assert removed == []


def test_returns_empty_list_when_storage_dir_does_not_exist(tmp_path):
    missing = os.path.join(str(tmp_path), "does-not-exist")
    assert sweep_old_source_files(missing) == []
