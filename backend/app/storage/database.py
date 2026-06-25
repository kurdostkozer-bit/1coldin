"""
Storage layer — database engine, session factory, init.
Owns: all SQLAlchemy setup. Nothing else imports Base directly.
"""

import os
from contextlib import contextmanager
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker, declarative_base
from sqlalchemy.pool import NullPool, StaticPool

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./kurdbox.db")

_is_sqlite = DATABASE_URL.startswith("sqlite")

if _is_sqlite:
    # StaticPool: single persistent connection for SQLite — eliminates
    # per-request connection overhead without sacrificing thread safety.
    engine = create_engine(
        DATABASE_URL,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    # Enable WAL mode for better read concurrency on SQLite
    @event.listens_for(engine, "connect")
    def _set_wal(conn, _rec):
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
else:
    # PostgreSQL: use default QueuePool (5 connections, overflow 10)
    engine = create_engine(DATABASE_URL)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def init_db() -> None:
    """Create all tables. Safe to call multiple times."""
    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI dependency — yields a DB session, closes on exit."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@contextmanager
def get_db_session():
    """Context manager for use outside FastAPI (startup, scripts)."""
    db = SessionLocal()
    try:
        yield db
        db.commit()
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()
