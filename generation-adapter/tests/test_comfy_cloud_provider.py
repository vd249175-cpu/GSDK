from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

import httpx

from generation_adapter.providers.comfy_cloud import ComfyCloudProvider
from generation_adapter.providers import comfy_cloud


FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name: str):
    return json.loads((FIXTURES / name).read_text(encoding="utf-8"))


class ComfyCloudProviderTests(unittest.TestCase):
    def test_sdk_canceled_and_expired_jobs_are_terminal_failures(self):
        class Job:
            error = None

            def refresh(self):
                return self

        provider = ComfyCloudProvider("https://cloud.example.test", use_sdk=True)
        job = Job()
        provider._sdk_jobs["terminal-job"] = {"job": job, "expectedOutputKind": "video"}
        for status in ("canceled", "cancelled", "expired", "failed"):
            with self.subTest(status=status):
                job.status = status
                observation = provider.poll({"taskId": "terminal-job"})
                self.assertEqual(observation["status"], "failed")
                self.assertEqual(observation["progress"], 0)

    def test_readiness_reports_missing_sdk_before_submit(self):
        original_sdk = comfy_cloud.Comfy
        comfy_cloud.Comfy = None
        try:
            provider = ComfyCloudProvider(
                "https://cloud.example.test",
                api_key="fixture-key",
                use_sdk=True,
            )
            readiness = provider.readiness()
        finally:
            comfy_cloud.Comfy = original_sdk

        self.assertFalse(readiness["ready"])
        self.assertIn("comfy-sdk", readiness["error"])

    def test_sdk_submit_is_non_blocking_and_passes_api_key_to_partner_nodes(self):
        class Workflows:
            @staticmethod
            def from_json(prompt):
                return prompt

        class Job:
            id = "seedance-sdk-job"

        class Client:
            workflows = Workflows()

            def __init__(self):
                self.api_key = None

            def submit(self, _workflow, *, api_key=None):
                self.api_key = api_key
                return Job()

            def run(self, _workflow, *, api_key=None):
                raise AssertionError("submit transport must not wait for terminal job state")

        client = Client()
        provider = ComfyCloudProvider(
            "https://cloud.example.test",
            api_key="seedance-partner-key",
            use_sdk=True,
        )
        provider._sdk_client = client

        observation = provider.submit({
            "prompt": {
                "360": {
                    "class_type": "ByteDance2ReferenceNodeV2",
                    "inputs": {"model": "Seedance 2.0"},
                }
            },
            "workflowType": "seedance-video",
            "expectedOutputKind": "video",
        })

        self.assertEqual(client.api_key, "seedance-partner-key")
        self.assertEqual(observation["handle"]["taskId"], "seedance-sdk-job")

    def test_sdk_video_waits_for_terminal_state_and_downloads_video_output_by_asset_id(self):
        class Output:
            def __init__(self, output_id, name, kind, content_type, content):
                self.id = output_id
                self.name = name
                self.type = kind
                self.content_type = content_type
                self.content = content

            def to_file(self, path):
                Path(path).write_bytes(self.content)

        class Job:
            def __init__(self):
                self.status = "running"
                self.error = None
                self.outputs = [
                    Output("preview-id", "preview.png", "image", "image/png", b"preview"),
                ]

            def refresh(self):
                return self

        provider = ComfyCloudProvider(
            "https://cloud.example.test",
            api_key="fixture-key",
            use_sdk=True,
        )
        job = Job()
        provider._sdk_jobs["video-job"] = {
            "job": job,
            "expectedOutputKind": "video",
        }

        pending = provider.poll({"taskId": "video-job"})
        self.assertEqual(pending["status"], "pending")

        # Real Comfy Cloud SaveVideo observation (2026-08-29): the MP4 asset
        # was mislabeled type=image with blank content_type and size_bytes=0.
        # Its committed filename still identifies the downloadable video.
        video = Output("video-id", "result.mp4", "image", "", b"video-bytes")
        job.status = "completed"
        job.outputs = [job.outputs[0], video]
        ready = provider.poll({"taskId": "video-job"})

        self.assertEqual(ready["status"], "ready")
        self.assertEqual(ready["artifact"]["kind"], "video")
        self.assertEqual(ready["artifact"]["filename"], "result.mp4")
        self.assertEqual(ready["artifact"]["token"], "video-id")

        # Even if the output ordering changes between poll and download, the
        # artifact id keeps the transfer bound to the selected video.
        job.outputs = [video, job.outputs[0]]
        with TemporaryDirectory() as temporary:
            destination = Path(temporary) / "result.mp4"
            downloaded = provider.download({
                "artifact": ready["artifact"],
                "destination": str(destination),
            })

            self.assertEqual(destination.read_bytes(), b"video-bytes")
            self.assertEqual(downloaded["contentType"], "video/mp4")

    def test_submit_preserves_cloud_payload_and_does_not_poll(self):
        calls: list[httpx.Request] = []

        def handler(request: httpx.Request):
            calls.append(request)
            return httpx.Response(200, json={"prompt_id": "prompt-fixture-1"})

        provider = ComfyCloudProvider(
            "https://cloud.example.test",
            api_key="secret-fixture",
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        observation = provider.submit(fixture("comfy-submit-request.json"))

        self.assertEqual(observation["handle"]["taskId"], "prompt-fixture-1")
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0].url.path, "/api/prompt")
        body = json.loads(calls[0].content)
        self.assertEqual(body["client_id"], "gv-fixture-client")
        self.assertEqual(body["prompt"]["4"]["inputs"]["model.duration"], 5)
        self.assertEqual(body["extra_data"]["api_key_comfy_org"], "secret-fixture")
        self.assertEqual(calls[0].headers["x-api-key"], "secret-fixture")
        self.assertEqual(calls[0].headers["authorization"], "Bearer secret-fixture")

    def test_poll_queries_each_status_endpoint_once_and_returns_ready_artifact(self):
        job = fixture("comfy-job-ready.json")
        paths: list[str] = []

        def handler(request: httpx.Request):
            paths.append(request.url.path)
            if request.url.path == "/api/job/prompt-fixture-1/status":
                return httpx.Response(200, json={"status": "success"})
            if request.url.path == "/api/jobs/prompt-fixture-1":
                return httpx.Response(200, json=job)
            return httpx.Response(404, json={})

        provider = ComfyCloudProvider(
            "https://cloud.example.test",
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        observation = provider.poll({"taskId": "prompt-fixture-1"})

        self.assertEqual(observation["status"], "ready")
        self.assertEqual(paths, [
            "/api/job/prompt-fixture-1/status",
            "/api/jobs/prompt-fixture-1",
        ])
        artifact = observation["artifact"]
        self.assertEqual(artifact["kind"], "video")
        self.assertEqual(artifact["filename"], "fixture result.mp4")
        self.assertEqual(
            artifact["url"],
            "https://cloud.example.test/api/view?filename=fixture%20result.mp4&subfolder=video%2Ffinal&type=output",
        )

    def test_pending_poll_performs_no_wait_or_second_scan(self):
        paths: list[str] = []

        def handler(request: httpx.Request):
            paths.append(request.url.path)
            if request.url.path.endswith("/status"):
                return httpx.Response(200, json={"status": "running"})
            return httpx.Response(200, json={})

        provider = ComfyCloudProvider(
            "https://cloud.example.test",
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        observation = provider.poll({"taskId": "prompt-fixture-1"})

        self.assertEqual(observation["status"], "pending")
        self.assertEqual(paths, [
            "/api/job/prompt-fixture-1/status",
            "/api/jobs/prompt-fixture-1",
            "/api/history/prompt-fixture-1",
        ])

    def test_poll_preserves_comfy_execution_error_details(self):
        def handler(request: httpx.Request):
            if request.url.path.endswith("/status"):
                return httpx.Response(200, json={"status": "running"})
            if request.url.path.startswith("/api/jobs/"):
                return httpx.Response(200, json={})
            return httpx.Response(200, json={
                "prompt-fixture-1": {
                    "status": {
                        "status_str": "error",
                        "messages": [["执行失败", "OOM"]],
                    }
                }
            })

        provider = ComfyCloudProvider(
            "https://cloud.example.test",
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        observation = provider.poll({"taskId": "prompt-fixture-1"})

        self.assertEqual(observation["status"], "failed")
        self.assertEqual(observation["error"], "执行失败: OOM")

    def test_download_writes_the_explicit_artifact_only(self):
        def handler(request: httpx.Request):
            self.assertEqual(request.url.path, "/api/view")
            return httpx.Response(
                200,
                headers={"content-type": "video/mp4"},
                content=b"fixture-video-bytes",
            )

        provider = ComfyCloudProvider(
            "https://cloud.example.test",
            client=httpx.Client(transport=httpx.MockTransport(handler)),
        )
        with TemporaryDirectory() as temporary:
            destination = Path(temporary) / "result.mp4"
            observation = provider.download({
                "artifact": {
                    "taskId": "prompt-fixture-1",
                    "url": "https://cloud.example.test/api/view?filename=result.mp4",
                },
                "destination": str(destination),
            })

            self.assertEqual(destination.read_bytes(), b"fixture-video-bytes")
            self.assertEqual(observation["bytesWritten"], 19)
            self.assertEqual(observation["contentType"], "video/mp4")


if __name__ == "__main__":
    unittest.main()
