from pydantic import BaseModel
from typing import Optional, List
from enum import Enum


class ProviderStatus(str, Enum):
    ACTIVE = "active"
    LIMITED = "limited"
    COOLDOWN = "cooldown"
    INACTIVE = "inactive"


class Provider(BaseModel):
    id: str
    name: str
    base_url: str
    api_key: str          # plaintext in memory, encrypted in DB
    models: List[str] = []
    priority: int = 1
    weight: float = 1.0
    status: ProviderStatus = ProviderStatus.ACTIVE
    requests_today: int = 0
    total_requests: int = 0
    failures: int = 0
    avg_latency_ms: float = 0.0
    last_success: float = 0.0
    last_failure: float = 0.0
    cooldown_until: float = 0.0
    total_cost_usd: float = 0.0


class ProviderAdd(BaseModel):
    provider_type: str
    api_key: str


class ProviderUpdate(BaseModel):
    priority: Optional[int] = None
    weight: Optional[float] = None
    status: Optional[ProviderStatus] = None


class ProviderKeyAdd(BaseModel):
    api_key: str
    label: Optional[str] = None
    weight: Optional[float] = 10.0


class ProviderKeyInfo(BaseModel):
    id: int
    provider_id: str
    label: Optional[str] = None
    is_active: bool
    status: str
    weight: float
    requests_used: int
    failures: int
    consecutive_failures: int
    avg_latency_ms: float
    last_success: float
    last_failure: float
    key_preview: str
