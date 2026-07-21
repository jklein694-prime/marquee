import os

import pytest

from gardener import frontmatter
from gardener.patch import Patch, PatchError, extract_json
from gardener.vaultio import Vault

HEAT = "wiki/movies/Heat (1995).md"
COLLATERAL = "wiki/movies/Collateral (2004).md"
HUB = "wiki/entities/Movies.md"


def make(vault_root, data, context=None):
    return Patch(data, Vault(vault_root), context=context)


def valid_base(action="no_change", **kw):
    d = {"action": action, "reason": "test reason"}
    d.update(kw)
    return d


# -- extract_json --------------------------------------------------------------


def test_extract_json_plain():
    assert extract_json('{"a": 1}') == {"a": 1}


def test_extract_json_wrapped_in_prose():
    raw = 'Sure! Here is the patch:\n{"action": "no_change", "reason": "x"}\nHope that helps!'
    assert extract_json(raw)["action"] == "no_change"


def test_extract_json_nested_braces_and_strings():
    raw = 'text {"a": {"b": "with } brace and \\" quote"}, "c": 2} tail'
    assert extract_json(raw) == {"a": {"b": 'with } brace and " quote'}, "c": 2}


@pytest.mark.parametrize("raw", ["no json here", "{broken", '{"a": }'])
def test_extract_json_rejects_garbage(raw):
    with pytest.raises(PatchError):
        extract_json(raw)


# -- happy paths ---------------------------------------------------------------


def test_no_change_applies_nothing(fixture_vault):
    p = make(fixture_vault, valid_base())
    assert p.apply() == []


def test_add_link(fixture_vault):
    p = make(
        fixture_vault,
        valid_base(
            "add_link",
            file=HEAT,
            anchor="Belongs with [[Crime]] and [[Neo-noir]].",
            text="Pairs well with [[Collateral (2004)]] for a Mann double bill.",
            target="Collateral (2004)",
        ),
    )
    changed = p.apply(today="2026-07-06")
    assert changed == [HEAT]
    text = Vault(fixture_vault).read(os.path.join(fixture_vault, HEAT))
    assert "Mann double bill" in text
    meta, _ = frontmatter.parse(text)
    assert meta["updated"] == "2026-07-06"


def test_replace_line(fixture_vault):
    p = make(
        fixture_vault,
        valid_base(
            "replace_line",
            file="wiki/movies/genres/Crime.md",
            anchor="Pattern: loves — 2 of 2 rated 8+.",
            text="Pattern: loves — 2 of 2 rated 8+ (verified).",
        ),
    )
    assert p.apply() == ["wiki/movies/genres/Crime.md"]


def test_remove_line_of_dead_link(fixture_vault):
    anchor = "Night-time LA hitman ride-along. See also [[Heat (1995)]] and [[Nonexistent Film (1999)]]."
    p = make(
        fixture_vault,
        valid_base("remove_line", file=COLLATERAL, anchor=anchor),
        context={"target": "Nonexistent Film (1999)"},
    )
    p.apply()
    text = Vault(fixture_vault).read(os.path.join(fixture_vault, COLLATERAL))
    assert "Nonexistent Film" not in text


def test_retarget_link(fixture_vault):
    anchor = "Night-time LA hitman ride-along. See also [[Heat (1995)]] and [[Nonexistent Film (1999)]]."
    p = make(
        fixture_vault,
        valid_base("retarget_link", file=COLLATERAL, anchor=anchor, target="Solaris (1972)"),
        context={"target": "Nonexistent Film (1999)"},
    )
    p.apply()
    text = Vault(fixture_vault).read(os.path.join(fixture_vault, COLLATERAL))
    assert "[[Solaris (1972)]]" in text
    assert "Nonexistent Film" not in text


def test_append_bullet(fixture_vault):
    p = make(
        fixture_vault,
        valid_base(
            "append_bullet",
            file="wiki/movies/genres/Neo-noir.md",
            text="- [[Collateral (2004)]] — liked, 8/10",
        ),
    )
    p.apply()
    text = Vault(fixture_vault).read(
        os.path.join(fixture_vault, "wiki/movies/genres/Neo-noir.md")
    )
    assert text.rstrip().endswith("- [[Collateral (2004)]] — liked, 8/10")


def test_create_stub_movie(fixture_vault):
    p = make(
        fixture_vault,
        valid_base("create_stub", target="Thief (1981)", text="Mann's debut heist film."),
        context={"target": "Thief (1981)", "stub_dir": "movies"},
    )
    changed = p.apply(today="2026-07-06")
    assert changed == ["wiki/movies/Thief (1981).md"]
    text = Vault(fixture_vault).read(
        os.path.join(fixture_vault, "wiki/movies/Thief (1981).md")
    )
    meta, body = frontmatter.parse(text)
    assert meta["status"] == "stub"
    assert meta["address"] == "c-000001"
    assert meta["entity_type"] == "movie"
    assert "Mann's debut heist film." in body


def test_create_stub_genre_indexes_mechanically(fixture_vault):
    p = make(
        fixture_vault,
        valid_base("create_stub", target="Heist", text="Heist procedurals."),
        context={"stub_dir": "genres"},
    )
    changed = p.apply()
    # new stubs land in the genres dimension and get a bullet in ITS sub-index
    # (the grand index is a routing table, never touched)
    assert set(changed) == {
        "wiki/movies/genres/Heist.md",
        "wiki/movies/genres/_index.md",
    }
    index = Vault(fixture_vault).read(
        os.path.join(fixture_vault, "wiki/movies/genres/_index.md")
    )
    assert "- [[Heist]]" in index
    grand = Vault(fixture_vault).read(
        os.path.join(fixture_vault, "wiki/movies/_index.md")
    )
    assert "[[Heist]]" not in grand


def test_hub_allows_retarget_of_dead_link(fixture_vault):
    v = Vault(fixture_vault)
    with open(v.hub, "a", encoding="utf-8") as fh:
        fh.write("\n- [[Gone Film (1990)]] — placeholder\n")
    p = make(
        fixture_vault,
        valid_base(
            "remove_line",
            file=HUB,
            anchor="- [[Gone Film (1990)]] — placeholder",
        ),
        context={"target": "Gone Film (1990)"},
    )
    p.apply()
    assert "Gone Film" not in v.read(v.hub)


# -- negative matrix: one test per rejection rule --------------------------------


def rejects(vault_root, data, context=None, match=None):
    with pytest.raises(PatchError, match=match):
        make(vault_root, data, context=context)


def test_rejects_unknown_action(fixture_vault):
    rejects(fixture_vault, valid_base("delete_page", file=HEAT), match="unknown action")


def test_rejects_missing_reason(fixture_vault):
    rejects(fixture_vault, {"action": "no_change"}, match="reason")


def test_rejects_long_reason(fixture_vault):
    rejects(fixture_vault, valid_base(reason="x" * 201), match="reason exceeds")


def test_rejects_missing_required_field(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("add_link", file=HEAT, anchor="x", target="Crime"),
        match="requires text",
    )


def test_rejects_long_text(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("append_bullet", file=HEAT, text="- " + "x" * 400),
        match="exceeds",
    )


def test_rejects_multiline_text(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("append_bullet", file=HEAT, text="- a\n- b"),
        match="single line",
    )


def test_rejects_control_chars(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("append_bullet", file=HEAT, text="- a\x07b"),
        match="control",
    )


def test_rejects_fence_as_text(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("replace_line", file=HEAT, anchor="x", text="---"),
        match="fence",
    )


def test_rejects_path_escape(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("append_bullet", file="../outside.md", text="- x"),
        match="escapes",
    )


def test_rejects_disallowed_directory(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("append_bullet", file="wiki/log.md", text="- x"),
        match="outside allowed",
    )


def test_rejects_underscore_files(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("append_bullet", file="wiki/movies/_index.md", text="- x"),
        match="not an editable page",
    )


def test_rejects_missing_file(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("append_bullet", file="wiki/movies/Nope (1900).md", text="- x"),
        match="does not exist",
    )


def test_rejects_hub_append_bullet(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("append_bullet", file=HUB, text="- x"),
        match="hub accepts only link-level",
    )


def test_rejects_hub_remove_line_without_dead_link_context(fixture_vault):
    rejects(
        fixture_vault,
        valid_base(
            "remove_line",
            file=HUB,
            anchor="- Prefers practical effects over CGI",
        ),
        match="dead link under repair",
    )


def test_rejects_unresolvable_wikilink_in_text(fixture_vault):
    rejects(
        fixture_vault,
        valid_base(
            "append_bullet",
            file="wiki/movies/genres/Crime.md",
            text="- [[Made Up Movie (2001)]] — great",
        ),
        match="no page",
    )


def test_rejects_anchor_not_found(fixture_vault):
    rejects(
        fixture_vault,
        valid_base(
            "replace_line", file=HEAT, anchor="this line is not in the file", text="x"
        ),
        match="anchor not found",
    )


def test_rejects_ambiguous_anchor(fixture_vault, tmp_path):
    path = os.path.join(fixture_vault, "wiki", "movies", "Heat (1995).md")
    with open(path, "a", encoding="utf-8") as fh:
        fh.write("\nrepeated line\nrepeated line\n")
    rejects(
        fixture_vault,
        valid_base("replace_line", file=HEAT, anchor="repeated line", text="x"),
        match="not unique",
    )


def test_rejects_frontmatter_anchor(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("replace_line", file=HEAT, anchor="rating: 9", text="rating: 10"),
        match="frontmatter",
    )


def test_rejects_heading_anchor(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("remove_line", file=HEAT, anchor="# Heat (1995)"),
        match="heading",
    )


def test_rejects_remove_line_of_arbitrary_prose(fixture_vault):
    rejects(
        fixture_vault,
        valid_base(
            "remove_line",
            file=HEAT,
            anchor="Cat-and-mouse between [[Collateral (2004)]]'s director's earlier masterpiece leads.",
        ),
        match="only removes bullets",
    )


def test_rejects_add_link_text_without_target(fixture_vault):
    rejects(
        fixture_vault,
        valid_base(
            "add_link",
            file=HEAT,
            anchor="Belongs with [[Crime]] and [[Neo-noir]].",
            text="no link here",
            target="Crime",
        ),
        match="must contain",
    )


def test_rejects_append_bullet_without_dash(fixture_vault):
    rejects(
        fixture_vault,
        valid_base(
            "append_bullet", file="wiki/movies/genres/Crime.md", text="not a bullet"
        ),
        match="start with",
    )


def test_rejects_retarget_without_context(fixture_vault):
    rejects(
        fixture_vault,
        valid_base(
            "retarget_link",
            file=COLLATERAL,
            anchor="Night-time LA hitman ride-along. See also [[Heat (1995)]] and [[Nonexistent Film (1999)]].",
            target="Solaris (1972)",
        ),
        match="task context",
    )


def test_rejects_stub_over_existing_page(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("create_stub", target="Crime", text="desc"),
        context={"stub_dir": "genres"},
        match="already exists",
    )


def test_rejects_stub_name_mismatch(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("create_stub", target="Wrong Name", text="desc"),
        context={"target": "Thief (1981)", "stub_dir": "movies"},
        match="named after",
    )


def test_rejects_stub_with_path_tricks_in_target(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("create_stub", target="../evil", text="desc"),
        context={"stub_dir": "movies"},
        match="bare page name",
    )


def test_rejects_invalid_stub_dir(fixture_vault):
    rejects(
        fixture_vault,
        valid_base("create_stub", target="X", text="desc"),
        context={"stub_dir": "entities"},
        match="stub_dir",
    )
