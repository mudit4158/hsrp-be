"""Helper for the baseline Alembic revisions that replay the Prisma migration SQL (alembic/sql/)."""

from pathlib import Path

from alembic import op

SQL_DIR = Path(__file__).resolve().parents[3] / "alembic" / "sql"


def run_sql_file(name: str) -> None:
    sql = (SQL_DIR / name).read_text(encoding="utf-8")
    # Raw DBAPI cursor: no bind parameters, so psycopg runs the multi-statement script (incl. $$ bodies) as written.
    op.get_bind().connection.driver_connection.execute(sql)
