import os

from gardener import profile
from gardener.profile import Profile, load

from conftest import JETSON


def test_defaults_are_generic():
    p = Profile()
    assert p.generic
    assert p.page_dirs == []
    assert p.hub == ""
    assert p.log_file == ""
    assert p.audits_dir == "_audits"
    assert p.pageless_sections == []
    assert p.linked_bullet_sections == []
    assert p.frontmatter_link_keys == []
    assert p.readonly_paths == []
    assert p.category_dirs == []
    assert p.stub_kinds == {}
    assert p.stub_default == ""
    assert p.index_file == ""
    assert p.vault_description == ""


def test_missing_file_is_generic(tmp_path):
    assert load(str(tmp_path)).generic


def test_colon_lists_and_quoting(tmp_path):
    conf = tmp_path / profile.PROFILE_BASENAME
    conf.write_text(
        'PAGE_DIRS=notes:notes/deep dir:journal\n'
        'VAULT_DESCRIPTION="my notes, with commas"\n'
        "READONLY_PATHS=archive\n"
        "UNKNOWN_KEY=ignored\n"
    )
    p = load(str(tmp_path))
    assert not p.generic
    assert p.page_dirs == ["notes", "notes/deep dir", "journal"]
    assert p.vault_description == "my notes, with commas"
    assert p.readonly_paths == ["archive"]
    assert not hasattr(p, "unknown_key")


def test_stub_kind_parsing(tmp_path):
    conf = tmp_path / profile.PROFILE_BASENAME
    conf.write_text(
        'STUB_KIND_MOVIES="wiki/movies|movie|movie"\n'
        'STUB_KIND_GENRES="wiki/movies/genres|category|category"\n'
        'STUB_KIND_BROKEN="only-two|parts"\n'
        "STUB_DEFAULT=movies\n"
    )
    p = load(str(tmp_path))
    assert set(p.stub_kinds) == {"movies", "genres"}
    assert p.stub_kinds["movies"].directory == "wiki/movies"
    assert p.stub_kinds["genres"].entity_type == "category"
    assert p.stub_kinds["genres"].tag == "category"
    assert p.stub_default == "movies"


def test_shipped_marquee_profile_matches_current_behavior():
    path = os.path.join(JETSON, "payload", "profiles", "marquee-movies.conf")
    with open(path) as fh:
        from gardener.config import parse_conf

        p = Profile(parse_conf(fh.read()))
    dims = ["genres", "people", "themes", "style", "platforms", "eras", "settings"]
    assert p.page_dirs == (
        ["wiki/movies"]
        + ["wiki/movies/%s" % d for d in dims]
        + ["wiki/movies/taste"]
    )
    assert p.hub == "wiki/entities/Movies.md"
    assert p.pageless_sections == ["watchlist", "not interested"]
    assert p.linked_bullet_sections == ["taste"]
    assert p.frontmatter_link_keys == ["genres"]
    assert p.log_file == "wiki/log.md"
    assert p.audits_dir == "wiki/audits"
    assert set(p.stub_kinds) == {"movies", "genres"}
    assert p.stub_default == "movies"
    assert p.index_file == "wiki/movies/genres/_index.md"
    assert p.indexed_stub_kind == "genres"
    assert p.grand_index == "wiki/movies/_index.md"
    assert p.category_dirs == ["wiki/movies/%s" % d for d in dims]
    assert not p.generic


def test_shipped_generic_profile_is_all_defaults():
    path = os.path.join(JETSON, "payload", "profiles", "generic.conf")
    with open(path) as fh:
        from gardener.config import parse_conf

        p = Profile(parse_conf(fh.read()))
    assert p.generic
    assert p.hub == ""
    assert p.stub_kinds == {}
