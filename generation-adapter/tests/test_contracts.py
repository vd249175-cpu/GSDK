from __future__ import annotations

import unittest

from generation_adapter.contracts import AdapterRequest, ProtocolError


class AdapterRequestTests(unittest.TestCase):
    def test_accepts_supported_operation(self):
        request = AdapterRequest.from_mapping(
            {"requestId": "req-1", "operation": "poll", "payload": {}}
        )
        self.assertEqual(request.request_id, "req-1")
        self.assertEqual(request.operation, "poll")

    def test_rejects_unknown_operation(self):
        with self.assertRaisesRegex(ProtocolError, "unsupported operation"):
            AdapterRequest.from_mapping(
                {"requestId": "req-1", "operation": "generate-all", "payload": {}}
            )


if __name__ == "__main__":
    unittest.main()

