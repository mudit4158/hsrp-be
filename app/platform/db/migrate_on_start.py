"""Container start-up migration: `python -m app.platform.db.migrate_on_start`. A database built by the NestJS backend
(Prisma migrations 0001–0005, no alembic_version table) has exactly the schema of Alembic revision 0005, so it is
stamped at 0005 instead of being created again; then every newer revision is applied."""

import logging
import sys

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect

from app.platform.config import ROOT
from app.platform.db.session import get_db

log = logging.getLogger("migrate")


def main() -> int:
    logging.basicConfig(level=logging.INFO, format="[migrate] %(message)s")
    cfg = Config(str(ROOT / "alembic.ini"))
    tables = set(inspect(get_db().engine).get_table_names())
    if "alembic_version" not in tables and "core_ord_order" in tables:
        log.info("Schema built by Prisma found: stamping Alembic revision 0005")
        command.stamp(cfg, "0005")
    command.upgrade(cfg, "head")
    return 0


if __name__ == "__main__":
    sys.exit(main())
