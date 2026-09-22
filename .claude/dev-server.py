"""Local dev server for Arkham Grimoire.

Same as `python -m http.server`, plus `Cache-Control: no-cache` on every
response: without it the browser heuristically caches CSS and HTML, and a
plain refresh keeps showing the previous version. Serves the project root
(the folder above .claude/) on $PORT, 4173 by default.
"""
import functools
import http.server
import os

PORT = int(os.environ.get("PORT", "4173"))
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


if __name__ == "__main__":
    handler = functools.partial(NoCacheHandler, directory=ROOT)
    with http.server.ThreadingHTTPServer(("127.0.0.1", PORT), handler) as httpd:
        print(f"Serving {ROOT} on http://localhost:{PORT} (no-cache)", flush=True)
        httpd.serve_forever()
