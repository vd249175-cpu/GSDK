"""Python mirror SDK: unit tests over pure faces (no daemon needed)."""

import asyncio

import pytest

from graphframework_sdk import agent, analysis, effect, node, plugin, protocol, testing
from graphframework_sdk.agent import KernelDaemonClient
from graphframework_sdk.protocol import Info, ProtocolError


def test_info_round_trips_through_dto_shape() -> None:
    info = Info(type="IncrementInfo", payload={"count": 1})
    dto = info.to_dto()
    assert dto == {"type": "IncrementInfo", "count": 1}
    assert Info.from_dto(dto) == info


def test_manifest_rejects_traversal_and_duplicates_like_js() -> None:
    with pytest.raises(ValueError):
        plugin.parse_studio_plugin_manifest({
            "id": "example.bad", "name": "Bad", "version": "1.0.0", "apiVersion": 1,
            "contributes": {"backend": "../outside.ts"},
        })
    with pytest.raises(ValueError):
        plugin.parse_studio_plugin_manifest({
            "id": "example.bad", "name": "Bad", "version": "1.0.0", "apiVersion": 1,
            "contributes": {"elements": ["same", "same"]},
        })
    manifest = plugin.parse_studio_plugin_manifest({
        "id": "example.timeline", "name": "Timeline", "version": "1.2.3", "apiVersion": 1,
        "contributes": {"backend": "backend.py", "elements": ["example.timeline"]},
    })
    assert manifest.contributes.backend == "backend.py"


def test_analysis_rejects_unknown_ops_before_touching_the_wire() -> None:
    with pytest.raises(ValueError):
        asyncio.run(analysis.analyze(object(), {"op": "nope"}))


@pytest.mark.asyncio
async def test_worker_batches_writes_and_sends_into_one_commit() -> None:
    async def handler(info: dict, ctx: node.DaemonNodeChangeContext) -> None:
        assert info["type"] == "IncrementInfo"
        ctx.write("count", ctx.read("count") + 1)
        ctx.send({"type": "CountChangedInfo"}, "observer")

    client = testing.FakeDaemonClient([{
        "change": {"changeId": 9, "nodeId": "counter", "info": {"type": "IncrementInfo"}},
        "state": {"count": 2},
    }])
    stop = asyncio.Event()
    async def run_once() -> None:
        await client.claim(["counter"])
        polled = await client.poll()
        ctx = node.DaemonNodeChangeContext(polled["state"], client, polled["change"]["changeId"])
        await handler(polled["change"]["info"], ctx)
        await client.commit(polled["change"]["changeId"], ctx.operations)
        stop.set()
    await run_once()
    assert stop.is_set()
    assert client.commits[0]["operations"] == [
        {"op": "write", "key": "count", "value": 3},
        {"op": "send", "info": {"type": "CountChangedInfo"}, "targetNodeId": "observer"},
    ]


@pytest.mark.asyncio
async def test_effect_provider_completes_with_the_adapter_observation() -> None:
    async def adapter(request: object, context: effect.DaemonEffectContext) -> dict:
        assert context.node_id == "n"
        return {"status": "done", "echo": request}

    client = testing.FakeDaemonClient()
    completions: list = []
    async def fake_complete(effect_id: int, ok: bool, **kwargs: object) -> dict:
        completions.append((effect_id, ok, kwargs))
        return {"effectId": effect_id, "completed": True}
    client.complete_effect = fake_complete  # type: ignore[method-assign]
    await client.claim_effects(["vendor/device-v1"])
    observation = await adapter({"command": "ping"}, effect.DaemonEffectContext(
        effect_id=1, change_id=2, node_id="n", generation=0))
    await client.complete_effect(1, True, observation=observation)
    assert completions[0][1] is True
    assert completions[0][2]["observation"] == {"status": "done", "echo": {"command": "ping"}}


@pytest.mark.asyncio
async def test_daemon_client_rejects_short_tokens_before_connect() -> None:
    with pytest.raises(ValueError):
        await KernelDaemonClient.connect("127.0.0.1:1", "short")


def test_protocol_error_is_typed() -> None:
    assert issubclass(ProtocolError, Exception)


def test_daemon_client_has_one_public_capability_face() -> None:
    assert agent.KernelDaemonClient is KernelDaemonClient
    assert "KernelDaemonClient" in agent.__all__


def test_every_capability_face_declares_its_public_exports() -> None:
    faces = (agent, analysis, effect, node, plugin, protocol, testing)
    for face in faces:
        assert face.__all__
        assert all(hasattr(face, name) for name in face.__all__)
