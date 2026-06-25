"""
SQLAlchemy ORM models.
Each table is owned by exactly one domain service.
"""

import enum as py_enum
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, Text
from sqlalchemy import Enum as SQLEnum
from sqlalchemy.sql import func
from app.storage.database import Base


class ProviderStatusEnum(str, py_enum.Enum):
    ACTIVE = "active"
    LIMITED = "limited"
    COOLDOWN = "cooldown"
    INACTIVE = "inactive"


class KeyStatusEnum(str, py_enum.Enum):
    ACTIVE = "active"
    DEGRADED = "degraded"
    DISABLED = "disabled"


# ── Owned by: auth-service ────────────────────────────────────────────────────

class DBUser(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True, nullable=False)
    email = Column(String, unique=True, index=True, nullable=True)
    hashed_password = Column(String(60), nullable=False)
    is_active = Column(Boolean, default=True)
    is_admin = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())


# ── Owned by: provider-service ────────────────────────────────────────────────

class DBProvider(Base):
    __tablename__ = "providers"
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(String, unique=True, index=True, nullable=False)
    name = Column(String, nullable=False)
    base_url = Column(String, nullable=False)
    api_key = Column(String, nullable=False)   # always encrypted (enc:...)
    models = Column(Text, default="[]")        # JSON array
    priority = Column(Integer, default=1)
    weight = Column(Float, default=1.0)
    status = Column(String, default="active")
    requests_today = Column(Integer, default=0)
    total_requests = Column(Integer, default=0)
    failures = Column(Integer, default=0)
    avg_latency_ms = Column(Float, default=0.0)
    last_success = Column(Float, default=0.0)
    last_failure = Column(Float, default=0.0)
    cooldown_until = Column(Float, default=0.0)
    created_at = Column(DateTime, server_default=func.now())


class DBProviderKey(Base):
    __tablename__ = "provider_keys"
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(String, index=True, nullable=False)
    api_key = Column(String, nullable=False)   # always encrypted
    label = Column(String, nullable=True)
    is_active = Column(Boolean, default=True)
    status = Column(String, default="active")
    weight = Column(Float, default=10.0)
    requests_used = Column(Integer, default=0)
    consecutive_failures = Column(Integer, default=0)
    failures = Column(Integer, default=0)
    avg_latency_ms = Column(Float, default=0.0)
    last_success = Column(Float, default=0.0)
    last_failure = Column(Float, default=0.0)
    disabled_until = Column(Float, default=0.0)
    created_at = Column(DateTime, server_default=func.now())


# ── Owned by: usage-recorder ──────────────────────────────────────────────────

class DBUsageRecord(Base):
    __tablename__ = "usage_records"
    id = Column(Integer, primary_key=True, index=True)
    provider_id = Column(String, index=True)
    model = Column(String)
    tokens_used = Column(Integer, default=0)
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    latency_ms = Column(Float, default=0.0)
    success = Column(Boolean, default=True)
    estimated_cost_usd = Column(Float, default=0.0)
    timestamp = Column(DateTime, server_default=func.now(), index=True)


# ── Owned by: economy-service ─────────────────────────────────────────────────

class DBBudget(Base):
    __tablename__ = "budget"
    id = Column(Integer, primary_key=True, index=True)
    daily_limit_usd = Column(Float, default=0.0)
    spent_today_usd = Column(Float, default=0.0)
    cheap_threshold_pct = Column(Float, default=0.9)
    last_reset = Column(Float, default=0.0)
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
