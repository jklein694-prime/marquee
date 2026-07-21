import os

from gardener.lint import autofix_text, autofix_vault, lint_report, lint_vault
from gardener.vaultio import Vault


def kinds(issues):
    return {(i["kind"], i["target"]) for i in issues}


def test_lint_finds_planted_issues(fixture_vault):
    v = Vault(fixture_vault)
    issues = lint_vault(v)
    ks = kinds(issues)
    # planted in conftest: dead link in Collateral, orphan Solaris,
    # one taste bullet without links
    assert ("dead_link", "Nonexistent Film (1999)") in ks
    assert ("orphan", "Solaris (1972)") in ks
    assert any(k == "taste_unlinked" for k, _ in ks)


def test_watchlist_titles_not_dead_links(fixture_vault):
    v = Vault(fixture_vault)
    ks = kinds(lint_vault(v))
    # [[Thief (1981)]] is a watchlist bullet with no page — legitimately pageless
    assert ("dead_link", "Thief (1981)") not in ks


def test_linked_pages_not_orphans(fixture_vault):
    v = Vault(fixture_vault)
    ks = kinds(lint_vault(v))
    assert ("orphan", "Heat (1995)") not in ks
    assert ("orphan", "Crime") not in ks


def test_report_matches_lint_ts_format(fixture_vault):
    v = Vault(fixture_vault)
    report = lint_report(v)
    assert "dead wikilink [[Nonexistent Film (1999)]] in Collateral (2004).md" in report
    assert "orphan page (no inbound links): Solaris (1972).md" in report


def test_dedup_and_cap(fixture_vault):
    v = Vault(fixture_vault)
    # plant the same dead link into many pages -> one issue, and >20 unique
    # dead links -> capped at 20
    movies = os.path.join(fixture_vault, "wiki", "movies")
    for i in range(30):
        with open(os.path.join(movies, "Filler %d (2000).md" % i), "w") as fh:
            fh.write("# Filler %d\n\n[[Dead %d]] and [[Nonexistent Film (1999)]]\n" % (i, i))
    issues = lint_vault(v)
    assert len(issues) == 20
    dead_dupes = [
        i for i in issues if i["target"] == "Nonexistent Film (1999)"
    ]
    # same target in different files is a different detail string (as upstream),
    # but the identical (target, where) pair never repeats
    assert len({i["detail"] for i in issues}) == len(issues)
    assert len(dead_dupes) >= 1


# -- path-style links + index invariants (parity with new lib/lint.ts) --------


def test_path_style_links_are_not_dead(fixture_vault):
    # the stock hub links [[movies/_index]] and [[Taste Profile]] — neither may
    # be flagged (a false dead-link would become a queued "repair" on the hub)
    v = Vault(fixture_vault)
    dead = {i["target"] for i in lint_vault(v) if i["kind"] == "dead_link"}
    assert "movies/_index" not in dead
    assert "Taste Profile" not in dead


def test_index_mismatch_reported_for_unindexed_pages(fixture_vault):
    # Crime/Neo-noir are planted on disk but never indexed in genres/_index.md
    v = Vault(fixture_vault)
    details = [i["detail"] for i in lint_vault(v) if i["kind"] == "index_mismatch"]
    assert "genres/_index.md is missing its page [[Crime]]" in details
    assert "genres/_index.md is missing its page [[Neo-noir]]" in details


def test_index_mismatch_listed_but_missing_and_double_indexed(fixture_vault):
    v = Vault(fixture_vault)
    genres_idx = os.path.join(fixture_vault, "wiki/movies/genres/_index.md")
    with open(genres_idx, "a", encoding="utf-8") as fh:
        fh.write("- [[Crime]] — loves\n- [[Neo-noir]] — loves\n- [[Ghost Genre]] — ?\n")
    # a page that exists in TWO dimensions and is indexed in both -> exactly-one rule
    themes_idx = os.path.join(fixture_vault, "wiki/movies/themes/_index.md")
    with open(themes_idx, "a", encoding="utf-8") as fh:
        fh.write("- [[Crime]] — cross-listed\n")
    with open(
        os.path.join(fixture_vault, "wiki/movies/themes/Crime.md"), "w", encoding="utf-8"
    ) as fh:
        fh.write("# Crime (themes copy)\n")
    details = [i["detail"] for i in lint_vault(v) if i["kind"] == "index_mismatch"]
    assert (
        "genres/_index.md lists [[Ghost Genre]] but genres/Ghost Genre.md does not exist"
        in details
    )
    assert any("indexed in both" in d and "[[Crime]]" in d for d in details)


def test_index_lint_skipped_without_category_dirs(generic_vault):
    from gardener.lint import lint_vault as lv

    v = Vault(generic_vault)
    assert not any(i["kind"] == "index_mismatch" for i in lv(v))


def test_not_interested_titles_not_dead_links(fixture_vault):
    v = Vault(fixture_vault)
    hub = v.hub
    with open(hub, "r", encoding="utf-8") as fh:
        text = fh.read()
    text = text.replace(
        "- (empty — unseen titles you've vetoed land here; never suggested again)",
        "- [[Vetoed Film (2000)]] — never again",
    )
    with open(hub, "w", encoding="utf-8") as fh:
        fh.write(text)
    dead = {i["target"] for i in lint_vault(v) if i["kind"] == "dead_link"}
    assert "Vetoed Film (2000)" not in dead


# -- autofix parity with lib/lint.ts ------------------------------------------


def test_autofix_formatted_wikilink():
    assert autofix_text("[[**Heat (1995)**]]") == "[[Heat (1995)]]"
    assert autofix_text("[[ _Crime_ ]]") == "[[Crime]]"
    assert autofix_text("[[`Neo-noir`]]") == "[[Neo-noir]]"


def test_autofix_unclosed_wikilink():
    assert autofix_text("[[Heat (1995)] and text") == "[[Heat (1995)]] and text"
    # already-closed links untouched
    assert autofix_text("[[Heat (1995)]]") == "[[Heat (1995)]]"


def test_autofix_vault_hub_only(fixture_vault):
    v = Vault(fixture_vault)
    with open(v.hub, "a", encoding="utf-8") as fh:
        fh.write("\n- [[**Broken Bold**]]\n")
    broken_movie = os.path.join(fixture_vault, "wiki", "movies", "Heat (1995).md")
    with open(broken_movie, "a", encoding="utf-8") as fh:
        fh.write("\n[[**Not Fixed Here**]]\n")
    fixes = autofix_vault(v)
    assert fixes == ["hub: normalized malformed wikilink syntax"]
    assert "[[Broken Bold]]" in v.read(v.hub)
    # scope stays hub-only, exactly as lib/lint.ts
    assert "[[**Not Fixed Here**]]" in v.read(broken_movie)


def test_autofix_noop_returns_empty(fixture_vault):
    v = Vault(fixture_vault)
    assert autofix_vault(v) == []
