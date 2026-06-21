import json, re, numpy as np
from sentence_transformers import SentenceTransformer

vecs = np.load("/tmp/codemap-bench/vecs.npy")
meta = json.load(open("/tmp/codemap-bench/meta.json"))
m = SentenceTransformer("nomic-ai/CodeRankEmbed", trust_remote_code=True)
PREFIX = "Represent this query for searching relevant code: "

# Concept queries phrased to AVOID the implementation's own words (vocab mismatch).
QUERIES = [
    ("when the server is overloaded or rejects us, wait and try the request again", r"retry\.ts#withRetry"),
    ("stop the same network request from being fired twice at the same time", r"openai-native\.ts#(createResponseStreamWebsocket|handleStreamResponse)"),
    ("turn the model's streamed output text into structured tool actions", r"parse-assistant-message\.ts#parseAssistantMessageV2"),
    ("let a long-running request be interrupted partway through", r"#.*([Aa]bort|stream)"),
    ("strip or hide private content from messages before sending them out", r"openai-format\.ts#convertToOpenAiMessages|sanitize"),
]

def search(q, k=10):
    qe = m.encode([PREFIX + q], normalize_embeddings=True)[0]
    sims = vecs @ qe
    return np.argsort(-sims)[:k]

print(f"{'query':<58} semantic-rank")
hits = 0
for q, gtpat in QUERIES:
    top = search(q)
    rank = None
    for i, idx in enumerate(top):
        key = f"{meta[idx]['file']}#{meta[idx]['name']}"
        if re.search(gtpat, key):
            rank = i + 1
            break
    hits += rank is not None and rank <= 10
    top3 = ", ".join(f"{meta[idx]['name']}" for idx in top[:3])
    print(f"{q[:56]:<58} {('#'+str(rank)) if rank else 'MISS'}   top3: {top3}")
print(f"\nsemantic recall@10: {hits}/{len(QUERIES)}")
