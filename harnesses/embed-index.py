import json, time, numpy as np
t=time.time()
from sentence_transformers import SentenceTransformer
idx = json.load(open("/tmp/codemap-bench/cline-bug.map.json"))
ents = [e for e in idx["entries"] if not e["file"].endswith((".test.ts",".spec.ts"))]
texts = [f"{e['name']}: {e.get('searchText','')}"[:300] for e in ents]
m = SentenceTransformer("nomic-ai/CodeRankEmbed", trust_remote_code=True)
print(f"model loaded {time.time()-t:.0f}s; embedding {len(texts)} symbols...", flush=True)
vecs = m.encode(texts, batch_size=64, show_progress_bar=False, normalize_embeddings=True)
np.save("/tmp/codemap-bench/vecs.npy", vecs.astype("float32"))
json.dump([{"id":e["id"],"file":e["file"],"line":e["line"],"name":e["name"],"searchText":e.get("searchText","")} for e in ents], open("/tmp/codemap-bench/meta.json","w"))
print(f"DONE: {vecs.shape} saved, total {time.time()-t:.0f}s", flush=True)
