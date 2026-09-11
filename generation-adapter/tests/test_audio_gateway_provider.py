from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import httpx

from generation_adapter.providers.audio_gateway import AudioGatewayProvider


FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class AudioGatewayProviderTests(unittest.TestCase):
    def test_submit_preserves_project_and_voice_design_contract_without_downloading(self):
        calls: list[tuple[str, str, bytes]] = []

        def handler(request: httpx.Request):
            calls.append((request.method, request.url.path, request.content))
            if request.method == "GET" and request.url.path == "/api/v1/projects/fixture-project":
                return httpx.Response(404, json={"detail": "missing"})
            if request.method == "POST" and request.url.path == "/api/v1/projects":
                return httpx.Response(201, json={"project_id": "fixture-project"})
            if request.method == "POST" and request.url.path.endswith("/voice/design"):
                return httpx.Response(
                    200,
                    headers={"content-type": "application/json"},
                    json={"voice_id": "voice_fixture", "sample_url": "/media/voice_fixture.wav"},
                )
            if request.method == "GET" and request.url.path == "/media/voice_fixture.wav":
                self.fail("submit must not download the returned media URL")
            return httpx.Response(404)

        provider = AudioGatewayProvider(
            "http://audio.example.test/api/v1",
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        observation = provider.submit(fixture("audio-submit-request.json"))

        self.assertEqual(observation["handle"]["resultKind"], "remote-url")
        self.assertEqual(
            [(method, path) for method, path, _ in calls],
            [
                ("GET", "/api/v1/projects/fixture-project"),
                ("POST", "/api/v1/projects"),
                ("POST", "/api/v1/projects/fixture-project/voice/design"),
            ],
        )
        create_body = json.loads(calls[1][2])
        self.assertEqual(create_body["name"], "Fixture Project")
        generate_body = json.loads(calls[2][2])
        self.assertEqual(generate_body["voice_id"], "voice_fixture")

    def test_poll_is_local_one_shot_and_download_fetches_only_after_ready(self):
        paths: list[str] = []

        def handler(request: httpx.Request):
            paths.append(request.url.path)
            if request.method == "POST":
                return httpx.Response(
                    200,
                    headers={"content-type": "application/json"},
                    json={"audio_url": "/media/sfx.wav"},
                )
            if request.url.path == "/media/sfx.wav":
                return httpx.Response(
                    200,
                    headers={"content-type": "audio/wav"},
                    content=b"RIFF-fixture-audio",
                )
            return httpx.Response(404)

        provider = AudioGatewayProvider(
            "http://audio.example.test/api/v1",
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        submitted = provider.submit({
            "taskType": "SFX",
            "projectId": "default",
            "payload": {"prompt": "fixture ambience"},
        })
        self.assertEqual(paths, ["/api/v1/projects/default/audio/generate"])

        ready = provider.poll(submitted["handle"])
        self.assertEqual(ready["status"], "ready")
        self.assertEqual(paths, ["/api/v1/projects/default/audio/generate"])

        with TemporaryDirectory() as temporary:
            destination = Path(temporary) / "sfx.wav"
            downloaded = provider.download({
                "artifact": ready["artifact"],
                "destination": str(destination),
            })
            self.assertEqual(destination.read_bytes(), b"RIFF-fixture-audio")
            self.assertEqual(downloaded["contentType"], "audio/wav")
        self.assertEqual(paths[-1], "/media/sfx.wav")

    def test_binary_response_remains_process_owned_until_download(self):
        def handler(request: httpx.Request):
            return httpx.Response(
                200,
                headers={"content-type": "audio/wav"},
                content=b"RIFF-binary-result",
            )

        provider = AudioGatewayProvider(
            "http://audio.example.test/api/v1",
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        submitted = provider.submit({
            "taskType": "SPEECH",
            "projectId": "default",
            "payload": {"text": "fixture"},
        })
        self.assertNotIn("content", submitted["handle"])
        ready = provider.poll(submitted["handle"])
        self.assertIn("token", ready["artifact"])

        with TemporaryDirectory() as temporary:
            destination = Path(temporary) / "speech.wav"
            provider.download({"artifact": ready["artifact"], "destination": str(destination)})
            self.assertEqual(destination.read_bytes(), b"RIFF-binary-result")


if __name__ == "__main__":
    unittest.main()

