# graphframework-sdk (Python mirror)

Same capability faces as `packages/sdk/javascript`:

`protocol / node / effect / plugin / analysis / agent / testing`.

DTO fields, operation names, generation, submission, analysis requests and
Agent controls match `packages/contract`. Transports differ (daemon JSON
Lines here; JS may also use N-API), line behavior must not.

Public imports come from the seven capability packages. In particular, use
`from graphframework_sdk.agent import KernelDaemonClient`; `daemon.py` is the
transport implementation behind that public Agent face. Each capability
package declares its supported names through `__all__`.
