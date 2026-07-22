import os

from gardener.gitops import Git


def test_init_and_commit_cycle(tmp_path):
    g = Git(str(tmp_path))
    assert not g.is_repo()
    g.init()
    assert g.is_repo()
    (tmp_path / "a.md").write_text("hello")
    assert g.dirty()
    sha = g.commit_all("gardener(test): first")
    assert sha and not g.dirty()
    # no-op commit returns empty
    assert g.commit_all("gardener(test): nothing") == ""


def test_commits_since_midnight_counts(git_vault):
    g = Git(git_vault)
    before = g.commits_since_midnight()
    with open(os.path.join(git_vault, "wiki", "log.md"), "a") as fh:
        fh.write("x\n")
    g.commit_all("gardener(enrich): note")
    assert g.commits_since_midnight() == before + 1


def test_tags_and_log_since(git_vault):
    g = Git(git_vault)
    g.tag("audit/2026-07-01")
    with open(os.path.join(git_vault, "wiki", "log.md"), "a") as fh:
        fh.write("y\n")
    g.commit_all("gardener(enrich): after tag")
    g.tag("audit/2026-07-06")
    assert g.latest_tag("audit/") == "audit/2026-07-06"
    log = g.log_since("audit/2026-07-01", "--oneline")
    assert "after tag" in log


def test_revert(git_vault):
    g = Git(git_vault)
    log_path = os.path.join(git_vault, "wiki", "log.md")
    with open(log_path, "a") as fh:
        fh.write("bad line\n")
    sha = g.commit_all("gardener(enrich): bad change")
    g.revert(sha)
    with open(log_path) as fh:
        assert "bad line" not in fh.read()


def test_config_parsing(tmp_path):
    from gardener.config import Config

    conf = tmp_path / "gardener.conf"
    conf.write_text(
        "# comment\n"
        "INTERVAL_MIN=30\n"
        'VAULT_DIR="/tmp/somewhere"\n'
        "TEMPERATURE=0.7\n"
        "UNKNOWN_KEY=ignored\n"
    )
    c = Config(path=str(conf))
    assert c.interval_min == 30
    assert c.vault_dir == "/tmp/somewhere"
    assert abs(c.temperature - 0.7) < 1e-9
    assert c.max_changes_per_day == 40  # default preserved
    assert not hasattr(c, "unknown_key")


def test_config_defaults_when_file_missing():
    from gardener.config import Config

    c = Config(path="/nonexistent/gardener.conf")
    assert c.interval_min == 15
    assert c.llama_url == "http://127.0.0.1:8080"
