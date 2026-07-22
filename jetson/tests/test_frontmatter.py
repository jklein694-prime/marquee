from gardener import frontmatter

DOC = """---
type: entity
title: "Heat (1995)"
year: 1995
rating: 9
genres: ["[[Crime]]", "[[Neo-noir]]"]
tags:
  - movie
  - seen
status: seen
---

# Heat (1995)

Body text with [[Crime]].
"""


def test_parse_scalars():
    meta, body = frontmatter.parse(DOC)
    assert meta["type"] == "entity"
    assert meta["title"] == "Heat (1995)"
    assert meta["year"] == 1995
    assert meta["rating"] == 9
    assert meta["status"] == "seen"
    assert body.startswith("\n# Heat (1995)")


def test_parse_inline_list():
    meta, _ = frontmatter.parse(DOC)
    assert meta["genres"] == ["[[Crime]]", "[[Neo-noir]]"]


def test_parse_block_list():
    meta, _ = frontmatter.parse(DOC)
    assert meta["tags"] == ["movie", "seen"]


def test_no_frontmatter():
    meta, body = frontmatter.parse("# Just a heading\n")
    assert meta == {}
    assert body == "# Just a heading\n"


def test_unterminated_fence_treated_as_body():
    text = "---\ntitle: x\nno closing fence"
    meta, body = frontmatter.parse(text)
    assert meta == {}
    assert body == text


def test_set_field_replaces_only_that_line():
    out = frontmatter.set_field(DOC, "updated", "2026-07-06")
    # inserted before closing fence, everything else byte-identical
    assert "updated: 2026-07-06" in out
    assert out.replace("updated: 2026-07-06\n", "") == DOC

    out2 = frontmatter.set_field(out, "updated", "2026-07-07")
    assert "updated: 2026-07-07" in out2
    assert "2026-07-06" not in out2


def test_set_field_preserves_quoting_of_other_fields():
    out = frontmatter.set_field(DOC, "rating", "10")
    assert 'title: "Heat (1995)"' in out
    assert 'genres: ["[[Crime]]", "[[Neo-noir]]"]' in out


def test_set_field_creates_frontmatter_when_missing():
    out = frontmatter.set_field("# hi\n", "updated", "2026-07-06")
    meta, body = frontmatter.parse(out)
    assert meta == {"updated": "2026-07-06"}
    assert body == "# hi\n"


def test_set_field_refuses_unterminated_fence():
    text = "---\ntitle: x\nno closing fence"
    assert frontmatter.set_field(text, "updated", "x") == text
