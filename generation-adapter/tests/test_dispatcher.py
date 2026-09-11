from __future__ import annotations

import unittest

from generation_adapter.contracts import AdapterRequest
from generation_adapter.dispatcher import AdapterDispatcher


class RecordingProvider:
    def __init__(self):
        self.calls: list[tuple[str, dict]] = []

    def submit(self, request):
        self.calls.append(("submit", dict(request)))
        return {"status": "submitted", "handle": {"taskId": "remote-1"}}

    def poll(self, handle):
        self.calls.append(("poll", dict(handle)))
        return {"status": "pending", "progress": 25}

    def download(self, request):
        self.calls.append(("download", dict(request)))
        return {"status": "downloaded", "bytesWritten": 12}


class UnavailableProvider(RecordingProvider):
    def readiness(self):
        return {"ready": False, "error": "missing fixture dependency"}


def request(operation: str, payload: dict) -> AdapterRequest:
    return AdapterRequest.from_mapping(
        {"requestId": f"req-{operation}", "operation": operation, "payload": payload}
    )


class AdapterDispatcherTests(unittest.TestCase):
    def setUp(self):
        self.provider = RecordingProvider()
        self.dispatcher = AdapterDispatcher({"fixture": self.provider})

    def test_submit_does_not_poll_or_download(self):
        response = self.dispatcher.dispatch(
            request("submit", {"provider": "fixture", "request": {"prompt": "ready"}})
        )
        self.assertTrue(response.ok)
        self.assertEqual(self.provider.calls, [("submit", {"prompt": "ready"})])

    def test_one_poll_does_not_repeat_or_download(self):
        response = self.dispatcher.dispatch(
            request("poll", {"provider": "fixture", "handle": {"taskId": "remote-1"}})
        )
        self.assertTrue(response.ok)
        self.assertEqual(
            self.provider.calls,
            [("poll", {"taskId": "remote-1"})],
        )
        self.assertEqual(response.observation["status"], "pending")

    def test_download_is_an_independent_operation(self):
        response = self.dispatcher.dispatch(
            request(
                "download",
                {
                    "provider": "fixture",
                    "download": {
                        "artifact": {"url": "https://example.test/result.wav"},
                        "destination": "C:/project/media/result.wav",
                    },
                },
            )
        )
        self.assertTrue(response.ok)
        self.assertEqual(self.provider.calls[0][0], "download")
        self.assertEqual(len(self.provider.calls), 1)

    def test_unknown_provider_returns_structured_error(self):
        response = self.dispatcher.dispatch(
            request("poll", {"provider": "missing", "handle": {"taskId": "remote-1"}})
        )
        self.assertFalse(response.ok)
        self.assertEqual(response.error["code"], "adapter_operation_failed")

    def test_health_reports_unavailable_provider_dependencies(self):
        dispatcher = AdapterDispatcher({"fixture": UnavailableProvider()})
        response = dispatcher.dispatch(request("health", {}))

        self.assertTrue(response.ok)
        self.assertEqual(response.observation["status"], "degraded")
        self.assertEqual(
            response.observation["unavailableProviders"],
            {"fixture": "missing fixture dependency"},
        )


if __name__ == "__main__":
    unittest.main()
