import time, numpy as np
from sentence_transformers import SentenceTransformer
m = SentenceTransformer("Qodo/Qodo-Embed-1-1.5B")
docs = ["function f%d(){ return %d }" % (i,i) for i in range(64)]
m.encode(docs[:4], batch_size=4)  # warmup
t=time.time(); m.encode(docs, batch_size=16, show_progress_bar=False); dt=time.time()-t
print(f"steady: 64 docs in {dt:.1f}s = {dt/64:.2f}s/doc → full 7727 = {dt/64*7727/60:.0f} min", flush=True)
# fairer retry probe vs the actual withRetry signature + a few distractors
q=m.encode(["when the server is overloaded, wait and try the request again"],normalize_embeddings=True)[0]
cand={"withRetry(retry.ts)":"async function* withRetry(options) { for (let attempt = 0; attempt < maxRetries; attempt++) { try { yield* fn() } catch(e){ if isRateLimit await delay(backoff) } } }",
"WAIT_SERVER_TIMEOUT":"const WAIT_SERVER_DEFAULT_TIMEOUT = 15000",
"parseAssistantMessage":"function parseAssistantMessageV2(text){ ... }"}
ce=m.encode(list(cand.values()),normalize_embeddings=True)
for k,v in sorted(zip(cand,ce@q),key=lambda x:-x[1]): print(f"  {x:=v:.3f}  {k}" if False else f"  {v:.3f}  {k}", flush=True)
