"""Static server that mimics `npx serve` (serve-handler) cleanUrls default:
any request for *.html is answered with a 301 to the clean URL
(/index.html -> /, /about.html -> /about). Everything else is served normally."""
import http.server, sys, os
class H(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = self.path.split('?')[0]
        if path.endswith('.html'):
            clean = path[:-5]
            if clean.endswith('/index'): clean = clean[:-5]
            self.send_response(301); self.send_header('Location', clean or '/'); self.end_headers(); return
        return super().do_GET()
    def log_message(self, fmt, *a):
        sys.stderr.write('%s %s\n' % (self.command, self.path))
os.chdir(sys.argv[1]); http.server.ThreadingHTTPServer(('127.0.0.1', int(sys.argv[2])), H).serve_forever()
