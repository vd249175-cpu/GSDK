"""Concurrent stdin/stdout worker for Electron-managed adapter operations."""

from __future__ import annotations

from concurrent.futures import Future, ThreadPoolExecutor
import json
from threading import Lock
from typing import IO, Any

from .contracts import AdapterRequest, AdapterResponse, ProtocolError
from .dispatcher import AdapterDispatcher


class JsonLineWorker:
    def __init__(self, dispatcher: AdapterDispatcher, max_workers: int = 8):
        if max_workers < 1:
            raise ValueError("max_workers must be positive")
        self._dispatcher = dispatcher
        self._max_workers = max_workers
        self._write_lock = Lock()

    def run(self, input_stream: IO[str], output_stream: IO[str]) -> None:
        with ThreadPoolExecutor(
            max_workers=self._max_workers,
            thread_name_prefix="generation-adapter",
        ) as executor:
            for raw_line in input_stream:
                line = raw_line.strip()
                if not line:
                    continue
                try:
                    request = AdapterRequest.from_mapping(json.loads(line))
                except (json.JSONDecodeError, ProtocolError) as error:
                    self._write(
                        output_stream,
                        {
                            "requestId": self._best_effort_request_id(line),
                            "ok": False,
                            "error": {
                                "code": "invalid_request",
                                "message": str(error),
                            },
                        },
                    )
                    continue

                if request.operation == "shutdown":
                    self._write(
                        output_stream,
                        self._dispatcher.dispatch(request).to_mapping(),
                    )
                    break

                future = executor.submit(self._dispatcher.dispatch, request)
                future.add_done_callback(
                    lambda completed, stream=output_stream: self._write_future(stream, completed)
                )

    def _write_future(
        self,
        output_stream: IO[str],
        future: Future[AdapterResponse],
    ) -> None:
        try:
            response = future.result().to_mapping()
        except Exception as error:  # defensive: dispatcher normally structures errors
            response = {
                "requestId": "unknown",
                "ok": False,
                "error": {
                    "code": "internal_error",
                    "message": str(error),
                },
            }
        self._write(output_stream, response)

    def _write(self, output_stream: IO[str], value: dict[str, Any]) -> None:
        encoded = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
        with self._write_lock:
            output_stream.write(encoded + "\n")
            output_stream.flush()

    @staticmethod
    def _best_effort_request_id(line: str) -> str:
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            return "unknown"
        request_id = value.get("requestId") if isinstance(value, dict) else None
        return request_id if isinstance(request_id, str) else "unknown"
