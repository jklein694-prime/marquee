"""LAN web dashboard — the "high visibility and control" surface.

Open the Nano's IP in a laptop browser: live status + tok/s, the work queue
(including the failed-patch journal), recent commits and their diffs, a log
tail, the model catalog with a download/switch control, the prompt templates
with an editor, and buttons to pause/resume the gardener, trigger a run, run
an audit, sync, and toggle WiFi.

Stdlib only (Python 3.6): http.server + a hand-rolled ThreadingMixIn server
(ThreadingHTTPServer is 3.7+). Reads run in-process; every vault-mutating
action is spawned out-of-process (systemctl / a gardener subcommand) so the
single-writer discipline holds. Auth: a token (set at setup) in an HttpOnly
SameSite=Strict cookie, checked constant-time on every request; mutations are
POST-only and additionally require a matching CSRF header + same-origin.
"""
import hmac
import json
import os
import socketserver
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

from . import jobs, llm, models, net
from .config import Config
from .gitops import Git
from .vaultio import Vault
from .workqueue import WorkQueue

PROMPT_NAMES = ("system", "dead_link", "orphan", "enrich", "correction")


def read_token(cfg):
    try:
        with open(cfg.dashboard_token_file) as fh:
            return fh.read().strip()
    except IOError:
        return ""


# -- actions (mutations); isolated so tests can monkeypatch subprocess --------


def _systemctl(*args):
    # the dashboard service runs as root (consistent with the rest of the
    # all-root system); the security boundary is the token + CSRF + same-origin
    # check + LAN firewall, not process privilege
    return subprocess.call(["systemctl"] + list(args))


def action_timer(cfg, params):
    want = params.get("state", "resume")
    return {"ok": _systemctl("start" if want == "resume" else "stop", "gardener.timer") == 0}


def action_run_once(cfg, params, stamp):
    jid = "run-%d" % stamp
    jobs.start(cfg.jobs_dir, jid, ["systemctl", "start", "gardener.service"], stamp)
    return {"job": jid}


def action_audit(cfg, params, stamp):
    jid = "audit-%d" % stamp
    jobs.start(cfg.jobs_dir, jid, ["bash", "/opt/wikigardener/audit/audit.sh"], stamp)
    return {"job": jid}


def action_sync(cfg, params, stamp):
    jid = "sync-%d" % stamp
    jobs.start(cfg.jobs_dir, jid, ["python3", "-m", "gardener", "sync"], stamp)
    return {"job": jid}


def action_wifi(cfg, params):
    on = params.get("state") == "on"
    ok, _out = (net.on() if on else net.off())
    return {"ok": ok, "wifi": net.status()}


def action_model_download(cfg, params, stamp):
    target = params.get("target", "")
    jid = "download-%d" % stamp
    argv = ["python3", "-m", "gardener", "models", "download", target]
    if params.get("force"):
        argv.append("--force")
    jobs.start(cfg.jobs_dir, jid, argv, stamp)
    return {"job": jid}


def action_model_use(cfg, params, stamp):
    target = params.get("target", "")
    jid = "use-%d" % stamp
    jobs.start(cfg.jobs_dir, jid, ["python3", "-m", "gardener", "models", "use", target], stamp)
    return {"job": jid}


# -- reads --------------------------------------------------------------------


def read_status(cfg):
    git = Git(cfg.vault_dir)
    vault = Vault(cfg.vault_dir)
    healthy = llm.health(cfg.llama_url)
    active, ctx = models.current_model(cfg.runtime_env)
    return {
        "llama_healthy": healthy,
        "tokens_per_sec": llm.probe(cfg.llama_url)["tokens_per_sec"] if healthy else None,
        "model": active,
        "ctx": ctx,
        "vault_is_repo": git.is_repo(),
        "changes_today": git.commits_since_midnight() if git.is_repo() else None,
        "pages": len(vault.pages()),
        "queue": WorkQueue(cfg.queue_dir).counts(),
        "wifi": net.status().get("wifi"),
        "git_remote": bool(cfg.git_remote),
    }


def read_queue(cfg):
    q = WorkQueue(cfg.queue_dir)
    out = {"pending": [i for _, i in q.pending()], "failed": []}
    failed_dir = os.path.join(cfg.queue_dir, "failed")
    if os.path.isdir(failed_dir):
        for name in sorted(os.listdir(failed_dir))[-20:]:
            with open(os.path.join(failed_dir, name)) as fh:
                out["failed"].append(json.load(fh))
    return out


def read_prompt(cfg, name):
    if name not in PROMPT_NAMES:
        return None
    vault = Vault(cfg.vault_dir)
    override = os.path.join(vault.root, "prompts", "%s.txt" % name)
    shipped = os.path.join(os.path.dirname(__file__), "prompts", "%s.txt" % name)
    path = override if os.path.isfile(override) else shipped
    with open(path, encoding="utf-8") as fh:
        return {"name": name, "text": fh.read(), "overridden": os.path.isfile(override)}


def write_prompt(cfg, name, text):
    """Save a per-vault prompt override, after checking it keeps the required
    placeholders — otherwise tasks.render would crash."""
    if name not in PROMPT_NAMES:
        raise ValueError("unknown prompt: %s" % name)
    required = {
        "system": ["__VAULT_DESCRIPTION__"],
        "dead_link": ["{target}", "{where}", "{file}", "{page}", "{pages}", "{stub_option}"],
        "orphan": ["{target}", "{orphan_file}", "{page}", "{neighbors}", "{pages}"],
        "enrich": ["{file}", "{page}", "{neighbors}", "{pages}"],
        "correction": ["{file}", "{instruction}", "{page}", "{pages}"],
    }[name]
    missing = [p for p in required if p not in text]
    if missing:
        raise ValueError("prompt is missing required placeholders: %s" % ", ".join(missing))
    vault = Vault(cfg.vault_dir)
    pdir = os.path.join(vault.root, "prompts")
    os.makedirs(pdir, exist_ok=True)
    with open(os.path.join(pdir, "%s.txt" % name), "w", encoding="utf-8") as fh:
        fh.write(text)
    return {"saved": name}


# -- HTTP handler -------------------------------------------------------------


def make_handler(cfg):
    token = read_token(cfg)

    class Handler(BaseHTTPRequestHandler):
        server_version = "wikigardener"

        def log_message(self, *a):
            pass

        # -- helpers --
        def _cookie_token(self):
            raw = self.headers.get("Cookie", "")
            for part in raw.split(";"):
                if part.strip().startswith("wg_session="):
                    return part.strip()[len("wg_session="):]
            return ""

        def _authed(self):
            return token and hmac.compare_digest(self._cookie_token(), token)

        def _same_origin(self):
            host = self.headers.get("Host", "")
            for hdr in ("Origin", "Referer"):
                val = self.headers.get(hdr)
                if val and host and host not in val:
                    return False
            return True

        def _csrf_ok(self):
            return token and hmac.compare_digest(self.headers.get("X-WG-CSRF", ""), token)

        def _send(self, code, body, ctype="application/json"):
            if isinstance(body, (dict, list)):
                body = json.dumps(body).encode("utf-8")
            elif isinstance(body, str):
                body = body.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _body_params(self):
            length = int(self.headers.get("Content-Length", "0"))
            raw = self.rfile.read(length) if length else b""
            try:
                return json.loads(raw.decode("utf-8")) if raw else {}
            except ValueError:
                return {}

        def _stamp(self):
            return int(time.time())

        # -- GET --
        def do_GET(self):
            path = self.path.split("?", 1)[0]
            if path == "/login":
                return self._send(200, _LOGIN_HTML, "text/html")
            if not self._authed():
                self.send_response(302)
                self.send_header("Location", "/login")
                self.end_headers()
                return
            if path == "/":
                return self._send(200, _dashboard_html(token), "text/html")
            if path == "/api/status":
                return self._send(200, read_status(cfg))
            if path == "/api/queue":
                return self._send(200, read_queue(cfg))
            if path == "/api/models":
                return self._send(200, models.list_models(cfg))
            if path == "/api/git/log":
                git = Git(cfg.vault_dir)
                return self._send(200, {"log": git.log_since("", "--oneline -20")})
            if path == "/api/git/diff":
                sha = _query(self.path, "sha")
                git = Git(cfg.vault_dir)
                return self._send(200, {"diff": git._run("show", "--stat", "-p", sha, check=False)})
            if path == "/api/log":
                out = subprocess.run(
                    ["journalctl", "-u", "gardener", "-n", "80", "--no-pager"],
                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                    universal_newlines=True,
                )
                return self._send(200, {"log": out.stdout})
            if path.startswith("/api/prompts"):
                name = _query(self.path, "name") or "system"
                p = read_prompt(cfg, name)
                return self._send(200 if p else 404, p or {"error": "unknown prompt"})
            if path.startswith("/api/jobs/"):
                job = jobs.get(cfg.jobs_dir, path[len("/api/jobs/"):])
                return self._send(200 if job else 404, job or {"error": "no such job"})
            return self._send(404, {"error": "not found"})

        # -- POST --
        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path == "/login":
                params = self._body_params()
                if token and hmac.compare_digest(str(params.get("password", "")), token):
                    self.send_response(204)
                    self.send_header(
                        "Set-Cookie",
                        "wg_session=%s; HttpOnly; SameSite=Strict; Path=/" % token,
                    )
                    self.end_headers()
                else:
                    self._send(401, {"error": "bad password"})
                return
            if not self._authed():
                return self._send(401, {"error": "unauthenticated"})
            if not (self._same_origin() and self._csrf_ok()):
                return self._send(403, {"error": "csrf/origin check failed"})
            params = self._body_params()
            stamp = self._stamp()
            if path == "/api/timer":
                return self._send(200, action_timer(cfg, params))
            if path == "/api/run-once":
                return self._send(200, action_run_once(cfg, params, stamp))
            if path == "/api/audit":
                return self._send(200, action_audit(cfg, params, stamp))
            if path == "/api/sync":
                return self._send(200, action_sync(cfg, params, stamp))
            if path == "/api/wifi":
                return self._send(200, action_wifi(cfg, params))
            if path == "/api/model/download":
                return self._send(200, action_model_download(cfg, params, stamp))
            if path == "/api/model/use":
                return self._send(200, action_model_use(cfg, params, stamp))
            if path == "/api/prompts":
                try:
                    return self._send(200, write_prompt(cfg, params.get("name"), params.get("text", "")))
                except ValueError as exc:
                    return self._send(400, {"error": str(exc)})
            return self._send(404, {"error": "not found"})

    return Handler


def _query(path, key):
    if "?" not in path:
        return ""
    for pair in path.split("?", 1)[1].split("&"):
        if pair.startswith(key + "="):
            from urllib.parse import unquote

            return unquote(pair[len(key) + 1:])
    return ""


class _ThreadingServer(socketserver.ThreadingMixIn, HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def serve(cfg, host=None, port=None):
    host = host or cfg.dashboard_bind
    port = port if port is not None else cfg.dashboard_port
    if not read_token(cfg):
        raise SystemExit(
            "no dashboard token at %s — run `wikigardener setup`" % cfg.dashboard_token_file
        )
    httpd = _ThreadingServer((host, port), make_handler(cfg))
    print("wikigardener dashboard on http://%s:%d" % (host, port))
    httpd.serve_forever()


_LOGIN_HTML = """<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>wikigardener</title>
<style>body{font-family:system-ui;background:#0f1115;color:#e6e6e6;display:grid;place-items:center;height:100vh;margin:0}
form{background:#1a1d24;padding:2rem;border-radius:12px;min-width:280px}input,button{width:100%;padding:.6rem;margin:.3rem 0;border-radius:8px;border:1px solid #333;background:#0f1115;color:#e6e6e6;box-sizing:border-box}
button{background:#3b82f6;border:0;cursor:pointer;font-weight:600}</style>
<form onsubmit="login(event)"><h2>🌱 wikigardener</h2>
<input id=pw type=password placeholder="dashboard password" autofocus>
<button>Unlock</button><p id=err style=color:#f87171></p></form>
<script>async function login(e){e.preventDefault();
const r=await fetch('/login',{method:'POST',headers:{'Content-Type':'application/json'},
body:JSON.stringify({password:document.getElementById('pw').value})});
if(r.ok)location='/';else document.getElementById('err').textContent='wrong password';}</script>"""


def _dashboard_html(csrf):
    return _DASH_HTML.replace("__CSRF__", csrf)


_DASH_HTML = """<!doctype html><meta name=viewport content="width=device-width,initial-scale=1">
<title>wikigardener</title>
<style>
:root{color-scheme:dark}body{font-family:system-ui;background:#0f1115;color:#e6e6e6;margin:0;padding:1rem;max-width:1100px;margin:auto}
h1{font-size:1.2rem}h2{font-size:.95rem;color:#9aa4b2;margin:.2rem 0}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(320px,1fr))}
.card{background:#1a1d24;border:1px solid #262b34;border-radius:12px;padding:1rem}
.kv{display:flex;justify-content:space-between;padding:.15rem 0;border-bottom:1px solid #21252d;font-size:.9rem}
button{background:#2a2f3a;color:#e6e6e6;border:1px solid #3a4150;border-radius:8px;padding:.45rem .7rem;cursor:pointer;font-size:.85rem;margin:.15rem}
button:hover{background:#333a47}.pri{background:#3b82f6;border:0}
pre{background:#0b0d11;padding:.6rem;border-radius:8px;overflow:auto;max-height:240px;font-size:.78rem;white-space:pre-wrap}
select,textarea{width:100%;background:#0b0d11;color:#e6e6e6;border:1px solid #333;border-radius:8px;padding:.4rem;box-sizing:border-box}
textarea{height:200px;font-family:ui-monospace,monospace;font-size:.8rem}
.dot{display:inline-block;width:.6rem;height:.6rem;border-radius:50%;margin-right:.4rem}
.ok{background:#22c55e}.bad{background:#ef4444}small{color:#6b7280}
</style>
<h1>🌱 wikigardener <small id=tps></small></h1>
<div class=grid>
 <div class=card><h2>Status</h2><div id=status></div>
   <div style=margin-top:.5rem>
     <button class=pri onclick="post('/api/run-once')">Run one task now</button>
     <button onclick="post('/api/timer',{state:'pause'})">Pause</button>
     <button onclick="post('/api/timer',{state:'resume'})">Resume</button>
     <button onclick="post('/api/sync')">Sync now</button>
     <button onclick="post('/api/audit')">Audit (online)</button>
     <button onclick="wifi()">Toggle WiFi</button>
   </div><div id=job><small></small></div>
 </div>
 <div class=card><h2>Queue</h2><div id=queue></div></div>
 <div class=card><h2>Model</h2><select id=models></select>
   <div><button onclick="modelDownload()">Download</button>
   <button class=pri onclick="modelUse()">Switch to</button></div></div>
 <div class=card style=grid-column:1/-1><h2>Recent commits</h2><pre id=gitlog></pre></div>
 <div class=card style=grid-column:1/-1><h2>Log</h2><pre id=log></pre></div>
 <div class=card style=grid-column:1/-1><h2>Prompts</h2>
   <select id=promptname onchange=loadPrompt()>
     <option>system</option><option>dead_link</option><option>orphan</option>
     <option>enrich</option><option>correction</option></select>
   <textarea id=prompttext></textarea>
   <button class=pri onclick=savePrompt()>Save override</button>
   <small id=promptmsg></small></div>
</div>
<script>
const CSRF="__CSRF__";
async function get(u){const r=await fetch(u);return r.json()}
async function post(u,b){const r=await fetch(u,{method:'POST',
 headers:{'Content-Type':'application/json','X-WG-CSRF':CSRF},body:JSON.stringify(b||{})});
 const j=await r.json();if(j.job)pollJob(j.job);refresh();return j}
async function pollJob(id){const el=document.querySelector('#job small');
 const t=setInterval(async()=>{const j=await get('/api/jobs/'+id);if(!j)return;
 el.textContent=id+': '+j.state;if(j.state!=='running'){clearInterval(t);refresh()}},2000)}
function row(k,v){return '<div class=kv><span>'+k+'</span><b>'+v+'</b></div>'}
async function refresh(){const s=await get('/api/status');
 document.getElementById('tps').textContent=s.tokens_per_sec?('· '+s.tokens_per_sec+' tok/s'):'';
 const dot=s.llama_healthy?'<span class="dot ok"></span>':'<span class="dot bad"></span>';
 document.getElementById('status').innerHTML=
  row('model',dot+(s.model||'—'))+row('ctx',s.ctx||'—')+row('pages',s.pages)+
  row('changes today',s.changes_today)+row('wifi',s.wifi||'—')+
  row('queue pending',s.queue.pending)+row('queue failed',s.queue.failed);
 const q=await get('/api/queue');
 document.getElementById('queue').innerHTML=(q.pending.length?q.pending.map(i=>
  row(i.type,i.target||'')).join(''):'<small>idle — vault clean & rested</small>')+
  (q.failed.length?'<h2 style=margin-top:.6rem>failed</h2>'+q.failed.slice(-5).map(f=>
  row(f.type||'?',(f.error||'').slice(0,40))).join(''):'');
 document.getElementById('gitlog').textContent=(await get('/api/git/log')).log;
 document.getElementById('log').textContent=(await get('/api/log')).log;
 const m=await get('/api/models');document.getElementById('models').innerHTML=
  m.models.map(x=>'<option value="'+x.id+'"'+(x.active?' selected':'')+'>'+
  (x.active?'● ':'')+x.name+(x.installed?'':' (download)')+(x.fits?'':' ✗tier')+'</option>').join('');}
function modelDownload(){post('/api/model/download',{target:document.getElementById('models').value})}
function modelUse(){post('/api/model/use',{target:document.getElementById('models').value})}
async function wifi(){const s=await get('/api/status');
 post('/api/wifi',{state:s.wifi==='enabled'?'off':'on'})}
async function loadPrompt(){const n=document.getElementById('promptname').value;
 const p=await get('/api/prompts?name='+n);document.getElementById('prompttext').value=p.text;
 document.getElementById('promptmsg').textContent=p.overridden?'(custom override)':'(shipped default)'}
async function savePrompt(){const n=document.getElementById('promptname').value;
 const r=await fetch('/api/prompts',{method:'POST',
  headers:{'Content-Type':'application/json','X-WG-CSRF':CSRF},
  body:JSON.stringify({name:n,text:document.getElementById('prompttext').value})});
 const j=await r.json();document.getElementById('promptmsg').textContent=
  r.ok?'saved ✓':('error: '+j.error)}
refresh();loadPrompt();setInterval(refresh,7000);
</script>"""
