"""Engine, sessions and transactions. Mirrors the NestJS PrismaService: `tx()` runs one transaction and fires
after-commit hooks (the event bus uses one to dispatch new outbox rows at once)."""

from collections.abc import Callable, Iterator
from contextlib import contextmanager

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.platform.config import env


def _psycopg_url(url: str) -> str:
    # The .env uses Prisma's postgresql:// URL; SQLAlchemy needs the driver name. Prisma's ?schema= is not a libpq option.
    url = url.split("?schema=")[0]
    for prefix in ("postgresql://", "postgres://"):
        if url.startswith(prefix):
            return "postgresql+psycopg://" + url[len(prefix):]
    return url


class Database:
    def __init__(self, url: str | None = None):
        self.engine = create_engine(_psycopg_url(url or env.database_url), pool_pre_ping=True, pool_size=10, max_overflow=10, future=True)
        self.factory = sessionmaker(self.engine, expire_on_commit=False, autoflush=True)
        self._after_commit: list[Callable[[], None]] = []

    def on_after_commit(self, hook: Callable[[], None]) -> None:
        self._after_commit.append(hook)

    @contextmanager
    def tx(self) -> Iterator[Session]:
        """One transaction; commits on success, rolls back on error, then runs the after-commit hooks."""
        s = self.factory()
        try:
            yield s
            s.commit()
        except BaseException:
            s.rollback()
            raise
        finally:
            s.close()
        for hook in self._after_commit:
            hook()

    @contextmanager
    def use(self, s: Session | None = None) -> Iterator[Session]:
        """The caller's session when given (so writes join its transaction), else a short transaction of our own."""
        if s is not None:
            yield s
            return
        with self.tx() as own:
            yield own


_db: Database | None = None


def get_db() -> Database:
    global _db
    if _db is None:
        _db = Database()
    return _db


def set_db(db: Database) -> None:
    """Tests point the app at the test database."""
    global _db
    _db = db
