"""Background jobs for the dashboard. Long actions (model download, an
on-demand gardening run, an audit) can't block the single-threaded-ish web
server, so they run as detached subprocesses that write a status file the UI
polls — the same file-per-item, ls-debuggable idiom as the work queue.

  jobs/<id>.status  JSON {id, cmd, state, rc, started, finished}
  jobs/<id>.log     combined stdout/stderr
"""
import json
import os
import subprocess


def _paths(jobs_dir, job_id):
    return (
        os.path.join(jobs_dir, "%s.status" % job_id),
        os.path.join(jobs_dir, "%s.log" % job_id),
    )


def start(jobs_dir, job_id, argv, stamp):
    """Spawn argv detached, tee output to the log, record status. Returns the
    job id. `stamp` is a monotonic-ish integer the caller supplies (the web
    server has time; scripts don't use Date in workflows)."""
    os.makedirs(jobs_dir, exist_ok=True)
    status_path, log_path = _paths(jobs_dir, job_id)
    _write(status_path, {"id": job_id, "cmd": argv, "state": "running",
                         "rc": None, "started": stamp, "finished": None})
    log = open(log_path, "wb")
    # a tiny wrapper process runs argv, then finalizes the status file, so the
    # dashboard request returns immediately
    wrapper = (
        "import json,subprocess,sys\n"
        "rc=subprocess.call(sys.argv[2:],stdout=open(sys.argv[1],'ab'),"
        "stderr=subprocess.STDOUT)\n"
        "s=json.load(open(%r));s['state']='done' if rc==0 else 'failed';"
        "s['rc']=rc;json.dump(s,open(%r,'w'))\n" % (status_path, status_path)
    )
    subprocess.Popen(
        ["python3", "-c", wrapper, log_path] + list(argv),
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        close_fds=True,
    )
    log.close()
    return job_id


def get(jobs_dir, job_id):
    status_path, log_path = _paths(jobs_dir, job_id)
    if not os.path.exists(status_path):
        return None
    with open(status_path) as fh:
        status = json.load(fh)
    tail = ""
    if os.path.exists(log_path):
        with open(log_path, "rb") as fh:
            data = fh.read()[-4000:]
        tail = data.decode("utf-8", "replace")
    status["log_tail"] = tail
    return status


def _write(path, obj):
    tmp = path + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(obj, fh)
    os.rename(tmp, path)
