"""Minimal stdio Node in another language; only Python's standard library."""
import json
import sys


def emit(value):
    sys.stdout.write(json.dumps(value, separators=(",", ":")) + "\n")
    sys.stdout.flush()


facts = {
    "version": 1,
    "nodeId": "python.worker",
    "entities": [
        {"address": "node:python.worker", "kind": "node", "id": "python.worker"},
        {"address": "change:python.worker::RunInfo", "kind": "change", "id": "python.worker", "nodeId": "python.worker", "subId": "RunInfo"},
        {"address": "info:RunInfo@python.worker", "kind": "info", "id": "RunInfo", "nodeId": "python.worker", "subId": "python.worker"},
        {"address": "state:python.worker::runs", "kind": "state", "id": "python.worker", "nodeId": "python.worker", "subId": "runs"},
        {"address": "info:DoneInfo@target", "kind": "info", "id": "DoneInfo", "nodeId": "target", "subId": "target"},
    ],
    "edges": [
        {"id": "python:trigger", "from": "info:RunInfo@python.worker", "to": "change:python.worker::RunInfo", "type": "trigger", "confidence": "high"},
        {"id": "python:write", "from": "change:python.worker::RunInfo", "to": "state:python.worker::runs", "type": "write", "confidence": "high"},
        {"id": "python:send", "from": "change:python.worker::RunInfo", "to": "info:DoneInfo@target", "type": "send", "confidence": "high"},
    ],
}
emit({"kind": "ready", "version": 1, "nodeId": "python.worker", "initialState": {"runs": 0}, "analysisFacts": facts})


def call(change_id, call_id, op, **payload):
    emit({"kind": "call", "changeId": change_id, "callId": call_id, "op": op, **payload})
    response = json.loads(sys.stdin.readline())
    if not response.get("ok") or response.get("changeId") != change_id or response.get("callId") != call_id:
        raise RuntimeError(response.get("error", "invalid host response"))
    return response.get("value")


for line in sys.stdin:
    frame = json.loads(line)
    if frame.get("kind") != "change":
        continue
    change_id = frame["changeId"]
    try:
        if frame["info"]["type"] == "RunInfo":
            current = call(change_id, 1, "read", key="runs")
            call(change_id, 2, "write", key="runs", value=current + 1)
            call(change_id, 3, "send", targetNodeId="target", info={"type": "DoneInfo"})
        emit({"kind": "settle", "changeId": change_id})
    except Exception as error:
        emit({"kind": "fail", "changeId": change_id, "error": str(error)})
