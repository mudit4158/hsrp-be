"""oem vehicle data (replays prisma/schema/migrations/0003_oem_vehicle_data)

Revision ID: 0003
Revises: 0002
"""

from app.platform.db.migrate import run_sql_file

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    run_sql_file("0003_oem_vehicle_data.sql")


def downgrade() -> None:
    raise NotImplementedError("Baseline migrations are forward-only (as the Prisma migrations were)")
