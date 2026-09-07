from __future__ import annotations

import json
import sys
import time
from typing import Any

from .memory_store import MemoryStore

PROTOCOL_VERSION = "2025-06-18"

TOOLS = [
    {"name": "search_screen_memory", "description": "OCR text, notes, and tags from local screen history. Audio is never searched.", "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}, "minutes": {"type": "number", "minimum": 1}, "bookmarked": {"type": "boolean"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}}}},
    {"name": "get_screen_timeline", "description": "Chronological local screen frames for a recent time window.", "inputSchema": {"type": "object", "properties": {"minutes": {"type": "number", "minimum": 1}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}}}},
    {"name": "list_screen_bookmarks", "description": "Persistent user-bookmarked screen frames with notes, tags, and local image paths.", "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 100}}}},
    {"name": "screen_activity_summary", "description": "Compressed activity and tag counts from local screen history.", "inputSchema": {"type": "object", "properties": {"minutes": {"type": "number", "minimum": 1}}}},
    {"name": "create_developer_report", "description": "Create and persist a Markdown developer report from bookmarks and detected error text.", "inputSchema": {"type": "object", "properties": {"minutes": {"type": "number", "minimum": 1}, "title": {"type": "string"}}}},
]


def result_text(value: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False, indent=2)}]}


def call_tool(store: MemoryStore, name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    minutes = max(1.0, float(arguments.get("minutes", 60)))
    from_at = time.time() * 1000 - minutes * 60_000
    limit = max(1, min(int(arguments.get("limit", 50)), 100))
    if name == "search_screen_memory":
        return result_text(store.search(str(arguments.get("query", "")), from_at, bookmarked=arguments.get("bookmarked"), limit=limit))
    if name == "get_screen_timeline":
        return result_text(list(reversed(store.search(from_at=from_at, limit=limit))))
    if name == "list_screen_bookmarks":
        return result_text(store.search(bookmarked=True, limit=limit))
    if name == "screen_activity_summary":
        return result_text(store.summary(from_at))
    if name == "create_developer_report":
        return result_text(store.create_report(from_at, title=str(arguments.get("title", "AirPointer 개발 리포트"))))
    raise ValueError(f"unknown tool: {name}")


def handle(store: MemoryStore, message: dict[str, Any]) -> dict[str, Any] | None:
    method = message.get("method")
    request_id = message.get("id")
    if request_id is None:
        return None
    try:
        if method == "initialize":
            result = {"protocolVersion": PROTOCOL_VERSION, "capabilities": {"tools": {"listChanged": False}}, "serverInfo": {"name": "airpointer-screen-memory", "version": "1.0.0"}}
        elif method == "tools/list":
            result = {"tools": TOOLS}
        elif method == "tools/call":
            params = message.get("params") or {}
            result = call_tool(store, str(params.get("name", "")), params.get("arguments") or {})
        elif method == "ping":
            result = {}
        else:
            raise ValueError(f"method not found: {method}")
        return {"jsonrpc": "2.0", "id": request_id, "result": result}
    except Exception as error:
        return {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32603, "message": str(error)}}


def main() -> None:
    store = MemoryStore()
    for line in sys.stdin:
        try:
            message = json.loads(line)
            response = handle(store, message)
            if response is not None:
                sys.stdout.write(json.dumps(response, ensure_ascii=False, separators=(",", ":")) + "\n")
                sys.stdout.flush()
        except Exception as error:
            sys.stdout.write(json.dumps({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": str(error)}}) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
