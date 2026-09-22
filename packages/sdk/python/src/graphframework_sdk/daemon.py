"""Daemon JSON Lines client: the Python twin of the JS KernelDaemonClient."""

import asyncio
import json
from typing import Any

from graphframework_sdk.protocol import PROTOCOL_VERSION, ProtocolError


class KernelDaemonClient:
    """Thin DTO client; one connection, sequential ids, `id`-keyed replies."""

    def __init__(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter, token: str):
        self._reader = reader
        self._writer = writer
        self._token = token
        self._next_id = 0

    @staticmethod
    async def connect(address: str, token: str, timeout_s: float = 5.0) -> "KernelDaemonClient":
        if len(token) < 16:
            raise ValueError("Kernel daemon token must have at least 16 bytes")
        host, _, port_text = address.rpartition(":")
        host = host.strip("[]")
        port = int(port_text)
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port), timeout_s)
        return KernelDaemonClient(reader, writer, token)

    async def request(self, op: str, payload: dict[str, Any] | None = None) -> Any:
        self._next_id += 1
        frame = {"version": PROTOCOL_VERSION, "id": self._next_id, "token": self._token, "op": op}
        frame.update(payload or {})
        self._writer.write((json.dumps(frame) + "\n").encode("utf-8"))
        await self._writer.drain()
        line = await self._reader.readline()
        if not line:
            raise ProtocolError("Kernel daemon connection closed")
        response = json.loads(line.decode("utf-8"))
        if response.get("id") != self._next_id:
            raise ProtocolError(f"Kernel daemon reply id mismatch: {response!r}")
        if response.get("ok") is not True:
            raise ProtocolError(str(response.get("error", "Kernel daemon request failed")))
        return response.get("result")

    async def health(self) -> Any:
        return await self.request("health")

    async def shutdown(self) -> Any:
        return await self.request("shutdown")

    async def admit(self, node_id: str, initial_state: dict[str, Any],
                   analysis_facts: Any = None,
                   effect_capabilities: list[str] | None = None) -> Any:
        return await self.request("admit", {
            "nodeId": node_id, "initialState": initial_state,
            "analysisFacts": analysis_facts, "effectCapabilities": effect_capabilities or [],
        })

    async def evict(self, node_id: str) -> Any:
        return await self.request("evict", {"nodeId": node_id})

    async def replace(self, node_id: str, initial_state: dict[str, Any], analysis_facts: Any = None,
                      effect_capabilities: list[str] | None = None) -> Any:
        return await self.request("replace", {
            "nodeId": node_id, "initialState": initial_state,
            "analysisFacts": analysis_facts, "effectCapabilities": effect_capabilities or [],
        })

    async def inject(self, target_node_id: str, info: dict[str, Any], submission_id: str) -> Any:
        return await self.request("inject", {
            "targetNodeId": target_node_id, "info": info, "submissionId": submission_id,
        })

    async def claim(self, node_ids: list[str]) -> Any:
        return await self.request("claim", {"nodeIds": node_ids})

    async def release(self, node_ids: list[str]) -> Any:
        return await self.request("release", {"nodeIds": node_ids})

    async def poll(self, wait_ms: int = 0) -> Any:
        return await self.request("poll", {"waitMs": wait_ms})

    async def commit(self, change_id: int, operations: list[dict[str, Any]], error: str | None = None) -> Any:
        payload: dict[str, Any] = {"changeId": change_id, "operations": operations}
        if error is not None:
            payload["error"] = error
        return await self.request("commit", payload)

    async def cancel(self, submission_id: str) -> Any:
        return await self.request("cancel", {"submissionId": submission_id})

    async def intervene(self, node_id: str, patch: dict[str, Any],
                       expected_generation: int, expected_version: int) -> Any:
        return await self.request("intervene", {
            "nodeId": node_id, "patch": patch,
            "expectedGeneration": expected_generation, "expectedVersion": expected_version,
        })

    async def projection(self) -> Any:
        return await self.request("projection")

    async def analysis_facts(self) -> Any:
        return await self.request("analysisFacts")

    async def set_error_target(self, node_id: str) -> Any:
        return await self.request("setErrorTarget", {"nodeId": node_id})

    async def analyze(self, request: dict[str, Any]) -> Any:
        return await self.request("analyze", {"request": request})

    async def set_analysis_context(self, frontend_links: Any = None,
                                   frontend_service_links: Any = None) -> Any:
        return await self.request("setAnalysisContext", {
            "frontendLinks": frontend_links or [], "frontendServiceLinks": frontend_service_links or [],
        })

    async def agent_inspect(self, after: int | None = None, limit: int | None = None) -> Any:
        payload: dict[str, Any] = {}
        if after is not None:
            payload["after"] = after
        if limit is not None:
            payload["limit"] = limit
        return await self.request("agentInspect", payload)

    async def agent_inject(self, actor: str, reason: str, submission_id: str,
                           target_node_id: str, info: dict[str, Any]) -> Any:
        return await self.request("agentInject", {
            "actor": actor, "reason": reason, "submissionId": submission_id,
            "targetNodeId": target_node_id, "info": info,
        })

    async def agent_intervene_state(self, actor: str, reason: str, node_id: str,
                                    patch: dict[str, Any],
                                    expected_generation: int, expected_version: int) -> Any:
        return await self.request("agentInterveneState", {
            "actor": actor, "reason": reason, "nodeId": node_id, "patch": patch,
            "expectedGeneration": expected_generation, "expectedVersion": expected_version,
        })

    async def claim_effects(self, adapter_ids: list[str]) -> Any:
        return await self.request("claimEffects", {"adapterIds": adapter_ids})

    async def release_effects(self, adapter_ids: list[str]) -> Any:
        return await self.request("releaseEffects", {"adapterIds": adapter_ids})

    async def poll_effect(self, wait_ms: int = 0) -> Any:
        return await self.request("pollEffect", {"waitMs": wait_ms})

    async def request_effect(self, change_id: int, adapter_id: str, request: Any) -> Any:
        return await self.request("requestEffect", {
            "changeId": change_id, "adapterId": adapter_id, "request": request,
        })

    async def await_effect(self, effect_id: int, wait_ms: int = 30_000) -> Any:
        return await self.request("awaitEffect", {"effectId": effect_id, "waitMs": wait_ms})

    async def complete_effect(self, effect_id: int, ok: bool,
                              observation: Any = None, error: str | None = None) -> Any:
        payload: dict[str, Any] = {"effectId": effect_id, "ok": ok}
        if observation is not None:
            payload["observation"] = observation
        if error is not None:
            payload["error"] = error
        return await self.request("completeEffect", payload)

    def close(self) -> None:
        self._writer.close()
