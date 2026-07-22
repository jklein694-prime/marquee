import os
import shutil
import subprocess
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
JETSON = os.path.dirname(TESTS)
REPO = os.path.dirname(JETSON)
PAYLOAD = os.path.join(JETSON, "payload")
VAULT_TEMPLATE = os.path.join(REPO, "vault-template")

# the gardener package lives in jetson/payload/ (on-device: /opt/wikigardener)
sys.path.insert(0, PAYLOAD)


HEAT = """---
type: entity
title: "Heat (1995)"
entity_type: movie
address: c-000001
year: 1995
genres: ["[[Crime]]", "[[Neo-noir]]"]
verdict: loved
rating: 9
created: 2026-07-01
updated: 2026-07-01
tags:
  - movie
status: seen
---

# Heat (1995)

Cat-and-mouse between [[Collateral (2004)]]'s director's earlier masterpiece leads.
Belongs with [[Crime]] and [[Neo-noir]].
"""

COLLATERAL = """---
type: entity
title: "Collateral (2004)"
entity_type: movie
address: c-000002
year: 2004
genres: ["[[Crime]]"]
verdict: liked
rating: 8
created: 2026-07-02
updated: 2026-07-02
tags:
  - movie
status: seen
---

# Collateral (2004)

Night-time LA hitman ride-along. See also [[Heat (1995)]] and [[Nonexistent Film (1999)]].
"""

# orphan: nothing links to it
SOLARIS = """---
type: entity
title: "Solaris (1972)"
entity_type: movie
address: c-000003
year: 1972
genres: []
verdict: meh
rating: 6
created: 2026-07-03
updated: 2026-07-03
tags:
  - movie
status: seen
---

# Solaris (1972)

Slow-burn Soviet sci-fi. No links out either.
"""

CRIME = """---
type: entity
title: "Crime"
entity_type: category
address: c-000004
created: 2026-07-01
updated: 2026-07-02
tags:
  - category
---

# Crime

Pattern: loves — 2 of 2 rated 8+.

- [[Heat (1995)]] — loved, 9/10
- [[Collateral (2004)]] — liked, 8/10
"""

NEO_NOIR = """---
type: entity
title: "Neo-noir"
entity_type: category
address: c-000005
created: 2026-07-01
updated: 2026-07-01
tags:
  - category
---

# Neo-noir

Pattern: loves — 1 of 1 rated 9+.

- [[Heat (1995)]] — loved, 9/10
"""


def write(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        fh.write(text)


def populate_fixture_vault(root):
    """vault-template + a few pages with a planted dead link and an orphan.

    Gets the marquee-movies profile installed, exactly as install.sh does —
    the movie rules are profile-driven now.
    """
    shutil.copytree(VAULT_TEMPLATE, root)
    shutil.copy(
        os.path.join(PAYLOAD, "profiles", "marquee-movies.conf"),
        os.path.join(root, "gardener-vault.conf"),
    )
    movies = os.path.join(root, "wiki", "movies")
    genres = os.path.join(movies, "genres")
    write(os.path.join(movies, "Heat (1995).md"), HEAT)
    write(os.path.join(movies, "Collateral (2004).md"), COLLATERAL)
    write(os.path.join(movies, "Solaris (1972).md"), SOLARIS)
    write(os.path.join(genres, "Crime.md"), CRIME)
    write(os.path.join(genres, "Neo-noir.md"), NEO_NOIR)
    # hub gains taste + watchlist bullets (one taste bullet unlinked on purpose)
    hub = os.path.join(root, "wiki", "entities", "Movies.md")
    with open(hub, "r", encoding="utf-8") as fh:
        text = fh.read()
    text = text.replace(
        "- (empty — your tastes fill in here as you log movies and the expert mines patterns)",
        "- Loves tense two-hander thrillers — [[Crime]], [[Neo-noir]]\n"
        "- Prefers practical effects over CGI",
    )
    text = text.replace(
        "- (empty — titles you want to see land here)",
        "- [[Thief (1981)]] — Mann completionism",
    )
    with open(hub, "w", encoding="utf-8") as fh:
        fh.write(text)
    return root


@pytest.fixture
def fixture_vault(tmp_path):
    root = str(tmp_path / "vault")
    return populate_fixture_vault(root)


GENERIC_FILES = {
    # nested folders, cross-folder links, a dead link, an orphan, and a
    # duplicate basename ("Ideas" in two folders). No hub, no log, no profile.
    "notes/Compilers.md": (
        "---\ntitle: Compilers\n---\n\n# Compilers\n\n"
        "Parsing feeds [[Type Systems]]. See [[Ideas]] and [[Ghost Note]].\n"
    ),
    "notes/Type Systems.md": (
        "---\ntitle: Type Systems\n---\n\n# Type Systems\n\n"
        "Inference builds on [[Compilers]].\n"
    ),
    "notes/projects/Ideas.md": "# Ideas (projects)\n\n- build a wiki gardener\n",
    "journal/Ideas.md": "# Ideas (journal duplicate)\n",
    "journal/2026-07-01.md": "# July 1\n\nWrote about [[Compilers]] today.\n",
    "recipes/Bread.md": "# Bread\n\nNo links in or out. An orphan.\n",
    "_templates/draft.md": "# template — not a page\n",
    ".obsidian/plugin.md": "not a page either\n",
}


def populate_generic_vault(root):
    for rel, text in GENERIC_FILES.items():
        write(os.path.join(root, rel), text)
    return root


@pytest.fixture
def generic_vault(tmp_path):
    root = str(tmp_path / "gvault")
    return populate_generic_vault(root)


@pytest.fixture
def git_generic_vault(generic_vault):
    env = dict(
        os.environ,
        GIT_AUTHOR_NAME="test",
        GIT_AUTHOR_EMAIL="t@t",
        GIT_COMMITTER_NAME="test",
        GIT_COMMITTER_EMAIL="t@t",
    )
    for cmd in (
        ["git", "init", "-q"],
        ["git", "add", "-A"],
        ["git", "commit", "-q", "-m", "seed"],
    ):
        subprocess.check_call(cmd, cwd=generic_vault, env=env)
    return generic_vault


@pytest.fixture
def git_vault(fixture_vault):
    """fixture vault initialized as a git repo with one commit."""
    env = dict(
        os.environ,
        GIT_AUTHOR_NAME="test",
        GIT_AUTHOR_EMAIL="t@t",
        GIT_COMMITTER_NAME="test",
        GIT_COMMITTER_EMAIL="t@t",
    )
    for cmd in (
        ["git", "init", "-q"],
        ["git", "add", "-A"],
        ["git", "commit", "-q", "-m", "seed"],
    ):
        subprocess.check_call(cmd, cwd=fixture_vault, env=env)
    return fixture_vault
