import json, numpy as np, urllib.parse, sys
from http.server import BaseHTTPRequestHandler, HTTPServer
from sentence_transformers import SentenceTransformer
vecs = np.load('/tmp/codemap-bench/vecs.npy'); meta = json.load(open('/tmp/codemap-bench/meta.json'))
m = SentenceTransformer('nomic-ai/CodeRankEmbed', trust_remote_code=True)
PREFIX = 'Represent this query for searching relevant code: '
class H(BaseHTTPRequestHandler):
    def do_GET(self):
        p = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        q = p.get('q', [''])[0]; k = int(p.get('k', ['8'])[0])
        qe = m.encode([PREFIX + q], normalize_embeddings=True)[0]
        top = np.argsort(-(vecs @ qe))[:k]
        out = [{'file': meta[i]['file'], 'line': int(meta[i]['line']), 'name': meta[i]['name'], 'searchText': meta[i]['searchText']} for i in top]
        b = json.dumps(out).encode()
        self.send_response(200); self.send_header('Content-Type', 'application/json'); self.end_headers(); self.wfile.write(b)
    def log_message(self, *a): pass
print('READY', flush=True)
HTTPServer(('127.0.0.1', 8799), H).serve_forever()
