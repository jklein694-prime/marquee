"""Generic (profile-less) vault behavior: scan, links, duplicates."""
import os

from gardener.vaultio import Vault


def test_recursive_scan_includes_nested_excludes_special(generic_vault):
    v = Vault(generic_vault)
    assert v.profile.generic
    names = set(v.pages())
    assert names == {
        "Compilers",
        "Type Systems",
        "Ideas",
        "2026-07-01",
        "Bread",
    }
    # dot-dirs and underscore-dirs never become pages
    rels = {v.relpath(p) for p in v.pages().values()}
    assert not any(r.startswith((".", "_")) for r in rels)


def test_duplicate_basename_first_wins_and_recorded(generic_vault):
    v = Vault(generic_vault)
    pages = v.pages()
    # sorted-relpath order: journal/Ideas.md < notes/projects/Ideas.md
    assert v.relpath(pages["Ideas"]) == os.path.join("journal", "Ideas.md")
    assert v.duplicates == [
        (
            "Ideas",
            os.path.join("journal", "Ideas.md"),
            os.path.join("notes", "projects", "Ideas.md"),
        )
    ]


def test_cross_folder_link_index_no_hub(generic_vault):
    v = Vault(generic_vault)
    outbound, inbound = v.link_index()
    assert outbound["Compilers"] == {"Type Systems", "Ideas"}
    assert inbound["Compilers"] == {"Type Systems", "2026-07-01"}
    assert inbound["Bread"] == set()  # the orphan
    # dead link creates no edge
    assert "Ghost Note" not in inbound


def test_no_frontmatter_link_keys_in_generic_mode(generic_vault):
    v = Vault(generic_vault)
    with open(os.path.join(generic_vault, "notes", "Compilers.md"), "w") as fh:
        fh.write("---\ngenres: [\"[[Type Systems]]\"]\n---\n\nBody, no links.\n")
    # generic profile declares no frontmatter link keys -> no edge
    assert v.page_links(os.path.join(generic_vault, "notes", "Compilers.md")) == []


def test_hub_and_log_are_none_and_audits_defaults(generic_vault):
    v = Vault(generic_vault)
    assert v.hub is None
    assert v.log is None
    assert v.relpath(v.audits_dir) == "_audits"


def test_readonly_paths_excluded_via_profile(generic_vault):
    with open(os.path.join(generic_vault, "gardener-vault.conf"), "w") as fh:
        fh.write("READONLY_PATHS=recipes\n")
    v = Vault(generic_vault)
    assert "Bread" not in v.pages()
    # and the profile file itself is never a page
    assert "gardener-vault" not in v.pages()


def test_profile_page_dirs_used_when_set(generic_vault):
    with open(os.path.join(generic_vault, "gardener-vault.conf"), "w") as fh:
        fh.write("PAGE_DIRS=notes\n")
    v = Vault(generic_vault)
    assert set(v.pages()) == {"Compilers", "Type Systems"}  # non-recursive


# -- generic lint ---------------------------------------------------------------


def test_generic_lint_universal_rules_only(generic_vault):
    from gardener.lint import autofix_vault, lint_vault

    v = Vault(generic_vault)
    issues = lint_vault(v)
    kinds = {(i["kind"], i["target"]) for i in issues}
    assert ("dead_link", "Ghost Note") in kinds
    assert ("orphan", "Bread") in kinds
    assert ("duplicate_name", "Ideas") in kinds
    # no hub -> no hub-section kinds ever
    assert not any(k.endswith("_unlinked") for k, _ in kinds)
    # no hub -> autofix is a no-op by design
    assert autofix_vault(v) == []


def test_generic_hub_rules_activate_via_profile(generic_vault):
    """Hub gating is profile-driven, not marquee-specific."""
    from gardener.lint import lint_vault

    with open(os.path.join(generic_vault, "Home.md"), "w") as fh:
        fh.write(
            "# Home\n\n## Inbox\n\n- [[Someday Note]] — no page yet\n\n"
            "## Themes\n\n- a bullet with no links at all\n"
            "- linked bullet [[Compilers]]\n"
        )
    with open(os.path.join(generic_vault, "gardener-vault.conf"), "w") as fh:
        fh.write(
            "HUB=Home.md\nPAGELESS_SECTIONS=inbox\nLINKED_BULLET_SECTIONS=themes\n"
        )
    v = Vault(generic_vault)
    assert "Home" not in v.pages()  # the hub is never a samplable page
    kinds = {(i["kind"], i["target"]) for i in lint_vault(v)}
    assert ("dead_link", "Someday Note") not in kinds  # pageless section
    assert any(k == "themes_unlinked" for k, _ in kinds)
