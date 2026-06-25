from pydantic import BaseModel
from typing import Optional, List


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    temperature: Optional[float] = 0.7
    max_tokens: Optional[int] = 2048
    provider_hint: Optional[str] = None
    strategy: Optional[str] = "smart"
    stream: Optional[bool] = False
    tools: Optional[list] = None
    tool_choice: Optional[str] = None
