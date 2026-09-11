"""Provider transport implementations.

Phase 0 defines only the provider protocol. Existing ComfyUI and audio transport
logic will move here under golden contract tests in Phase 1.
"""

from .base import GenerationProvider
from .audio_gateway import AudioGatewayProvider
from .comfy_cloud import ComfyCloudProvider

__all__ = ["AudioGatewayProvider", "ComfyCloudProvider", "GenerationProvider"]

