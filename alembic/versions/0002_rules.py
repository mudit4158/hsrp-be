"""rules (replays prisma/schema/migrations/0002_rules)

Revision ID: 0002
Revises: 0001
"""

from app.platform.db.migrate import run_sql_file

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file("0002_rules.sql")


def downgrade() -> None:
    raise NotImplementedError("Baseline migrations are forward-only (as the Prisma migrations were)")
