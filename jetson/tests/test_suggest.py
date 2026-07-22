import json
import os

import pytest

from gardener import notify, suggest
from gardener.config import Config

from mock_llama import MockLlama


@pytest.fixture
def scfg(git_vault, tmp_path):
    server = MockLlama().start()
    cfg = Config(
        path="/nonexistent",
        overrides={
            "VAULT_DIR": git_vault,
            "STATE_FILE": str(tmp_path / "state.json"),
            "LLAMA_URL": server.url,
            "NOTIFY_DIR": str(tmp_path / "notify"),
            "NTFY_TOPIC": "",  # queue only; delivery covered in test_notify
            "SUGGEST_MAX": "3",
            "LLM_TIMEOUT_SEC": "5",
        },
    )
    yield cfg, server
    server.stop()


SUGGESTIONS = json.dumps(
    [
        {"kind": "movie", "title": "Thief (1981)", "why": "Mann heist roots of Heat."},
        {"kind": "area", "title": "70s Paranoia Thrillers", "why": "Adjacent to noir taste."},
        {"kind": "movie", "title": "Heat (1995)", "why": "already seen — must be dropped"},
    ]
)


def test_validate_schema():
    items = suggest.validate(SUGGESTIONS, 4)
    assert len(items) == 3  # validate() doesn't know 'seen'; the prompt handles that
    assert items[0]["kind"] == "movie"
    assert suggest.validate("total garbage", 4) == []
    assert suggest.validate('{"not": "a list"}', 4) == []
    assert suggest.validate(json.dumps([{"kind": "movie"}]), 4) == []  # no title/why
    long = json.dumps([{"kind": "movie", "title": "x" * 200, "why": "y"}])
    assert suggest.validate(long, 4) == []


def test_run_writes_note_commits_and_queues(scfg, git_vault):
    cfg, server = scfg
    server.responses.append(SUGGESTIONS)
    res = suggest.run(cfg, today="2026-07-21")
    assert res["outcome"] == "suggested"
    assert res["count"] == 3
    note = os.path.join(git_vault, "wiki", "suggestions", "2026-07-21.md")
    assert os.path.isfile(note)
    text = open(note).read()
    assert "Thief (1981)" in text and "70s Paranoia Thrillers" in text
    from gardener.gitops import Git

    git = Git(git_vault)
    assert not git.dirty()
    assert "gardener(suggest): 3 suggestions" in git.log_since("", "--oneline")
    assert notify.pending_count(cfg) == 1
    # suggestions dir must NOT become gardener-editable pages
    from gardener.vaultio import Vault

    assert "2026-07-21" not in Vault(git_vault).pages()


def test_daily_guard(scfg):
    cfg, server = scfg
    server.responses.append(SUGGESTIONS)
    assert suggest.run(cfg, today="2026-07-21")["outcome"] == "suggested"
    assert suggest.run(cfg, today="2026-07-21")["outcome"] == "skipped"
    server.responses.append(SUGGESTIONS)
    assert suggest.run(cfg, today="2026-07-21", force=True)["outcome"] == "suggested"


def test_garbage_model_output_is_empty_not_fatal(scfg, git_vault):
    cfg, server = scfg
    server.responses.append("i have no idea what json is")
    res = suggest.run(cfg, today="2026-07-21")
    assert res["outcome"] == "empty"
    assert not os.path.exists(os.path.join(git_vault, "wiki", "suggestions"))
    assert notify.pending_count(cfg) == 0


def test_prompt_excludes_seen_and_watchlist(scfg):
    cfg, server = scfg
    server.responses.append("[]")
    suggest.run(cfg, today="2026-07-21", force=True)
    prompt = server.requests[0]["prompt"]
    # fixture watchlist has Thief (1981); pages include Heat
    assert "Thief (1981)" in prompt
    assert "Heat (1995)" in prompt
    assert "NEVER suggest" in prompt
