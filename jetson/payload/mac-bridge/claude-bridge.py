#!/usr/bin/env python3
"""Sonnet bridge — runs on the Mac, not the Nano.

The Jetson can't run Claude Code (glibc 2.27 < the Node 18+ floor), so the
smart model lives here. This is a tiny stdlib HTTP server that turns a POST
into one headless `claude -p` call, authenticated by *this machine's* Claude
Code login (your Max subscription). The Nano's gardener calls it on demand and
falls back to its local model when this bridge is unreachable.

Security: this exposes your logged-in Claude to whatever can reach the port.
Defenses, in order:
  - a shared token (X-Bridge-Token) required on every request
  - Claude is run in an empty temp dir with NO --add-dir, so it can see nothing
  - NO --dangerously-skip-permissions, so any gated tool auto-denies in headless
  - an explicit tool denylist on top of that
  - bind to the tether/VPN interface, not 0.0.0.0, unless you mean it
Treat prompts from the Nano as untrusted text; this server never lets them act.

Run:
  BRIDGE_TOKEN=$(openssl rand -hex 24) \\
  python3 claude-bridge.py --host 192.168.55.100 --port 8091
(print the token — the Nano needs the same value in CLAUDE_BRIDGE_TOKEN)
"""
import argparse
import hmac
import json
import os
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer

MODEL = os.environ.get("BRIDGE_MODEL", "sonnet")
TOKEN = os.environ.get("BRIDGE_TOKEN", "")
CLAUDE = shutil.which("claude") or os.path.expanduser("~/.local/bin/claude")
# tools that could act on the Mac; denied on top of the headless auto-deny
_DENY = ["Bash", "Write", "Edit", "NotebookEdit", "WebFetch", "WebSearch"]
TIMEOUT = int(os.environ.get("BRIDGE_TIMEOUT", "120"))


def run_claude(system, prompt):
    """One headless completion. Returns (ok, text_or_error)."""
    # prompt goes on stdin, not argv: --disallowed-tools is variadic and would
    # otherwise swallow a positional prompt as tool names (and stdin dodges
    # argv length/escaping limits too).
    cmd = [CLAUDE, "-p", "--model", MODEL]
    if system:
        cmd += ["--system-prompt", system]
    cmd += ["--disallowed-tools", *_DENY]
    workdir = tempfile.mkdtemp(prefix="bridge-")  # empty; Claude sees nothing
    try:
        out = subprocess.run(
            cmd, cwd=workdir, input=prompt,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            universal_newlines=True, timeout=TIMEOUT,
        )
        if out.returncode != 0:
            return False, (out.stderr or "claude exited %d" % out.returncode).strip()
        return True, out.stdout.strip()
    except subprocess.TimeoutExpired:
        return False, "claude timed out after %ds" % TIMEOUT
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


class Handler(BaseHTTPRequestHandler):
    server_version = "claude-bridge"

    def log_message(self, *a):
        pass

    def _send(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authed(self):
        got = self.headers.get("X-Bridge-Token", "")
        return bool(TOKEN) and hmac.compare_digest(got, TOKEN)

    def do_GET(self):
        if self.path == "/health":
            if not self._authed():
                return self._send(401, {"error": "bad token"})
            return self._send(200, {"ok": True, "model": MODEL})
        return self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/ask":
            return self._send(404, {"error": "not found"})
        if not self._authed():
            return self._send(401, {"error": "bad token"})
        length = int(self.headers.get("Content-Length", "0"))
        try:
            params = json.loads(self.rfile.read(length).decode("utf-8")) if length else {}
        except ValueError:
            return self._send(400, {"error": "bad json"})
        prompt = str(params.get("prompt", "")).strip()
        if not prompt:
            return self._send(400, {"error": "empty prompt"})
        ok, text = run_claude(str(params.get("system", "")), prompt)
        return self._send(200 if ok else 502, {"text": text} if ok else {"error": text})


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--host", default=os.environ.get("BRIDGE_HOST", "127.0.0.1"))
    ap.add_argument("--port", type=int, default=int(os.environ.get("BRIDGE_PORT", "8091")))
    args = ap.parse_args()
    if not TOKEN:
        raise SystemExit("set BRIDGE_TOKEN (shared secret) before starting")
    if not os.path.exists(CLAUDE):
        raise SystemExit("claude CLI not found — install Claude Code and `claude login`")
    print("claude-bridge on http://%s:%d (model=%s)" % (args.host, args.port, MODEL))
    HTTPServer((args.host, args.port), Handler).serve_forever()


if __name__ == "__main__":
    main()
