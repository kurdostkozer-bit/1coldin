"""
Supported provider configurations — copied from old providers_config.py.
Single source of truth for base_url, models, priority, key detection.
"""

import re

SUPPORTED_PROVIDERS: dict = {
    "groq": {
        "name": "Groq Cloud",
        "base_url": "https://api.groq.com/openai/v1",
        "models": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "mixtral-8x7b-32768"],
        "priority": 1, "weight": 2.0,
        "key_hint": "Starts with: gsk_",
        "key_prefixes": ["gsk_"],
        "pricing": {"input": 0.05, "output": 0.10},
    },
    "sambanova": {
        "name": "SambaNova Cloud",
        "base_url": "https://api.sambanova.ai/v1",
        "models": ["DeepSeek-V3.1", "Meta-Llama-3.3-70B-Instruct", "Meta-Llama-3.1-405B-Instruct", "Meta-Llama-3.1-8B-Instruct"],
        "priority": 2, "weight": 1.5,
        "key_hint": "UUID format or starts with sn-",
        "key_prefixes": ["sn-"],
        "pricing": {"input": 0.10, "output": 0.20},
    },
    "gemini": {
        "name": "Google Gemini",
        "base_url": "https://generativelanguage.googleapis.com/v1beta/openai/",
        "models": ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-1.5-flash"],
        "priority": 2, "weight": 1.5,
        "key_hint": "Starts with: AIzaSy",
        "key_prefixes": ["AIzaSy"],
        "pricing": {"input": 0.075, "output": 0.30},
    },
    "cerebras": {
        "name": "Cerebras Cloud",
        "base_url": "https://api.cerebras.ai/v1",
        "models": ["llama3.3-70b", "llama3.1-70b", "llama3.1-8b"],
        "priority": 1, "weight": 2.0,
        "key_hint": "Starts with: csk_",
        "key_prefixes": ["csk_"],
        "pricing": {"input": 0.10, "output": 0.10},
    },
    "mistral": {
        "name": "Mistral AI",
        "base_url": "https://api.mistral.ai/v1",
        "models": ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
        "priority": 2, "weight": 1.5,
        "key_hint": "Mistral console API key",
        "key_prefixes": [],
        "pricing": {"input": 0.25, "output": 0.25},
    },
    "openrouter": {
        "name": "OpenRouter",
        "base_url": "https://openrouter.ai/api/v1",
        "models": ["google/gemini-flash-1.5-free", "meta-llama/llama-3-8b-instruct:free"],
        "priority": 3, "weight": 1.0,
        "key_hint": "Starts with: sk-or-v1-",
        "key_prefixes": ["sk-or-v1-", "sk-or-"],
        "pricing": {"input": 0.00, "output": 0.00},
    },
    "nvidia": {
        "name": "NVIDIA NIM",
        "base_url": "https://integrate.api.nvidia.com/v1",
        "models": ["meta/llama-3.1-70b-instruct", "meta/llama-3.1-8b-instruct"],
        "priority": 2, "weight": 1.5,
        "key_hint": "Starts with: nvapi-",
        "key_prefixes": ["nvapi-"],
        "pricing": {"input": 0.20, "output": 0.20},
    },
    "github": {
        "name": "GitHub Models",
        "base_url": "https://models.inference.ai.azure.com",
        "models": ["gpt-4o-mini", "gpt-4o", "Meta-Llama-3.1-70B-Instruct"],
        "priority": 2, "weight": 1.5,
        "key_hint": "Starts with: ghp_ or github_pat_",
        "key_prefixes": ["ghp_", "github_pat_"],
        "pricing": {"input": 0.00, "output": 0.00},
    },
    "perplexity": {
        "name": "Perplexity AI",
        "base_url": "https://api.perplexity.ai",
        "models": ["sonar", "sonar-pro", "sonar-reasoning"],
        "priority": 3, "weight": 1.0,
        "key_hint": "Starts with: pplx-",
        "key_prefixes": ["pplx-"],
        "pricing": {"input": 0.20, "output": 0.20},
    },
    "fireworks": {
        "name": "Fireworks AI",
        "base_url": "https://api.fireworks.ai/inference/v1",
        "models": ["accounts/fireworks/models/llama-v3p1-70b-instruct"],
        "priority": 2, "weight": 1.5,
        "key_hint": "Starts with: fw_",
        "key_prefixes": ["fw_"],
        "pricing": {"input": 0.20, "output": 0.20},
    },
}

_UUID_RE = re.compile(
    r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
    re.IGNORECASE
)


def detect_provider_from_key(api_key: str) -> str | None:
    key = api_key.strip()
    prefix_map = [
        ("sk-or-v1-", "openrouter"), ("sk-or-", "openrouter"),
        ("github_pat_", "github"), ("AIzaSy", "gemini"),
        ("nvapi-", "nvidia"), ("pplx-", "perplexity"),
        ("csk_", "cerebras"), ("gsk_", "groq"),
        ("ghp_", "github"), ("fw_", "fireworks"), ("sn-", "sambanova"),
    ]
    for prefix, pid in prefix_map:
        if key.startswith(prefix):
            return pid
    if _UUID_RE.match(key):
        return "sambanova"
    return None


def estimate_cost(provider_id: str, prompt_tokens: int, completion_tokens: int) -> float:
    cfg = SUPPORTED_PROVIDERS.get(provider_id, {})
    pricing = cfg.get("pricing", {"input": 0.0, "output": 0.0})
    cost = (prompt_tokens * pricing["input"] + completion_tokens * pricing["output"]) / 1_000_000
    return round(cost, 8)
