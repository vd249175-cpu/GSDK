"""Command-line entry point for the Electron-managed generation worker."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

from .config import load_config
from .contracts import AdapterRequest
from .dispatcher import AdapterDispatcher
from .providers.factory import build_providers
from .worker import JsonLineWorker


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="graphvideo-generation-adapter")
    subparsers = parser.add_subparsers(dest="command", required=True)

    worker = subparsers.add_parser("worker", help="run JSON Lines over stdin/stdout")
    worker.add_argument("--config", type=Path)

    check = subparsers.add_parser("check", help="validate config and print health")
    check.add_argument("--config", type=Path)
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    config = load_config(args.config)

    dispatcher = AdapterDispatcher(build_providers(config))
    if args.command == "check":
        request = AdapterRequest.from_mapping(
            {"requestId": "check", "operation": "health", "payload": {}}
        )
        print(json.dumps(dispatcher.dispatch(request).to_mapping(), ensure_ascii=False))
        return 0

    JsonLineWorker(dispatcher, max_workers=config.max_workers).run(
        sys.stdin,
        sys.stdout,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
