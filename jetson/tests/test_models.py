import hashlib
import json
import os

import pytest

from gardener import models
from gardener.config import Config

CATALOG = """
[qwen2.5-1.5b]
name = Qwen2.5 1.5B
file = qwen2.5-1.5b-instruct-q4_k_m.gguf
url = https://example.invalid/1.5b.gguf
sha256 = TBD
ram_tier = 1.5b
ctx = 3072

[qwen2.5-0.5b]
name = Qwen2.5 0.5B
file = qwen2.5-0.5b-instruct-q4_k_m.gguf
url = https://example.invalid/0.5b.gguf
sha256 = TBD
ram_tier = 0.5b
ctx = 3072
"""


@pytest.fixture
def mcfg(tmp_path):
    catalog = tmp_path / "models.catalog"
    catalog.write_text(CATALOG)
    (tmp_path / "models").mkdir()
    runtime = tmp_path / "runtime.env"
    runtime.write_text(
        "MODEL_FILE=qwen2.5-0.5b-instruct-q4_k_m.gguf\n"
        "CTX=3072\n"
        "LLAMA_VARIANT=cuda\n"
        "LLAMA_EXTRA_ARGS=-ngl 99\n"
    )
    return Config(
        path="/nonexistent",
        overrides={
            "MODELS_CATALOG": str(catalog),
            "MODELS_DIR": str(tmp_path / "models"),
            "RUNTIME_ENV": str(runtime),
            "LLAMA_URL": "http://127.0.0.1:9",
        },
    )


def test_parse_catalog():
    cat = models.parse_catalog(CATALOG)
    assert set(cat) == {"qwen2.5-1.5b", "qwen2.5-0.5b"}
    assert cat["qwen2.5-1.5b"]["ram_tier"] == "1.5b"
    assert cat["qwen2.5-1.5b"]["ctx"] == "3072"


def test_tier_fits():
    assert models.tier_fits("0.5b", "1.5b")
    assert models.tier_fits("1.5b", "1.5b")
    assert not models.tier_fits("1.5b", "0.5b")
    assert not models.tier_fits("3b", "1.5b")
    # 'below' board refuses everything; 'unknown' (dev host) allows
    assert not models.tier_fits("0.5b", "below")
    assert models.tier_fits("1.5b", "unknown")
    # orin-tier models (Nemotron 4B) are refused on any original-Nano tier
    assert not models.tier_fits("orin", "1.5b")
    assert not models.tier_fits("orin", "0.5b")


def test_shipped_catalog_refuses_nemotron_on_nano():
    import os as _os

    from conftest import JETSON

    catalog = models.load_catalog(
        _os.path.join(JETSON, "payload", "models.catalog")
    )
    assert "nemotron-mini-4b" in catalog
    assert catalog["nemotron-mini-4b"]["ram_tier"] == "orin"
    # a 4GB Nano detects as "1.5b" -> Nemotron does not fit
    assert not models.tier_fits(catalog["nemotron-mini-4b"]["ram_tier"], "1.5b")


def test_detect_tier(tmp_path):
    mi = tmp_path / "meminfo"
    mi.write_text("MemTotal:        4056000 kB\n")
    assert models.detect_tier(str(mi)) == "1.5b"
    mi.write_text("MemTotal:        1980000 kB\n")
    assert models.detect_tier(str(mi)) == "0.5b"
    mi.write_text("MemTotal:         900000 kB\n")
    assert models.detect_tier(str(mi)) == "below"


def test_list_marks_active_and_installed(mcfg, monkeypatch):
    monkeypatch.setattr(models, "detect_tier", lambda *a: "1.5b")
    # pretend the 0.5b model file exists
    open(os.path.join(mcfg.models_dir, "qwen2.5-0.5b-instruct-q4_k_m.gguf"), "w").close()
    out = models.list_models(mcfg)
    by_id = {m["id"]: m for m in out["models"]}
    assert by_id["qwen2.5-0.5b"]["installed"] is True
    assert by_id["qwen2.5-0.5b"]["active"] is True
    assert by_id["qwen2.5-1.5b"]["installed"] is False
    assert by_id["qwen2.5-1.5b"]["fits"] is True


def test_download_verifies_sha(mcfg, monkeypatch):
    payload = b"fake gguf bytes"
    good = hashlib.sha256(payload).hexdigest()

    def fake_urlopen(url, timeout=0):
        import io

        return _CM(io.BytesIO(payload))

    monkeypatch.setattr(models.urllib.request, "urlopen", fake_urlopen)
    monkeypatch.setattr(models, "detect_tier", lambda *a: "1.5b")
    # inject a known sha into the catalog entry
    cat = models.load_catalog(mcfg.models_catalog)
    cat["qwen2.5-1.5b"]["sha256"] = good
    monkeypatch.setattr(models, "load_catalog", lambda p: cat)
    res = models.download(mcfg, "qwen2.5-1.5b")
    assert res["sha_verified"] is True
    assert os.path.isfile(res["path"])


def test_download_rejects_sha_mismatch(mcfg, monkeypatch):
    monkeypatch.setattr(
        models.urllib.request, "urlopen", lambda u, timeout=0: _CM(_bytes(b"x"))
    )
    monkeypatch.setattr(models, "detect_tier", lambda *a: "1.5b")
    cat = models.load_catalog(mcfg.models_catalog)
    cat["qwen2.5-1.5b"]["sha256"] = "deadbeef"
    monkeypatch.setattr(models, "load_catalog", lambda p: cat)
    # curl fallback would also 'succeed' writing nothing useful; force urlopen-only
    monkeypatch.setattr(models.subprocess, "call", lambda *a, **k: 1)
    with pytest.raises(RuntimeError, match="sha256 mismatch"):
        models.download(mcfg, "qwen2.5-1.5b")
    assert models.installed(mcfg.models_dir) == []


def test_download_refuses_oversized_tier(mcfg, monkeypatch):
    monkeypatch.setattr(models, "detect_tier", lambda *a: "0.5b")
    with pytest.raises(RuntimeError, match="does not fit"):
        models.download(mcfg, "qwen2.5-1.5b")


def test_download_arbitrary_url_tofu(mcfg, monkeypatch):
    monkeypatch.setattr(
        models.urllib.request, "urlopen", lambda u, timeout=0: _CM(_bytes(b"data"))
    )
    monkeypatch.setattr(models, "detect_tier", lambda *a: "1.5b")
    res = models.download(mcfg, "https://example.invalid/custom-model.gguf")
    assert res["file"] == "custom-model.gguf"
    assert res["sha_verified"] is False


def test_use_rewrites_only_model_and_ctx_preserving_variant(mcfg, monkeypatch):
    open(
        os.path.join(mcfg.models_dir, "qwen2.5-1.5b-instruct-q4_k_m.gguf"), "w"
    ).close()
    monkeypatch.setattr(models, "detect_tier", lambda *a: "1.5b")
    monkeypatch.setattr(models.subprocess, "call", lambda *a, **k: 0)
    res = models.use(mcfg, "qwen2.5-1.5b", health=lambda url: True)
    assert res["file"] == "qwen2.5-1.5b-instruct-q4_k_m.gguf"
    text = open(mcfg.runtime_env).read()
    assert "MODEL_FILE=qwen2.5-1.5b-instruct-q4_k_m.gguf" in text
    assert "LLAMA_VARIANT=cuda" in text  # preserved
    assert "LLAMA_EXTRA_ARGS=-ngl 99" in text  # preserved


def test_use_rolls_back_on_failed_health(mcfg, monkeypatch):
    open(
        os.path.join(mcfg.models_dir, "qwen2.5-1.5b-instruct-q4_k_m.gguf"), "w"
    ).close()
    monkeypatch.setattr(models, "detect_tier", lambda *a: "1.5b")
    monkeypatch.setattr(models.subprocess, "call", lambda *a, **k: 0)
    with pytest.raises(RuntimeError, match="rolled back"):
        models.use(mcfg, "qwen2.5-1.5b", health=lambda url: False)
    # runtime.env restored to the original 0.5b model
    text = open(mcfg.runtime_env).read()
    assert "MODEL_FILE=qwen2.5-0.5b-instruct-q4_k_m.gguf" in text


def test_remove_refuses_active(mcfg):
    with pytest.raises(RuntimeError, match="active model"):
        models.remove(mcfg, "qwen2.5-0.5b-instruct-q4_k_m.gguf")


# -- tiny helpers for mocking urllib -------------------------------------------


class _CM(object):
    def __init__(self, fh):
        self.fh = fh

    def __enter__(self):
        return self.fh

    def __exit__(self, *a):
        return False


def _bytes(b):
    import io

    return io.BytesIO(b)
