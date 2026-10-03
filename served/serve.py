import http.server
import socketserver
import os

DIRECTORY = os.path.dirname(os.path.abspath(__file__))
PORT = int(os.environ.get("PORT", "12000"))


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=DIRECTORY, **kwargs)

    def end_headers(self):
        # Force a save-dialog download rather than inline display, keeping the
        # requested file's own name.
        name = os.path.basename(self.path.rstrip("/"))
        if name.endswith(".txt") or name.endswith(".zip"):
            self.send_header(
                "Content-Disposition",
                f'attachment; filename="{name}"',
            )
        super().end_headers()


socketserver.TCPServer.allow_reuse_address = True
with socketserver.TCPServer(("0.0.0.0", PORT), Handler) as httpd:
    httpd.serve_forever()
