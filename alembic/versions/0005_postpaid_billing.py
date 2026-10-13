"""postpaid billing (replays prisma/schema/migrations/0005_postpaid_billing)

Revision ID: 0005
Revises: 0004
"""

from app.platform.db.migrate import run_sql_file

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file("0005_postpaid_billing.sql")


def downgrade() -> None:
    raise NotImplementedError("Baseline migrations are forward-only (as the Prisma migrations were)")
