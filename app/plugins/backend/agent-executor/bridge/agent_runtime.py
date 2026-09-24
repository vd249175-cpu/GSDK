"""LangChain agent outside the GraphFramework rule space.

One AgentEngine belongs to one OS process and one thread id. The host owns
process lifetime and implements graph_tool; the model never receives a direct
OS or browser adapter.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Awaitable, Callable

from langchain.agents import create_agent
from langchain.agents.middleware import AgentMiddleware
from langchain_core.tools import StructuredTool
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from pydantic import BaseModel, Field, create_model

GraphTool = Callable[[str, dict[str, Any]], Awaitable[Any]]
Monitor = Callable[[dict[str, Any]], None]
_IDENTIFIER = re.compile(r"^[A-Za-z0-9._:-]{1,128}$")
_TOOL_NAME = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,63}$")
_PART_TYPES = {"text", "image", "image_url", "audio", "input_audio", "video", "video_url", "file"}


def compose_prompt(sections: list[str]) -> str:
    """Join node supplied prompt sections in their declared order."""
    return "\n\n".join(section.strip() for section in sections if isinstance(section, str) and section.strip())


def normalize_content(text: str, attachments: list[dict[str, Any]] | None = None) -> str | list[dict[str, Any]]:
    if not isinstance(text, str):
        raise ValueError("text must be a string")
    if attachments is None:
        if not text.strip():
            raise ValueError("message cannot be empty")
        return text
    if not isinstance(attachments, list):
        raise ValueError("attachments must be a list")
    parts = [{"type": "text", "text": text}] if text.strip() else []
    for part in attachments:
        if not isinstance(part, dict) or part.get("type") not in _PART_TYPES:
            raise ValueError("unsupported content block")
        if part["type"] == "video":
            if not isinstance(part.get("url"), str) or not part["url"]:
                raise ValueError("video requires a URL")
            parts.append({"type": "video_url", "video_url": {"url": part["url"]}})
        else:
            parts.append(part)
    if not parts:
        raise ValueError("message cannot be empty")
    return parts


def _args_model(name: str, schema: dict[str, Any]) -> type[BaseModel]:
    if schema.get("type") != "object" or not isinstance(schema.get("properties"), dict):
        raise ValueError(f"tool {name} requires object JSON schema")
    kinds = {"string": str, "integer": int, "number": float, "boolean": bool, "object": dict, "array": list}
    required = set(schema.get("required", []))
    fields = {}
    for key, definition in schema["properties"].items():
        if not isinstance(definition, dict) or definition.get("type") not in kinds:
            raise ValueError(f"tool {name} has unsupported argument {key}")
        field_type = kinds[definition["type"]]
        fields[key] = (field_type if key in required else field_type | None,
                       Field(default=... if key in required else None, description=definition.get("description")))
    return create_model(f"{name}_Arguments", **fields)


class GraphMonitorMiddleware(AgentMiddleware):
    def __init__(self, thread_id: str, emit: Monitor):
        self.thread_id = thread_id
        self.emit = emit
        self.request_id = ""

    def _emit(self, phase: str, **fields: Any) -> None:
        self.emit({"threadId": self.thread_id, "requestId": self.request_id, "phase": phase, **fields})

    async def abefore_model(self, state, runtime):
        self._emit("before_model", messageCount=len(state.get("messages", [])))
        return None

    async def aafter_model(self, state, runtime):
        self._emit("after_model", messageCount=len(state.get("messages", [])))
        return None

    async def awrap_tool_call(self, request, handler):
        name = request.tool_call.get("name", "")
        self._emit("before_tool", toolName=name, toolCallId=request.tool_call.get("id"))
        try:
            result = await handler(request)
        except Exception as error:
            self._emit("tool_error", toolName=name, error=type(error).__name__)
            raise
        self._emit("after_tool", toolName=name, toolCallId=request.tool_call.get("id"))
        return result


class AgentEngine:
    def __init__(self, *, model: Any, thread_id: str, sqlite_path: str | Path,
                 tools: list[dict[str, Any]], graph_tool: GraphTool, monitor: Monitor):
        if not isinstance(thread_id, str) or not _IDENTIFIER.fullmatch(thread_id):
            raise ValueError("invalid thread id")
        self.model = model
        self.thread_id = thread_id
        self.sqlite_path = Path(sqlite_path)
        self.graph_tool = graph_tool
        self.middleware = GraphMonitorMiddleware(thread_id, monitor)
        self.tools = self._build_tools(tools)
        self._checkpoint_context = None
        self._checkpointer = None

    def _build_tools(self, definitions: list[dict[str, Any]]) -> list[StructuredTool]:
        seen = set()
        result = []
        for definition in definitions:
            name = definition.get("name")
            if not isinstance(name, str) or not _TOOL_NAME.fullmatch(name) or name in seen:
                raise ValueError("invalid or duplicate graph tool name")
            seen.add(name)
            schema = _args_model(name, definition.get("parameters", {}))

            # Bind the current name into a separate closure for parallel calls.
            async def bound_tool(_name=name, **kwargs):
                return json.dumps(await self.graph_tool(_name, kwargs), ensure_ascii=False)

            result.append(StructuredTool.from_function(
                coroutine=bound_tool, name=name, description=definition["description"],
                args_schema=schema,
            ))
        return result

    async def __aenter__(self):
        self.sqlite_path.parent.mkdir(parents=True, exist_ok=True)
        self._checkpoint_context = AsyncSqliteSaver.from_conn_string(str(self.sqlite_path))
        self._checkpointer = await self._checkpoint_context.__aenter__()
        return self

    async def __aexit__(self, exc_type, exc, tb):
        await self._checkpoint_context.__aexit__(exc_type, exc, tb)
        self._checkpointer = None

    async def invoke(self, text: str, *, request_id: str, prompts: list[str],
                     attachments: list[dict[str, Any]] | None = None) -> str:
        if self._checkpointer is None:
            raise RuntimeError("agent is not open")
        if not isinstance(request_id, str) or not _IDENTIFIER.fullmatch(request_id):
            raise ValueError("invalid request id")
        self.middleware.request_id = request_id
        content = normalize_content(text, attachments)
        # Prompts are supplied by the graph for this invocation. A persisted
        # conversation keeps only messages; prompt changes apply next turn.
        prompt = compose_prompt(prompts)
        agent = create_agent(self.model, tools=self.tools, middleware=[self.middleware],
                             system_prompt=prompt or None, checkpointer=self._checkpointer)
        payload = {"messages": [{"role": "user", "content": content}]}
        self.middleware._emit("started")
        try:
            result = await agent.ainvoke(payload, {"configurable": {"thread_id": self.thread_id}})
            answer = result["messages"][-1].content
            self.middleware._emit("completed")
            return answer if isinstance(answer, str) else json.dumps(answer, ensure_ascii=False)
        except Exception as error:
            self.middleware._emit("failed", error=type(error).__name__)
            raise
