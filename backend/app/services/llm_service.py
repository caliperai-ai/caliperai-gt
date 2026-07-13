"""
LLM Service - Integration with Ollama/vLLM for AI chat responses.

Supports:
- Ollama (default, easy setup)
- vLLM (production scale)
- Mock mode (for testing without LLM)
"""
import asyncio
import json
import logging
from typing import AsyncGenerator, Optional, Dict, Any, List
from dataclasses import dataclass
from enum import Enum

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


class LLMProvider(str, Enum):
    """Supported LLM providers."""
    OLLAMA = "ollama"
    VLLM = "vllm"
    MOCK = "mock"


@dataclass
class LLMResponse:
    """Response from LLM completion."""
    content: str
    model: str
    tokens_used: Optional[int] = None
    finish_reason: Optional[str] = None


@dataclass
class ChatMessage:
    """Chat message for LLM context."""
    role: str
    content: str


class LLMService:
    """
    LLM service for generating AI chat responses.
    
    Supports streaming responses for real-time chat experience.
    """
    
    def __init__(self):
        self.provider = LLMProvider(settings.LLM_PROVIDER.lower())
        self.model = settings.OLLAMA_MODEL
        self.base_url = settings.OLLAMA_BASE_URL
        self.max_tokens = settings.CHAT_MAX_TOKENS
        self.temperature = settings.CHAT_TEMPERATURE
        
        self._client: Optional[httpx.AsyncClient] = None
    
    async def _get_client(self) -> httpx.AsyncClient:
        """Get or create HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                timeout=httpx.Timeout(60.0, connect=10.0),
            )
        return self._client
    
    async def close(self):
        """Close HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()
    
    async def health_check(self) -> bool:
        """Check if LLM service is available."""
        if self.provider == LLMProvider.MOCK:
            return True
        
        try:
            client = await self._get_client()
            
            if self.provider == LLMProvider.OLLAMA:
                response = await client.get(
                    f"{self.base_url}/api/version",
                    timeout=5.0
                )
                return response.status_code == 200
            
            elif self.provider == LLMProvider.VLLM:
                response = await client.get(
                    f"{self.base_url}/health",
                    timeout=5.0
                )
                return response.status_code == 200
            
        except Exception as e:
            logger.warning(f"LLM health check failed: {e}")
            return False
        
        return False
    
    async def generate(
        self,
        messages: List[ChatMessage],
        **kwargs
    ) -> LLMResponse:
        """
        Generate a complete response (non-streaming).
        
        Args:
            messages: List of chat messages for context
            **kwargs: Additional generation parameters
            
        Returns:
            LLMResponse with generated content
        """
        content_parts = []
        async for chunk in self.generate_stream(messages, **kwargs):
            content_parts.append(chunk)
        
        return LLMResponse(
            content="".join(content_parts),
            model=self.model,
        )
    
    async def generate_stream(
        self,
        messages: List[ChatMessage],
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """
        Generate a streaming response.
        
        Args:
            messages: List of chat messages for context
            **kwargs: Additional generation parameters
            
        Yields:
            Token strings as they are generated
        """
        if self.provider == LLMProvider.MOCK:
            async for token in self._mock_stream(messages):
                yield token
        elif self.provider == LLMProvider.OLLAMA:
            async for token in self._ollama_stream(messages, **kwargs):
                yield token
        elif self.provider == LLMProvider.VLLM:
            async for token in self._vllm_stream(messages, **kwargs):
                yield token
        else:
            raise ValueError(f"Unknown LLM provider: {self.provider}")
    
    async def _mock_stream(
        self,
        messages: List[ChatMessage],
    ) -> AsyncGenerator[str, None]:
        """Mock streaming for testing without LLM."""
        mock_responses = [
            "I'm the AI assistant for the annotation platform. ",
            "I can help you with:\n\n",
            "1. **3D Annotation Tools** - Drawing cuboids around objects\n",
            "2. **Point Cloud Navigation** - Moving around the 3D view\n",
            "3. **Workflow Questions** - Submitting tasks, handling reviews\n\n",
            "What would you like to know more about?"
        ]
        
        for part in mock_responses:
            for char in part:
                yield char
                await asyncio.sleep(0.01)
    
    async def _ollama_stream(
        self,
        messages: List[ChatMessage],
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """Stream response from Ollama API."""
        client = await self._get_client()
        
        ollama_messages = [
            {"role": msg.role, "content": msg.content}
            for msg in messages
        ]
        
        payload = {
            "model": kwargs.get("model", self.model),
            "messages": ollama_messages,
            "stream": True,
            "options": {
                "temperature": kwargs.get("temperature", self.temperature),
                "num_predict": kwargs.get("max_tokens", self.max_tokens),
            }
        }
        
        try:
            async with client.stream(
                "POST",
                f"{self.base_url}/api/chat",
                json=payload,
                timeout=60.0
            ) as response:
                response.raise_for_status()
                
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    
                    try:
                        data = json.loads(line)
                        if "message" in data and "content" in data["message"]:
                            yield data["message"]["content"]
                        
                        if data.get("done", False):
                            break
                            
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse Ollama response: {line}")
                        continue
                        
        except httpx.HTTPStatusError as e:
            logger.error(f"Ollama API error: {e.response.status_code} - {e.response.text}")
            yield f"\n\n[Error: LLM service returned {e.response.status_code}]"
        except httpx.ConnectError as e:
            logger.error(f"Failed to connect to Ollama: {e}")
            yield "\n\n[Error: Could not connect to AI service. Please try again later.]"
        except Exception as e:
            logger.error(f"Ollama streaming error: {e}")
            yield f"\n\n[Error: {str(e)}]"
    
    async def _vllm_stream(
        self,
        messages: List[ChatMessage],
        **kwargs
    ) -> AsyncGenerator[str, None]:
        """Stream response from vLLM OpenAI-compatible API."""
        client = await self._get_client()
        
        openai_messages = [
            {"role": msg.role, "content": msg.content}
            for msg in messages
        ]
        
        payload = {
            "model": kwargs.get("model", self.model),
            "messages": openai_messages,
            "stream": True,
            "max_tokens": kwargs.get("max_tokens", self.max_tokens),
            "temperature": kwargs.get("temperature", self.temperature),
        }
        
        try:
            async with client.stream(
                "POST",
                f"{self.base_url}/v1/chat/completions",
                json=payload,
                timeout=60.0
            ) as response:
                response.raise_for_status()
                
                async for line in response.aiter_lines():
                    if not line or line == "data: [DONE]":
                        continue
                    
                    if line.startswith("data: "):
                        try:
                            data = json.loads(line[6:])
                            if "choices" in data and data["choices"]:
                                delta = data["choices"][0].get("delta", {})
                                if "content" in delta:
                                    yield delta["content"]
                        except json.JSONDecodeError:
                            continue
                            
        except httpx.HTTPStatusError as e:
            logger.error(f"vLLM API error: {e.response.status_code}")
            yield f"\n\n[Error: LLM service returned {e.response.status_code}]"
        except Exception as e:
            logger.error(f"vLLM streaming error: {e}")
            yield f"\n\n[Error: {str(e)}]"
    
    async def list_models(self) -> List[str]:
        """List available models."""
        if self.provider == LLMProvider.MOCK:
            return ["mock-model"]
        
        if self.provider == LLMProvider.OLLAMA:
            try:
                client = await self._get_client()
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                data = response.json()
                return [model["name"] for model in data.get("models", [])]
            except Exception as e:
                logger.error(f"Failed to list Ollama models: {e}")
                return []
        
        return []


_llm_service: Optional[LLMService] = None


def get_llm_service() -> LLMService:
    """Get or create LLM service singleton."""
    global _llm_service
    if _llm_service is None:
        _llm_service = LLMService()
    return _llm_service
