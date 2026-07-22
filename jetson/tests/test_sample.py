import random
import time

from gardener import sample
from gardener.vaultio import Vault


NOW = 1_800_000_000  # fixed 'now' so weights are deterministic


def seeded_state(vault, ages_hours):
    """{page name -> hours since gardened} -> state dict"""
    pages = vault.pages()
    state = {}
    for name, hours in ages_hours.items():
        state[vault.relpath(pages[name])] = NOW - int(hours * 3600)
    return state


def test_cooldown_excludes_recent(fixture_vault):
    v = Vault(fixture_vault)
    ages = {name: 1 for name in v.pages()}  # everything touched 1h ago
    state = seeded_state(v, ages)
    assert sample.pick_page(v, state, cooldown_days=3, now=NOW) is None


def test_stale_pages_dominate(fixture_vault):
    v = Vault(fixture_vault)
    ages = {name: 80 for name in v.pages()}
    ages["Solaris (1972)"] = 24 * 365  # a year stale
    state = seeded_state(v, ages)
    rng = random.Random(42)
    picks = [
        sample.pick_page(v, state, cooldown_days=3, now=NOW, rng=rng)[0]
        for _ in range(200)
    ]
    assert picks.count("Solaris (1972)") > 150
    # but the fresh-ish pages keep nonzero mass
    assert len(set(picks)) > 1


def test_stalest_page_is_argmax(fixture_vault):
    v = Vault(fixture_vault)
    ages = {name: 100 for name in v.pages()}
    ages["Crime"] = 5000
    state = seeded_state(v, ages)
    assert sample.stalest_page(v, state, now=NOW)[0] == "Crime"


def test_neighbors_least_recently_gardened_first(fixture_vault):
    v = Vault(fixture_vault)
    ages = {name: 10 for name in v.pages()}
    ages["Neo-noir"] = 9000
    ages["Crime"] = 500
    state = seeded_state(v, ages)
    neighbors = sample.pick_neighbors(v, state, "Heat (1995)", k=2)
    assert neighbors[0] == "Neo-noir"
    assert len(neighbors) == 2


def test_seed_state_uses_mtime_and_is_idempotent(fixture_vault):
    v = Vault(fixture_vault)
    state = {}
    sample.seed_state(v, state, now=time.time())
    assert len(state) == len(v.pages())
    marker = dict(state)
    sample.seed_state(v, state, now=time.time() + 999)
    assert state == marker  # existing stamps never overwritten


def test_state_roundtrip(tmp_path):
    path = str(tmp_path / "state.json")
    state = {"wiki/movies/Heat (1995).md": 123, "_last_log_date": "2026-07-06"}
    sample.save_state(path, state)
    assert sample.load_state(path) == state
    assert sample.load_state(str(tmp_path / "missing.json")) == {}
