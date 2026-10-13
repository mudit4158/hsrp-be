"""Test database: hsrp_py_test on the Compose PostgreSQL (port 5433), created and migrated once per run."""

import os

import pytest
from sqlalchemy import create_engine, text

from alembic import command
from alembic.config import Config
from app.platform.config import ROOT, env
from app.platform.db.session import Database, _psycopg_url, set_db

TEST_DB = "hsrp_py_test"


def _test_url() -> str:
    base = env.database_url.split("?")[0]
    return base.rsplit("/", 1)[0] + "/" + TEST_DB


@pytest.fixture(scope="session")
def db() -> Database:
    admin = create_engine(_psycopg_url(env.database_url.rsplit("/", 1)[0] + "/postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f'DROP DATABASE IF EXISTS "{TEST_DB}" WITH (FORCE)'))
        c.execute(text(f'CREATE DATABASE "{TEST_DB}"'))
    admin.dispose()

    url = _test_url()
    os.environ["PY_DATABASE_URL"] = url
    command.upgrade(Config(str(ROOT / "alembic.ini")), "head")
    database = Database(url)
    set_db(database)
    from app.container import reset_container

    reset_container()
    return database


def reset_db(database: Database) -> None:
    with database.tx() as s:
        tables = s.scalars(text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'alembic_version'")).all()
        s.execute(text(f"TRUNCATE TABLE {', '.join(f'\"{t}\"' for t in tables)} RESTART IDENTITY CASCADE"))


@pytest.fixture
def clean(db) -> Database:
    """An empty test database (every table truncated) for tests that write."""
    reset_db(db)
    return db


TEST_TENANT = "t-test"


def as_system(fn):
    """Runs `fn` as the system actor of the test tenant (services read the tenant from the request context)."""
    from app.platform.context import request_context

    return request_context.run_as_system(TEST_TENANT, fn)


@pytest.fixture(scope="session")
def client(db):
    from fastapi.testclient import TestClient

    from app.main import create_app

    return TestClient(create_app())
