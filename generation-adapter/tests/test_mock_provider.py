from __future__ import annotations

from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from generation_adapter.providers.mock import MockProvider


class MockProviderTests(unittest.TestCase):
    def test_preserves_submit_poll_download_boundaries(self):
        provider = MockProvider()
        submitted = provider.submit({"kind": "image"})
        ready = provider.poll(submitted["handle"])
        with TemporaryDirectory() as temporary:
            destination = Path(temporary) / "draft.png"
            downloaded = provider.download({"artifact": ready["artifact"], "destination": str(destination)})
            self.assertEqual(destination.read_bytes(), b"MOCK_IMAGE")
            self.assertEqual(downloaded["bytesWritten"], 10)


if __name__ == "__main__":
    unittest.main()
