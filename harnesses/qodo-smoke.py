import time
t=time.time()
from sentence_transformers import SentenceTransformer
m = SentenceTransformer("Qodo/Qodo-Embed-1-1.5B", trust_remote_code=True)
load=time.time()-t
import numpy as np
t2=time.time()
q = m.encode(["where the code waits and retries when the server is overloaded"], normalize_embeddings=True)
docs = m.encode([
  "export function withRetry(options){for(let attempt=0;attempt<maxRetries;attempt++){}}",
  "function parseAssistantMessage(){}",
  "const WAIT_SERVER_DEFAULT_TIMEOUT=15000",
], normalize_embeddings=True)
embt=time.time()-t2
cos=[round(float(q[0]@d),3) for d in docs]
print(f"OK dim={q.shape[1]} load={load:.0f}s embed4={embt:.1f}s per-embed={embt/4:.2f}s", flush=True)
print(f"cos(retryCode/parse/WAIT_const)={cos}  (want retryCode highest)", flush=True)
print(f"est full 7727 symbols: {embt/4*7727/60:.0f} min", flush=True)
