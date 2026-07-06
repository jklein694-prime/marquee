"""Staleness-weighted random sampling — 'shuffle through everything in
random samples of connections' without re-churning the same notes.

state.json maps vault-relative path -> last-gardened epoch seconds (plus a
couple of daemon bookkeeping keys prefixed with '_'). Pages inside the
cooldown window are excluded entirely; the rest are drawn with weight
hours_stale ** 1.5, so the stalest notes dominate but everything keeps a
nonzero chance. The daily staleness sweep is the argmax over the same map.
"""
import json
import os
import random
import time

WEIGHT_EXP = 1.5


def load_state(path):
    try:
        with open(path, encoding="utf-8") as fh:
            return json.load(fh)
    except (IOError, ValueError):
        return {}


def save_state(path, state):
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(state, fh, indent=2, sort_keys=True)
    os.rename(tmp, path)


def touch(state, rel_path, now=None):
    state[rel_path] = int(now if now is not None else time.time())


def seed_state(vault, state, now=None):
    """First run: unknown pages inherit their file mtime as last-gardened."""
    now = now if now is not None else time.time()
    for name, path in vault.pages().items():
        rel = vault.relpath(path)
        if rel not in state:
            try:
                state[rel] = int(min(os.path.getmtime(path), now))
            except OSError:
                state[rel] = int(now)
    return state


def _candidates(vault, state, cooldown_days, now):
    cutoff = now - cooldown_days * 86400
    out = []
    for name, path in vault.pages().items():
        rel = vault.relpath(path)
        last = state.get(rel, 0)
        if last < cutoff:
            out.append((name, rel, last))
    return sorted(out)  # deterministic base order for seeded rng


def pick_page(vault, state, cooldown_days=3, now=None, rng=None):
    """(page name, rel path) or None if everything is inside the cooldown."""
    now = now if now is not None else time.time()
    rng = rng or random
    cands = _candidates(vault, state, cooldown_days, now)
    if not cands:
        return None
    weights = [
        max(1.0, (now - last) / 3600.0) ** WEIGHT_EXP for _, _, last in cands
    ]
    total = sum(weights)
    roll = rng.random() * total
    acc = 0.0
    for (name, rel, _), w in zip(cands, weights):
        acc += w
        if roll <= acc:
            return name, rel
    return cands[-1][0], cands[-1][1]


def stalest_page(vault, state, now=None):
    """(page name, rel path) with the oldest last-gardened stamp."""
    now = now if now is not None else time.time()
    cands = _candidates(vault, state, 0, now + 1)
    if not cands:
        return None
    name, rel, _ = min(cands, key=lambda c: c[2])
    return name, rel


def pick_neighbors(vault, state, name, k=3):
    """Up to k linked neighbors, least-recently-gardened first."""
    pages = vault.pages()
    near = [n for n in vault.neighborhood(name) if n in pages]
    near.sort(key=lambda n: state.get(vault.relpath(pages[n]), 0))
    return near[:k]
