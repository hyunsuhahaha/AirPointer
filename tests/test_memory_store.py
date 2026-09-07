import base64
import json
import time
from pathlib import Path
from urllib.request import Request, urlopen

from airpointer.companion_bridge import CompanionHttpServer, CompanionState
from airpointer.memory_store import MemoryStore
from airpointer.mcp_server import call_tool, handle


JPEG = "data:image/jpeg;base64," + base64.b64encode(b"fake-jpeg").decode()


def test_memory_store_search_bookmark_summary_and_report(tmp_path: Path) -> None:
    store = MemoryStore(tmp_path / "memory")
    stored = store.add_frame({"capturedAt": 1000, "imageUrl": JPEG, "text": "TypeError ResultsPanel", "source": "bookmark", "surface": "window", "width": 800, "height": 600, "bookmarked": True, "note": "결제 오류", "tags": ["error", "checkout"]})
    assert store.search("TypeError")[0]["id"] == stored["id"]
    assert store.search(bookmarked=True)[0]["tags"] == ["error", "checkout"]
    assert store.summary(0, 2000)["bookmarkCount"] == 1
    assert "TypeError" in store.create_report(0, 2000)["markdown"]


def test_memory_mcp_lists_tools_and_searches(tmp_path: Path) -> None:
    store = MemoryStore(tmp_path / "memory")
    store.add_frame({"capturedAt": time.time() * 1000, "imageUrl": JPEG, "text": "build failed", "width": 10, "height": 10})
    listed = handle(store, {"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    assert any(tool["name"] == "search_screen_memory" for tool in listed["result"]["tools"])
    searched = call_tool(store, "search_screen_memory", {"query": "build", "minutes": 10})
    assert "build failed" in searched["content"][0]["text"]


def test_companion_memory_http_api_is_token_protected_and_searchable(tmp_path: Path) -> None:
    state = CompanionState()
    state.authorize("test-token")
    server = CompanionHttpServer(state, port=0, memory_store=MemoryStore(tmp_path / "http-memory"))
    server.start()
    port = server._server.server_port
    try:
        payload = json.dumps({"capturedAt": time.time() * 1000, "imageUrl": JPEG, "text": "checkout exception", "width": 10, "height": 10}).encode()
        request = Request(f"http://127.0.0.1:{port}/memory/frames?token=test-token", data=payload, headers={"Content-Type": "application/json"}, method="POST")
        with urlopen(request, timeout=2) as response:
            assert response.status == 201
        with urlopen(f"http://127.0.0.1:{port}/memory/search?token=test-token&q=checkout", timeout=2) as response:
            result = json.load(response)
        assert result["frames"][0]["text"] == "checkout exception"
    finally:
        server.close()
