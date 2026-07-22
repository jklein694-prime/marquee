"""A canned llama-server stand-in: /health + /completion on an ephemeral port.

Responses are popped from a list (last resort: no_change), so a test scripts
exactly what "the model" says each round.
"""
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer


class MockLlama(object):
    def __init__(self):
        self.responses = []
        self.requests = []
        outer = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def do_GET(self):
                if self.path == "/health":
                    body = json.dumps({"status": "ok"}).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(body)
                else:
                    self.send_response(404)
                    self.end_headers()

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                outer.requests.append(json.loads(self.rfile.read(length).decode()))
                content = (
                    outer.responses.pop(0)
                    if outer.responses
                    else '{"action": "no_change", "reason": "mock default"}'
                )
                body = json.dumps({"content": content}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(body)

        self.server = HTTPServer(("127.0.0.1", 0), Handler)
        self.url = "http://127.0.0.1:%d" % self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever)
        self.thread.daemon = True

    def start(self):
        self.thread.start()
        return self

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
