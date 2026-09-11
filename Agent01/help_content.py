"""Checkpoint 4 of the assistant widget: embeds the help-center FAQ content
into pgvector so Checkpoint 5 can ground /chat's answers in it, instead of
the model guessing at what the product actually does.

The content itself lives in frontend/src/data/helpContent.json - the exact
file HelpCenter.jsx renders - not a separate copy here. That keeps the help
page and the chat assistant's grounding describing the same product, rather
than two hand-maintained lists that quietly drift apart over time.
"""
import hashlib
import json
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from Agent import gemini
from db import HELP_EMBEDDING_DIM, HelpArticleEmbedding

HELP_CONTENT_PATH = (
    Path(__file__).resolve().parent.parent / "frontend" / "src" / "data" / "helpContent.json"
)

# Gemini's embedding model, called through the same OpenAI-compatible client
# Agent.py already configures for chat/hashtags - no separate SDK/client
# needed just for embeddings. gemini-embedding-001 defaults to 3072 dims but
# supports truncating to 768/1536/3072 via `dimensions` (mapped to Google's
# native output_dimensionality by the OpenAI-compat layer); 768 keeps rows
# small and is plenty for a ~30-article FAQ corpus. Max input is 2048
# tokens/call - every article's question+answer here is a few hundred words
# at most, well under that, but worth revisiting if help content grows into
# longer articles later.
EMBEDDING_MODEL = "gemini-embedding-001"


def _load_articles() -> list[dict]:
    """Flatten helpContent.json's [{key, title, articles: [{q, a}]}, ...]
    into one dict per article, keyed by a stable "{section_key}:{index}"
    id so re-runs can tell "same article, text changed" apart from "this
    article no longer exists". The embedded text is question+answer
    together, since a user's question is more likely to resemble the
    article's own question than its answer alone.
    """
    sections = json.loads(HELP_CONTENT_PATH.read_text())
    articles = []
    for section in sections:
        for i, article in enumerate(section["articles"]):
            text = f"{article['q']}\n{article['a']}"
            articles.append({
                "article_id": f"{section['key']}:{i}",
                "section_key": section["key"],
                "section_title": section["title"],
                "question": article["q"],
                "answer": article["a"],
                "content_hash": hashlib.sha256(text.encode()).hexdigest(),
                "text": text,
            })
    return articles


def _embed_sync(text: str) -> list[float]:
    """Blocking Gemini embeddings call - always run via run_in_threadpool,
    same convention as every other blocking call in this codebase (Agent.py,
    oauth_platforms.py, etc.)."""
    resp = gemini.embeddings.create(model=EMBEDDING_MODEL, input=text, dimensions=HELP_EMBEDDING_DIM)
    return resp.data[0].embedding


async def sync_help_embeddings(db: AsyncSession) -> dict:
    """Bring help_article_embeddings in line with the current
    helpContent.json: embed anything new or changed, leave anything
    unchanged alone, delete anything removed. Called once from main.py's
    on_startup, after init_db - cheap even in the worst case (embedding
    every article from scratch) at this corpus size (~30-50 articles), and
    it only runs once per process start, not per request.

    content_hash is what makes this a sync instead of a blind re-embed on
    every restart: a backend redeploy where nobody touched helpContent.json
    costs zero embedding calls, not one per article.
    """
    articles = _load_articles()
    current_ids = {a["article_id"] for a in articles}

    existing_rows = (await db.execute(select(HelpArticleEmbedding))).scalars().all()
    existing_by_id = {row.article_id: row for row in existing_rows}

    embedded = skipped = deleted = 0

    for article in articles:
        row = existing_by_id.get(article["article_id"])
        if row is not None and row.content_hash == article["content_hash"]:
            skipped += 1
            continue

        vector = await run_in_threadpool(_embed_sync, article["text"])
        if row is None:
            db.add(HelpArticleEmbedding(
                article_id=article["article_id"],
                section_key=article["section_key"],
                section_title=article["section_title"],
                question=article["question"],
                answer=article["answer"],
                content_hash=article["content_hash"],
                embedding=vector,
            ))
        else:
            row.section_key = article["section_key"]
            row.section_title = article["section_title"]
            row.question = article["question"]
            row.answer = article["answer"]
            row.content_hash = article["content_hash"]
            row.embedding = vector
        embedded += 1

    # Articles that used to exist in helpContent.json but don't anymore -
    # drop their rows rather than leaving stale embeddings that could still
    # get retrieved by Checkpoint 5's RAG lookup.
    stale_ids = set(existing_by_id) - current_ids
    for stale_id in stale_ids:
        await db.delete(existing_by_id[stale_id])
        deleted += 1

    await db.commit()
    result = {"embedded": embedded, "skipped": skipped, "deleted": deleted}
    print(f"[help_content] sync complete: {result}")
    return result


# Checkpoint 5 - RAG retrieval

RETRIEVAL_K = 4

# Cosine distance (0 = identical meaning, 2 = opposite) above which we treat
# a message as not needing product grounding at all. A greeting or "thanks!"
# ends up nowhere near any FAQ article's distance, so this keeps chat_reply
# from being handed irrelevant context it'd have to awkwardly work around.
# Picked as a reasonable starting point for a ~30-article corpus, not
# measured against real traffic yet - if answers feel under- or
# over-grounded once this is live, this is the first knob to turn.
RETRIEVAL_MAX_DISTANCE = 0.55


async def retrieve_help_context(db: AsyncSession, query: str) -> list[dict]:
    """Checkpoint 5: embed `query` (the user's latest chat message) and
    return the closest help articles in help_article_embeddings, closest
    first, for chat_reply to ground its answer in. Returns [] when nothing
    clears RETRIEVAL_MAX_DISTANCE, rather than forcing in context that
    doesn't actually apply to what was asked.

    Each dict is {"question": str, "answer": str, "distance": float} -
    plain data, not ORM rows, so it's safe to hand to chat_reply after the
    request's db session context has moved on.
    """
    query_vector = await run_in_threadpool(_embed_sync, query)

    distance = HelpArticleEmbedding.embedding.cosine_distance(query_vector)
    rows = (await db.execute(
        select(HelpArticleEmbedding, distance.label("distance"))
        .where(distance < RETRIEVAL_MAX_DISTANCE)
        .order_by(distance)
        .limit(RETRIEVAL_K)
    )).all()

    return [
        {"question": article.question, "answer": article.answer, "distance": float(dist)}
        for article, dist in rows
    ]