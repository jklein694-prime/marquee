import os

from gardener.vaultio import Vault


def test_pages_and_underscore_exclusion(fixture_vault):
    v = Vault(fixture_vault)
    names = set(v.pages())
    assert names == {
        "Heat (1995)",
        "Collateral (2004)",
        "Solaris (1972)",
        "Crime",
        "Neo-noir",
    }
    assert "_index" not in names


def test_link_index_directions(fixture_vault):
    v = Vault(fixture_vault)
    outbound, inbound = v.link_index()
    # Heat links Crime + Neo-noir (frontmatter genres AND body) + Collateral
    assert outbound["Heat (1995)"] == {"Crime", "Neo-noir", "Collateral (2004)"}
    # dead link [[Nonexistent Film (1999)]] must not create an edge
    assert outbound["Collateral (2004)"] == {"Crime", "Heat (1995)"}
    assert "Nonexistent Film (1999)" not in inbound
    # orphan: no inbound at all
    assert inbound["Solaris (1972)"] == set()
    # hub taste bullets link Crime/Neo-noir -> counted as inbound sentinel
    assert "__hub__" in inbound["Crime"]


def test_neighborhood(fixture_vault):
    v = Vault(fixture_vault)
    assert v.neighborhood("Heat (1995)") == [
        "Collateral (2004)",
        "Crime",
        "Neo-noir",
    ]
    assert v.neighborhood("Solaris (1972)") == []


def test_resolve_confines_to_vault(fixture_vault):
    v = Vault(fixture_vault)
    ok = v.resolve("wiki/movies/Heat (1995).md")
    assert ok and ok.endswith("Heat (1995).md")
    assert v.resolve("../outside.md") is None
    assert v.resolve("/etc/passwd") is None


def test_resolve_rejects_symlink_escape(fixture_vault, tmp_path):
    outside = tmp_path / "outside.md"
    outside.write_text("secret")
    link = os.path.join(fixture_vault, "wiki", "movies", "Sneaky.md")
    os.symlink(str(outside), link)
    v = Vault(fixture_vault)
    assert v.resolve("wiki/movies/Sneaky.md") is None
