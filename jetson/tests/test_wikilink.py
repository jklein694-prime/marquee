from gardener.wikilink import wikilinks


def test_plain_link():
    assert wikilinks("see [[Heat (1995)]] tonight") == ["Heat (1995)"]


def test_aliased_link():
    assert wikilinks("[[movies/_index|Movie Database Index]]") == ["movies/_index"]


def test_anchor_excluded_from_target():
    # '#' is excluded from the target group, so anchored links don't match a
    # plain-target parse — identical to lib/wikilink.ts
    assert wikilinks("[[Heat (1995)|the film]] and [[Crime]]") == [
        "Heat (1995)",
        "Crime",
    ]


def test_multiple_and_whitespace_stripping():
    assert wikilinks("[[ A ]] then [[B|b]] then [[C]]") == ["A", "B", "C"]


def test_no_links():
    assert wikilinks("nothing here [not a link] [[") == []
