"""One-off check: what values does inbox_kind_enum actually have in Postgres?
Uses the same DATABASE_URL / engine setup as the rest of the app (db.py),
so no need to know the db name, user, or password separately - if
`alembic upgrade head` works, this will too.

Run from Agent01/:
    python check_inbox_enum.py
"""
import asyncio

from db import engine
from sqlalchemy import text


async def main():
    async with engine.connect() as conn:
        result = await conn.execute(text("SELECT enum_range(NULL::inbox_kind_enum)"))
        print("inbox_kind_enum values:", result.scalar())


if __name__ == "__main__":
    asyncio.run(main())