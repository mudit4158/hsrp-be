"""init (replays prisma/schema/migrations/0001_init)

Revision ID: 0001
Revises: None
"""

from app.platform.db.migrate import run_sql_file

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file("0001_init.sql")


def downgrade() -> None:
    raise NotImplementedError("Baseline migrations are forward-only (as the Prisma migrations were)")
