"""Runs migrations against DATABASE_URL. Revisions 0001-0005 replay the SQL of the Prisma migrations, so a database
built by Prisma only needs `alembic stamp 0005` at cut-over."""

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

import app.models  # noqa: F401  (registers every table on Base.metadata for autogenerate)
from app.platform.config import env
from app.platform.db.base import Base
from app.platform.db.session import _psycopg_url

if context.config.config_file_name:
    fileConfig(context.config.config_file_name)

target_metadata = Base.metadata


def run_offline() -> None:
    context.configure(url=_psycopg_url(env.database_url), target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()


def run_online() -> None:
    engine = create_engine(_psycopg_url(env.database_url), poolclass=pool.NullPool)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_offline()
else:
    run_online()
