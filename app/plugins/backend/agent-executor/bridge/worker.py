"""One JSON Lines worker process per GraphFramework thread id."""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from urllib.parse import urlparse

from langchain_openai import ChatOpenAI

from agent_runtime import AgentEngine


class Protocol:
    def __init__(self):
        self.pending_tools: dict[str, asyncio.Future] = {}
        self.tool_timeout_s = 120
        self.engine: AgentEngine | None = None
        self.active: asyncio.Task | None = None

    def emit(self, message: dict) -> None:
        sys.stdout.write(json.dumps(message, ensure_ascii=False, separators=(",", ":")) + "\n")
        sys.stdout.flush()

    async def graph_tool(self, name: str, args: dict):
        call_id = str(uuid.uuid4())
        future = asyncio.get_running_loop().create_future()
        self.pending_tools[call_id] = future
        self.emit({"type": "tool_call", "id": call_id, "name": name, "args": args})
        try:
            return await asyncio.wait_for(future, timeout=self.tool_timeout_s)
        finally:
            self.pending_tools.pop(call_id, None)

    async def invoke(self, command: dict) -> None:
        try:
            answer = await self.engine.invoke(command["text"], request_id=command["requestId"],
                                              prompts=command.get("prompts", []),
                                              attachments=command.get("attachments"))
            self.emit({"type": "result", "id": command["id"], "answer": answer, "processId": os.getpid()})
        except Exception as error:
            self.emit({"type": "error", "id": command["id"], "message": str(error)})

    async def receive(self, command: dict) -> None:
        kind = command.get("type")
        if kind == "init":
            if self.engine is not None:
                raise ValueError("worker is already initialized")
            base_url = command.get("baseUrl") or None
            host = urlparse(base_url).hostname if base_url else None
            if host == "openrouter.ai":
                key = os.environ.get("OPENROUTER_API_KEY")
            elif host is None or host == "api.openai.com":
                key = os.environ.get("OPENAI_API_KEY")
            else:
                key = os.environ.get("AGENT_API_KEY")
            if not key:
                raise ValueError("model API key is required in the process environment")
            model = ChatOpenAI(model=command["model"], api_key=key,
                               base_url=base_url)
            self.tool_timeout_s = max(1, min(600, int(command.get("toolTimeoutMs", 120000)) / 1000))
            self.engine = await AgentEngine(
                model=model, thread_id=command["threadId"], sqlite_path=command["sqlitePath"],
                tools=command.get("tools", []), graph_tool=self.graph_tool,
                monitor=lambda event: self.emit({"type": "monitor", "event": event}),
            ).__aenter__()
            self.emit({"type": "ready", "processId": os.getpid()})
            return
        if kind == "tool_result":
            future = self.pending_tools.get(command.get("id"))
            if future and not future.done():
                if command.get("error"):
                    future.set_exception(RuntimeError(command["error"]))
                else:
                    future.set_result(command.get("result"))
            return
        if kind == "invoke":
            if self.engine is None or self.active and not self.active.done():
                raise ValueError("worker is not ready or already running")
            self.active = asyncio.create_task(self.invoke(command))
            return
        raise ValueError("unknown worker command")


async def main() -> None:
    protocol = Protocol()
    try:
        while line := await asyncio.to_thread(sys.stdin.readline):
            try:
                await protocol.receive(json.loads(line))
            except Exception as error:
                protocol.emit({"type": "error", "id": None, "message": str(error)})
    finally:
        if protocol.active:
            protocol.active.cancel()
            await asyncio.gather(protocol.active, return_exceptions=True)
        if protocol.engine:
            await protocol.engine.__aexit__(None, None, None)


if __name__ == "__main__":
    asyncio.run(main())
