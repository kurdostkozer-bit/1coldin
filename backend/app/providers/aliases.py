"""
Universal model aliases — copied from old aliases.py.
resolve_alias("best-70b") → ["llama-3.3-70b-versatile", ...]
"""

MODEL_ALIASES: dict[str, list[str]] = {
    "best-70b": [
        "llama-3.3-70b-versatile",
        "Meta-Llama-3.3-70B-Instruct", "Meta-Llama-3.1-70B-Instruct",
        "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
        "meta/llama-3.1-70b-instruct", "llama3.1-70b",
    ],
    "best-8b": [
        "llama-3.1-8b-instant", "llama3.1-8b",
        "Meta-Llama-3.1-8B-Instruct",
        "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
        "meta/llama-3.1-8b-instruct",
    ],
    "best-flash": ["gemini-2.5-flash", "gemini-1.5-flash", "llama-3.1-8b-instant"],
    "best-large": ["Meta-Llama-3.1-405B-Instruct", "llama-3.3-70b-versatile"],
    "best-coder": ["codestral-latest", "llama-3.3-70b-versatile"],
    "best-free": ["google/gemini-flash-1.5-free", "meta-llama/llama-3-8b-instruct:free", "llama-3.1-8b-instant"],
    "best-cheap": ["llama-3.1-8b-instant", "llama3.1-8b", "gemini-1.5-flash"],
    "best-reasoning": ["sonar-reasoning", "gemini-2.5-pro", "mistral-large-latest"],
}

CHEAP_MODELS = ["llama-3.1-8b-instant", "llama3.1-8b", "gemini-1.5-flash"]


def resolve_alias(model: str) -> list[str] | None:
    return MODEL_ALIASES.get(model)


def get_cheap_fallback(current_model: str) -> str:
    if current_model in CHEAP_MODELS:
        return current_model
    return CHEAP_MODELS[0]
