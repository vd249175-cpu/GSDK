from __future__ import annotations

from io import StringIO
import json
import unittest

from generation_adapter.dispatcher import AdapterDispatcher
from generation_adapter.worker import JsonLineWorker


class JsonLineWorkerTests(unittest.TestCase):
    def test_health_and_shutdown_are_structured(self):
        source = StringIO(
            "\n".join(
                [
                    json.dumps({"requestId": "health-1", "operation": "health", "payload": {}}),
                    json.dumps({"requestId": "stop-1", "operation": "shutdown", "payload": {}}),
                ]
            )
            + "\n"
        )
        target = StringIO()

        JsonLineWorker(AdapterDispatcher(), max_workers=2).run(source, target)

        responses = [json.loads(line) for line in target.getvalue().splitlines()]
        by_id = {response["requestId"]: response for response in responses}
        self.assertEqual(by_id["health-1"]["observation"]["status"], "ready")
        self.assertEqual(by_id["stop-1"]["observation"]["status"], "stopping")

    def test_invalid_json_does_not_stop_worker(self):
        source = StringIO(
            "not-json\n"
            + json.dumps({"requestId": "stop-1", "operation": "shutdown", "payload": {}})
            + "\n"
        )
        target = StringIO()

        JsonLineWorker(AdapterDispatcher()).run(source, target)

        responses = [json.loads(line) for line in target.getvalue().splitlines()]
        self.assertEqual(responses[0]["error"]["code"], "invalid_request")
        self.assertEqual(responses[-1]["requestId"], "stop-1")


if __name__ == "__main__":
    unittest.main()
