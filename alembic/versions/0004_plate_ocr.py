"""plate ocr (replays prisma/schema/migrations/0004_plate_ocr)

Revision ID: 0004
Revises: 0003
"""

from app.platform.db.migrate import run_sql_file

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file("0004_plate_ocr.sql")


def downgrade() -> None:
    raise NotImplementedError("Baseline migrations are forward-only (as the Prisma migrations were)")
