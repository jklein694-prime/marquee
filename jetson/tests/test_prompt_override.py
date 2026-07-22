import os

from gardener import tasks
from gardener.vaultio import Vault


def test_vault_override_wins(fixture_vault):
    v = Vault(fixture_vault)
    # shipped default has no override
    assert "wiki gardener" in tasks._template("system", v)
    # plant an override
    os.makedirs(os.path.join(fixture_vault, "prompts"))
    with open(os.path.join(fixture_vault, "prompts", "system.txt"), "w") as fh:
        fh.write("CUSTOM SYSTEM __VAULT_DESCRIPTION__\n")
    assert tasks._template("system", v).startswith("CUSTOM SYSTEM")


def test_override_composes_with_description_token(fixture_vault):
    os.makedirs(os.path.join(fixture_vault, "prompts"))
    with open(os.path.join(fixture_vault, "prompts", "system.txt"), "w") as fh:
        fh.write("Do very specific LLM work.__VAULT_DESCRIPTION__\n")
    v = Vault(fixture_vault)
    prompt = tasks.system_prompt(v)
    assert prompt.startswith("Do very specific LLM work.")
    # the movie profile's description got injected where the token was
    assert "movie" in prompt.lower()
    assert "__VAULT_DESCRIPTION__" not in prompt


def test_no_vault_uses_shipped_default():
    assert "JSON" in tasks._template("system")


def test_missing_override_falls_back(fixture_vault):
    v = Vault(fixture_vault)
    # prompts/ dir absent -> shipped default
    assert "repair a dead wikilink" in tasks._template("dead_link", v)
