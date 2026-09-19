"""One-shot daemon Node using only Python's standard library."""
import json
import os
import socket


address = os.environ["GRAPHFRAMEWORK_DAEMON_ADDRESS"]
token = os.environ["GRAPHFRAMEWORK_DAEMON_TOKEN"]
host, port_text = address.rsplit(":", 1)
connection = socket.create_connection((host.strip("[]"), int(port_text)), timeout=5)
reader = connection.makefile("r", encoding="utf-8", newline="\n")
writer = connection.makefile("w", encoding="utf-8", newline="\n")
next_request_id = 0


def call(operation, **payload):
    global next_request_id
    next_request_id += 1
    request = {
        "version": 1,
        "id": next_request_id,
        "token": token,
        "op": operation,
        **payload,
    }
    writer.write(json.dumps(request, separators=(",", ":")) + "\n")
    writer.flush()
    response = json.loads(reader.readline())
    if response.get("id") != next_request_id or response.get("ok") is not True:
        raise RuntimeError(response.get("error", "invalid daemon response"))
    return response.get("result")


try:
    call("claim", nodeIds=["portable.python"])
    delivery = call("poll", waitMs=5000)
    if delivery is None:
        raise RuntimeError("timed out waiting for change")
    change = delivery["change"]
    state = delivery["state"]
    call(
        "commit",
        changeId=change["changeId"],
        operations=[{"op": "write", "key": "runs", "value": state["runs"] + 1}],
    )
finally:
    writer.close()
    reader.close()
    connection.close()
