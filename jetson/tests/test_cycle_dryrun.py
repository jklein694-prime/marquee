"""Full daemon cycles against the fixture vault + mock llama-server."""
import json
import os

import pytest

from gardener.config import Config
from gardener import daemon
from gardener.gitops import Git
from gardener.vaultio import Vault
from gardener.workqueue import WorkQueue

from mock_llama import MockLlama


@pytest.fixture
def mock_llama():
    server = MockLlama().start()
    yield server
    server.stop()


@pytest.fixture
def cfg(git_vault, tmp_path, mock_llama):
    return Config(
        path="/nonexistent",
        overrides={
            "VAULT_DIR": git_vault,
            "QUEUE_DIR": str(tmp_path / "queue"),
            "STATE_FILE": str(tmp_path / "state.json"),
            "LLAMA_URL": mock_llama.url,
            "COOLDOWN_DAYS": "0",
            "LLM_TIMEOUT_SEC": "5",
        },
    )


def run(cfg, **kw):
    return daemon.run_once(cfg, **kw)


def test_valid_patch_applies_and_commits(cfg, git_vault, mock_llama):
    q = WorkQueue(cfg.queue_dir)
    q.enqueue(
        10,
        "dead_link",
        {"target": "Nonexistent Film (1999)", "where": "Collateral (2004).md"},
    )
    anchor = "Night-time LA hitman ride-along. See also [[Heat (1995)]] and [[Nonexistent Film (1999)]]."
    mock_llama.responses.append(
        json.dumps(
            {
                "action": "retarget_link",
                "file": "wiki/movies/Collateral (2004).md",
                "anchor": anchor,
                "target": "Heat (1995)",
                "reason": "closest existing page",
            }
        )
    )
    # model retargeted to an already-linked page; fine for mechanics
    result = run(cfg)
    assert result["outcome"] == "applied"
    assert result["action"] == "retarget_link"
    git = Git(git_vault)
    assert not git.dirty()
    log = git.log_since("", "--oneline")
    assert "gardener(dead_link): closest existing page" in log
    assert q.counts()["done"] == 1
    text = Vault(git_vault).read(
        os.path.join(git_vault, "wiki/movies/Collateral (2004).md")
    )
    assert "Nonexistent Film" not in text


def test_invalid_patch_never_writes(cfg, git_vault, mock_llama):
    q = WorkQueue(cfg.queue_dir)
    q.enqueue(10, "dead_link", {"target": "Nonexistent Film (1999)", "where": "Collateral (2004).md"})
    mock_llama.responses.append(
        json.dumps(
            {
                "action": "replace_line",
                "file": "../../etc/passwd",
                "anchor": "root",
                "text": "gotcha",
                "reason": "malicious",
            }
        )
    )
    git = Git(git_vault)
    head_before = git.head()
    result = run(cfg)
    assert result["outcome"] == "rejected"
    assert git.head() == head_before
    assert not git.dirty()
    failed = q.counts()["failed"]
    assert failed == 1
    # raw model output is preserved for the audit
    name = [n for n in os.listdir(os.path.join(cfg.queue_dir, "failed"))][0]
    item = json.load(open(os.path.join(cfg.queue_dir, "failed", name)))
    assert "raw_output" in item


def test_garbage_output_never_writes(cfg, git_vault, mock_llama):
    q = WorkQueue(cfg.queue_dir)
    q.enqueue(10, "dead_link", {"target": "Nonexistent Film (1999)", "where": "Collateral (2004).md"})
    mock_llama.responses.append("i am a small model and i forgot the schema")
    git = Git(git_vault)
    head_before = git.head()
    result = run(cfg)
    assert result["outcome"] == "rejected"
    assert git.head() == head_before
    assert q.counts()["failed"] == 1


def test_no_change_updates_state_without_commit(cfg, git_vault, mock_llama):
    q = WorkQueue(cfg.queue_dir)
    q.enqueue(50, "enrich", {"target": "Heat (1995)", "where": "wiki/movies/Heat (1995).md"})
    mock_llama.responses.append(
        json.dumps({"action": "no_change", "reason": "neighborhood already tight"})
    )
    git = Git(git_vault)
    head_before = git.head()
    result = run(cfg)
    assert result["outcome"] == "applied"
    assert result["action"] == "no_change"
    assert git.head() == head_before
    state = json.load(open(cfg.state_file))
    assert "wiki/movies/Heat (1995).md" in state
    assert q.counts()["done"] == 1


def test_empty_queue_refills_from_lint(cfg, mock_llama):
    # no items queued: the cycle lints, queues dead link + orphan + enrich,
    # then works the highest-priority one (the planted dead link)
    result = run(cfg)
    assert result["outcome"] == "applied"
    assert result["task"].split("-")[0] == "10"  # dead_link priority prefix
    q = WorkQueue(cfg.queue_dir)
    kinds = {item["type"] for _, item in q.pending()}
    assert "orphan" in kinds


def test_llama_down_skips_cleanly(cfg, mock_llama):
    mock_llama.stop()
    result = run(cfg)
    assert result["outcome"] == "skipped"
    assert "not healthy" in result["reason"]


def test_dirty_vault_recovered_by_commit(cfg, git_vault, mock_llama):
    with open(os.path.join(git_vault, "wiki", "log.md"), "a") as fh:
        fh.write("crash leftovers\n")
    run(cfg)
    git = Git(git_vault)
    assert not git.dirty()
    assert "gardener(recover)" in git.log_since("", "--oneline")


def test_daily_cap_enforced(cfg, git_vault, mock_llama):
    git = Git(git_vault)
    for i in range(cfg.max_changes_per_day):
        with open(os.path.join(git_vault, "wiki", "log.md"), "a") as fh:
            fh.write("line %d\n" % i)
        git.commit_all("gardener(enrich): filler %d" % i)
    result = run(cfg)
    assert result["outcome"] == "skipped"
    assert "cap" in result["reason"]


def test_autofix_takes_the_cycle(cfg, git_vault, mock_llama):
    v = Vault(git_vault)
    with open(v.hub, "a", encoding="utf-8") as fh:
        fh.write("\n- [[**Mangled**]]\n")
    git = Git(git_vault)
    git.commit_all("seed mangled link")
    result = run(cfg)
    assert result["outcome"] == "applied"
    assert result["task"] == "autofix"
    assert "[[Mangled]]" in v.read(v.hub)
    # no LLM call was made
    assert mock_llama.requests == []


def test_mechanical_revert_correction(cfg, git_vault, mock_llama):
    git = Git(git_vault)
    log_path = os.path.join(git_vault, "wiki", "log.md")
    with open(log_path, "a") as fh:
        fh.write("bad gardener line\n")
    sha = git.commit_all("gardener(enrich): bad change")
    q = WorkQueue(cfg.queue_dir)
    q.enqueue(
        0,
        "correction",
        {"target": "wiki/log.md", "instruction": "revert it", "kind": "revert", "sha": sha},
    )
    result = run(cfg)
    assert result["outcome"] == "applied"
    assert result["action"] == "revert"
    with open(log_path) as fh:
        assert "bad gardener line" not in fh.read()
    assert mock_llama.requests == []


def test_dry_run_makes_no_writes(cfg, git_vault, mock_llama):
    git = Git(git_vault)
    head_before = git.head()
    result = run(cfg, dry_run=True)
    assert result["outcome"] == "dry_run"
    assert any("dead wikilink" in i for i in result["lint_issues"])
    assert git.head() == head_before
    assert not git.dirty()
    assert WorkQueue(cfg.queue_dir).counts()["pending"] == 0


# -- generic (profile-less) vault cycles ------------------------------------------


@pytest.fixture
def generic_cfg(git_generic_vault, tmp_path, mock_llama):
    return Config(
        path="/nonexistent",
        overrides={
            "VAULT_DIR": git_generic_vault,
            "QUEUE_DIR": str(tmp_path / "gqueue"),
            "STATE_FILE": str(tmp_path / "gstate.json"),
            "LLAMA_URL": mock_llama.url,
            "COOLDOWN_DAYS": "0",
            "LLM_TIMEOUT_SEC": "5",
        },
    )


def test_generic_cycle_applies_without_hub_or_log(generic_cfg, git_generic_vault, mock_llama):
    """No hub, no log, no profile — the daemon must neither crash nor skip."""
    anchor = "Parsing feeds [[Type Systems]]. See [[Ideas]] and [[Ghost Note]]."
    mock_llama.responses.append(
        json.dumps(
            {
                "action": "retarget_link",
                "file": "notes/Compilers.md",
                "anchor": anchor,
                "target": "Type Systems",
                "reason": "closest existing page",
            }
        )
    )
    result = run(generic_cfg)  # empty queue -> refills from lint -> dead link first
    assert result["outcome"] == "applied"
    assert result["action"] == "retarget_link"
    git = Git(git_generic_vault)
    assert not git.dirty()
    assert "gardener(dead_link)" in git.log_since("", "--oneline")
    text = Vault(git_generic_vault).read(
        os.path.join(git_generic_vault, "notes", "Compilers.md")
    )
    assert "Ghost Note" not in text


def test_generic_system_prompt_has_no_movie_wording(generic_cfg, git_generic_vault, mock_llama):
    run(generic_cfg)
    prompt = mock_llama.requests[0]["prompt"]
    assert "movie" not in prompt.lower()
    assert "__VAULT_DESCRIPTION__" not in prompt


def test_description_token_injected_when_profiled(generic_cfg, git_generic_vault, mock_llama):
    with open(os.path.join(git_generic_vault, "gardener-vault.conf"), "w") as fh:
        fh.write('VAULT_DESCRIPTION="a lab notebook about compilers"\n')
    Git(git_generic_vault).commit_all("add profile")
    run(generic_cfg)
    assert "a lab notebook about compilers" in mock_llama.requests[0]["prompt"]


def test_generic_auto_stub_cycle(generic_cfg, git_generic_vault, mock_llama):
    mock_llama.responses.append(
        json.dumps(
            {
                "action": "create_stub",
                "target": "Ghost Note",
                "text": "Placeholder created for a dead link.",
                "reason": "the page is referenced but missing",
            }
        )
    )
    result = run(generic_cfg)
    assert result["outcome"] == "applied"
    assert result["action"] == "create_stub"
    stub = os.path.join(git_generic_vault, "notes", "Ghost Note.md")
    assert os.path.exists(stub)  # beside the page that links it
    assert not os.path.exists(os.path.join(git_generic_vault, ".vault-meta"))


def test_cli_run_once_and_status(cfg, capsys, monkeypatch, tmp_path):
    import gardener.__main__ as cli

    conf = tmp_path / "gardener.conf"
    conf.write_text(
        "\n".join(
            "%s=%s" % (k.upper(), getattr(cfg, k))
            for k in (
                "vault_dir",
                "queue_dir",
                "state_file",
                "llama_url",
                "cooldown_days",
            )
        )
    )
    rc = cli.main(["--conf", str(conf), "run-once", "--dry-run"])
    assert rc == 0
    out = json.loads(capsys.readouterr().out)
    assert out["outcome"] == "dry_run"

    rc = cli.main(["--conf", str(conf), "status"])
    assert rc == 0
    status = json.loads(capsys.readouterr().out)
    assert status["llama_healthy"] is True
    assert status["pages"] == 5
