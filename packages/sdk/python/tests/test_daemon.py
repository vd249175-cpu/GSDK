"""Python/JS mirror check against the same daemon and contract golden frames."""

import asyncio
import json
import shutil
import socket
import subprocess
import tempfile
from pathlib import Path

import pytest

from graphvideo_sdk import agent, analysis
from graphvideo_sdk.daemon import KernelDaemonClient
REPO = Path(__file__).resolve().parents[4]
_EXE = "graphvideo-kernel-daemon.exe" if __import__("os").name == "nt" else "graphvideo-kernel-daemon"
DAEMON = REPO / "packages" / "rust" / "target" / "debug" / _EXE
CONTRACT = REPO / "packages" / "contract" / "golden-frames"
TOKEN = "fixture-secret-0001"


@pytest.fixture
def daemon_proc():
    if not DAEMON.exists():
        pytest.skip("daemon binary not staged")
    import os
    env = {**os.environ, "GRAPHVIDEO_DAEMON_TOKEN": TOKEN}
    proc = subprocess.Popen([str(DAEMON)], env=env, stdout=subprocess.PIPE, text=True)
    assert proc.stdout is not None
    ready = json.loads(proc.stdout.readline())
    yield ready["address"]
    proc.kill()
    proc.wait()


def free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


@pytest.mark.asyncio
async def test_python_replays_the_contract_counter_cycle(daemon_proc: str) -> None:
    frame = json.loads((CONTRACT / "daemon-counter-cycle.json").read_text())
    control = await KernelDaemonClient.connect(daemon_proc, TOKEN)
    poll_change = None
    try:
        for step in frame["requests"]:
            args = dict(step["args"])
            if args.get("changeId") == "$poll.change.changeId":
                args["changeId"] = poll_change["change"]["changeId"]
            result = await control.request(step["op"], args)
            if step["op"] == "poll":
                poll_change = result
            if step["op"] == "projection":
                expect = frame["expect"]["projection"]["nodes"]["owner"]
                assert result["nodes"]["owner"]["state"] == expect["state"]
                assert result["nodes"]["owner"]["version"] == expect["version"]
    finally:
        control.close()


@pytest.mark.asyncio
async def test_python_and_js_share_analysis_routes(daemon_proc: str) -> None:
    frame = json.loads((CONTRACT / "analysis-basic.json").read_text())
    control = await KernelDaemonClient.connect(daemon_proc, TOKEN)
    try:
        for snapshot in frame["facts"]["snapshots"]:
            await control.admit(snapshot["nodeId"], {}, analysis_facts=snapshot)
        await control.set_analysis_context(
            frame["context"]["frontendLinks"], frame["context"]["frontendServiceLinks"])
        view = await analysis.analyze(control, frame["request"])
        assert [r["id"] for r in view["routes"]] == [
            "route:a->b:TickInfo", "route:b->b:TickInfo"]
    finally:
        control.close()


@pytest.mark.asyncio
async def test_python_worker_collaborates_with_control(daemon_proc: str) -> None:
    from graphvideo_sdk.node import run_daemon_node_worker

    control = await KernelDaemonClient.connect(daemon_proc, TOKEN)
    worker = await KernelDaemonClient.connect(daemon_proc, TOKEN)
    stop = asyncio.Event()

    async def counter(info: dict, ctx: object) -> None:
        runs = ctx.read("runs")  # type: ignore[attr-defined]
        ctx.write("runs", runs + 1)  # type: ignore[attr-defined]
        stop.set()

    task = asyncio.create_task(run_daemon_node_worker(
        worker, {"interop.python": counter}, long_poll_ms=200, stop=stop))
    try:
        await control.admit("interop.python", {"runs": 0})
        await control.inject("interop.python", {"type": "RunInfo"}, "interop/py/1")
        await asyncio.wait_for(stop.wait(), 5)
        projection = await control.projection()
        assert projection["nodes"]["interop.python"]["state"] == {"runs": 1}
    finally:
        stop.set()
        await task
        control.close()
        worker.close()
