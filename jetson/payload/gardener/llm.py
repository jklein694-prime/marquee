"""Client for the local llama.cpp server on localhost.

Uses the native /completion endpoint with hand-built ChatML rather than
/v1/chat/completions: chat-template handling varied across early-2024 server
builds, but /completion + explicit ChatML is stable for the whole b18xx-b22xx
range and Qwen2.5 is ChatML-native. stdlib urllib only.
"""
import json
import urllib.error
import urllib.request

CHATML = (
    "<|im_start|>system\n{system}<|im_end|>\n"
    "<|im_start|>user\n{user}<|im_end|>\n"
    "<|im_start|>assistant\n"
)


class LlmError(Exception):
    pass


def _post(url, payload, timeout):
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, OSError, ValueError) as exc:
        raise LlmError("llama-server request failed: %s" % exc)


def health(base_url, timeout=5):
    try:
        with urllib.request.urlopen(base_url + "/health", timeout=timeout) as resp:
            return resp.status == 200
    except (urllib.error.URLError, OSError):
        return False


def chat(base_url, system, user, max_tokens=300, temperature=0.3, timeout=600):
    """One completion; returns the model's raw text reply."""
    data = _post(
        base_url + "/completion",
        {
            "prompt": CHATML.format(system=system, user=user),
            "n_predict": max_tokens,
            "temperature": temperature,
            "stop": ["<|im_end|>", "<|im_start|>"],
            "cache_prompt": True,
        },
        timeout,
    )
    if "content" not in data:
        raise LlmError("malformed llama-server response: %r" % (data,))
    return data["content"]


def probe(base_url, timeout=30):
    """A tiny timed completion for the dashboard's tok/s readout.

    Returns {'tokens_per_sec': float|None, 'ok': bool}. Never raises — the
    dashboard calls it opportunistically.
    """
    try:
        data = _post(
            base_url + "/completion",
            {"prompt": "<|im_start|>user\nhi<|im_end|>\n<|im_start|>assistant\n",
             "n_predict": 8, "temperature": 0, "stop": ["<|im_end|>"]},
            timeout,
        )
    except LlmError:
        return {"tokens_per_sec": None, "ok": False}
    timings = data.get("timings") or {}
    tps = timings.get("predicted_per_second")
    return {"tokens_per_sec": round(tps, 2) if tps else None, "ok": True}
