# SPDX-License-Identifier: Apache-2.0
from __future__ import annotations

import json
from collections.abc import AsyncGenerator
from typing import Any

from sse_starlette.sse import EventSourceResponse


def sse_response(
    generator: AsyncGenerator[dict[str, Any], None],
    *,
    ping_seconds: int = 15,
) -> EventSourceResponse:
    """
    Wrap an async generator of dicts as a Starlette SSE response.
    Sends a keepalive ping every ping_seconds seconds between events.
    """
    async def event_stream() -> AsyncGenerator[dict[str, Any], None]:
        async for chunk in generator:
            yield {"data": json.dumps(chunk, ensure_ascii=False)}

    return EventSourceResponse(event_stream(), ping=ping_seconds)
