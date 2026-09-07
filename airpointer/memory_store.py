from __future__ import annotations

import base64
import json
import os
import re
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any


def default_memory_root() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", "")) if os.name == "nt" else Path.home()
    return (base / "AirPointer" / "screen-memory") if os.name == "nt" else (base / ".airpointer" / "screen-memory")


class MemoryStore:
    """Small local-first screen-memory index shared by the companion API and MCP."""

    def __init__(self, root: Path | None = None) -> None:
        self.root = root or default_memory_root()
        self.frames_dir = self.root / "frames"
        self.root.mkdir(parents=True, exist_ok=True)
        self.frames_dir.mkdir(parents=True, exist_ok=True)
        self.path = self.root / "memory.sqlite3"
        self._lock = threading.RLock()
        self._init_schema()

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA journal_mode=WAL")
        return connection

    def _init_schema(self) -> None:
        with self._connect() as db:
            db.executescript("""
                CREATE TABLE IF NOT EXISTS frames (
                    id TEXT PRIMARY KEY,
                    captured_at REAL NOT NULL,
                    source TEXT NOT NULL,
                    surface TEXT NOT NULL,
                    width INTEGER NOT NULL,
                    height INTEGER NOT NULL,
                    text TEXT NOT NULL DEFAULT '',
                    image_path TEXT NOT NULL,
                    bookmarked INTEGER NOT NULL DEFAULT 0,
                    note TEXT NOT NULL DEFAULT '',
                    tags TEXT NOT NULL DEFAULT '[]'
                );
                CREATE INDEX IF NOT EXISTS frames_captured_at ON frames(captured_at DESC);
                CREATE INDEX IF NOT EXISTS frames_bookmarked ON frames(bookmarked, captured_at DESC);
                CREATE VIRTUAL TABLE IF NOT EXISTS frames_fts USING fts5(id UNINDEXED, text, note, tags, tokenize='unicode61');
                CREATE TABLE IF NOT EXISTS reports (
                    id TEXT PRIMARY KEY,
                    created_at REAL NOT NULL,
                    from_at REAL NOT NULL,
                    to_at REAL NOT NULL,
                    title TEXT NOT NULL,
                    markdown TEXT NOT NULL,
                    automatic INTEGER NOT NULL DEFAULT 0
                );
            """)

    def add_frame(self, payload: dict[str, Any]) -> dict[str, Any]:
        frame_id = str(payload.get("id") or uuid.uuid4())[:80]
        captured_at = _finite(payload.get("capturedAt"), time.time() * 1000)
        image_url = payload.get("imageUrl", "")
        image_path = self.frames_dir / f"{frame_id}.jpg"
        if isinstance(image_url, str) and image_url.startswith("data:image/"):
            match = re.match(r"^data:image/(?:jpeg|png);base64,(.+)$", image_url, re.DOTALL)
            if not match:
                raise ValueError("invalid image data URL")
            raw = base64.b64decode(match.group(1), validate=True)
            if len(raw) > 4 * 1024 * 1024:
                raise ValueError("image is too large")
            image_path.write_bytes(raw)
        elif isinstance(payload.get("imagePath"), str):
            source_path = Path(payload["imagePath"]).resolve()
            if not source_path.is_file():
                raise ValueError("image path does not exist")
            image_path = source_path
        else:
            raise ValueError("image is required")
        tags = _tags(payload.get("tags", []))
        record = {
            "id": frame_id, "capturedAt": captured_at, "source": str(payload.get("source", "timeline"))[:24],
            "surface": str(payload.get("surface", "unknown"))[:24], "width": max(1, int(payload.get("width", 1))),
            "height": max(1, int(payload.get("height", 1))), "text": str(payload.get("text", ""))[:20000],
            "imagePath": str(image_path), "bookmarked": bool(payload.get("bookmarked", False)),
            "note": str(payload.get("note", ""))[:1000], "tags": tags,
        }
        with self._lock, self._connect() as db:
            db.execute("""INSERT OR REPLACE INTO frames
                (id,captured_at,source,surface,width,height,text,image_path,bookmarked,note,tags)
                VALUES (?,?,?,?,?,?,?,?,?,?,?)""", (frame_id, captured_at, record["source"], record["surface"], record["width"], record["height"], record["text"], record["imagePath"], int(record["bookmarked"]), record["note"], json.dumps(tags, ensure_ascii=False)))
            db.execute("DELETE FROM frames_fts WHERE id=?", (frame_id,))
            db.execute("INSERT INTO frames_fts(id,text,note,tags) VALUES (?,?,?,?)", (frame_id, record["text"], record["note"], " ".join(tags)))
        self._prune_timeline()
        return record

    def _prune_timeline(self, maximum: int = 500) -> None:
        with self._lock, self._connect() as db:
            expired = db.execute("SELECT id,image_path FROM frames WHERE bookmarked=0 ORDER BY captured_at DESC LIMIT -1 OFFSET ?", (maximum,)).fetchall()
            for row in expired:
                db.execute("DELETE FROM frames WHERE id=?", (row["id"],))
                db.execute("DELETE FROM frames_fts WHERE id=?", (row["id"],))
        for row in expired:
            image_path = Path(row["image_path"])
            if image_path.parent == self.frames_dir and image_path.is_file():
                image_path.unlink(missing_ok=True)

    def search(self, query: str = "", from_at: float = 0, to_at: float | None = None,
               bookmarked: bool | None = None, limit: int = 50) -> list[dict[str, Any]]:
        clauses = ["f.captured_at >= ?", "f.captured_at <= ?"]
        params: list[Any] = [from_at, to_at or time.time() * 1000]
        join = ""
        if query.strip():
            join = " JOIN frames_fts ON frames_fts.id=f.id "
            clauses.append("frames_fts MATCH ?")
            params.append(_fts_query(query))
        if bookmarked is not None:
            clauses.append("f.bookmarked=?")
            params.append(int(bookmarked))
        params.append(max(1, min(int(limit), 200)))
        sql = f"SELECT f.* FROM frames f {join} WHERE {' AND '.join(clauses)} ORDER BY f.captured_at DESC LIMIT ?"
        with self._lock, self._connect() as db:
            return [_row(row) for row in db.execute(sql, params).fetchall()]

    def update_frame(self, frame_id: str, *, bookmarked: bool | None = None,
                     note: str | None = None, tags: list[str] | None = None,
                     text: str | None = None) -> dict[str, Any] | None:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT * FROM frames WHERE id=?", (frame_id,)).fetchone()
            if row is None:
                return None
            next_note = str(note)[:1000] if note is not None else row["note"]
            next_tags = _tags(tags) if tags is not None else json.loads(row["tags"])
            next_text = str(text)[:20000] if text is not None else row["text"]
            next_bookmarked = int(bookmarked) if bookmarked is not None else row["bookmarked"]
            db.execute("UPDATE frames SET bookmarked=?,note=?,tags=?,text=? WHERE id=?", (next_bookmarked, next_note, json.dumps(next_tags, ensure_ascii=False), next_text, frame_id))
            db.execute("DELETE FROM frames_fts WHERE id=?", (frame_id,))
            db.execute("INSERT INTO frames_fts(id,text,note,tags) VALUES (?,?,?,?)", (frame_id, next_text, next_note, " ".join(next_tags)))
            updated = db.execute("SELECT * FROM frames WHERE id=?", (frame_id,)).fetchone()
            return _row(updated)

    def delete_frame(self, frame_id: str) -> bool:
        with self._lock, self._connect() as db:
            row = db.execute("SELECT image_path FROM frames WHERE id=?", (frame_id,)).fetchone()
            if row is None:
                return False
            db.execute("DELETE FROM frames WHERE id=?", (frame_id,))
            db.execute("DELETE FROM frames_fts WHERE id=?", (frame_id,))
        image_path = Path(row["image_path"])
        if image_path.parent == self.frames_dir and image_path.is_file():
            image_path.unlink(missing_ok=True)
        return True

    def summary(self, from_at: float, to_at: float | None = None) -> dict[str, Any]:
        to_at = to_at or time.time() * 1000
        frames = self.search(from_at=from_at, to_at=to_at, limit=200)
        ordered = sorted(frame["capturedAt"] for frame in frames)
        active_ms = sum(min(15000, current - previous) for previous, current in zip(ordered, ordered[1:]))
        tags: dict[str, int] = {}
        sources: dict[str, int] = {}
        for frame in frames:
            sources[frame["source"]] = sources.get(frame["source"], 0) + 1
            for tag in frame["tags"]:
                tags[tag] = tags.get(tag, 0) + 1
        return {"from": from_at, "to": to_at, "activeMinutes": round(active_ms / 60000, 2), "frameCount": len(frames),
                "bookmarkCount": sum(1 for frame in frames if frame["bookmarked"]), "sources": sources,
                "topTags": sorted(({"tag": tag, "count": count} for tag, count in tags.items()), key=lambda item: -item["count"])[:8]}

    def create_report(self, from_at: float, to_at: float | None = None, title: str = "AirPointer 개발 리포트", automatic: bool = False) -> dict[str, Any]:
        to_at = to_at or time.time() * 1000
        frames = list(reversed(self.search(from_at=from_at, to_at=to_at, limit=200)))
        bookmarks = [frame for frame in frames if frame["bookmarked"]]
        errors = [frame for frame in frames if re.search(r"error|exception|failed|오류|실패", f'{frame["text"]} {frame["note"]}', re.I)]
        highlights = bookmarks or errors
        lines = [f"# {title}", "", f"- 기록 프레임: {len(frames)}개", f"- 북마크: {len(bookmarks)}개", f"- 오류 후보: {len(errors)}개", "", "## 핵심 시점", ""]
        for index, frame in enumerate(highlights[:20], 1):
            lines += [f'### {index}. {time.strftime("%H:%M:%S", time.localtime(frame["capturedAt"] / 1000))} · {frame["note"] or "화면 기록"}', "", frame["text"][:800] or "화면 텍스트 없음", "", f'로컬 이미지: `{frame["imagePath"]}`', ""]
        lines += ["## 재현 메모", "", "- 예상 동작:", "- 실제 동작:", "- 재현 단계:"]
        report = {"id": str(uuid.uuid4()), "createdAt": time.time() * 1000, "from": from_at, "to": to_at, "title": title[:120], "markdown": "\n".join(lines), "automatic": automatic}
        with self._lock, self._connect() as db:
            db.execute("INSERT INTO reports(id,created_at,from_at,to_at,title,markdown,automatic) VALUES (?,?,?,?,?,?,?)", (report["id"], report["createdAt"], from_at, to_at, report["title"], report["markdown"], int(automatic)))
        return report

    def list_reports(self, limit: int = 20) -> list[dict[str, Any]]:
        with self._lock, self._connect() as db:
            rows = db.execute("SELECT * FROM reports ORDER BY created_at DESC LIMIT ?", (max(1, min(limit, 100)),)).fetchall()
        return [{"id": row["id"], "createdAt": row["created_at"], "from": row["from_at"], "to": row["to_at"], "title": row["title"], "markdown": row["markdown"], "automatic": bool(row["automatic"])} for row in rows]


def _finite(value: Any, fallback: float) -> float:
    try:
        number = float(value)
        return number if number == number and abs(number) != float("inf") else fallback
    except (TypeError, ValueError):
        return fallback


def _tags(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return list(dict.fromkeys(str(tag).strip()[:80] for tag in value if str(tag).strip()))[:12]


def _fts_query(query: str) -> str:
    words = re.findall(r"[\w.-]+", query, re.UNICODE)[:12]
    return " AND ".join(f'"{word.replace(chr(34), "")}"*' for word in words) or '""'


def _row(row: sqlite3.Row) -> dict[str, Any]:
    return {"id": row["id"], "capturedAt": row["captured_at"], "source": row["source"], "surface": row["surface"], "width": row["width"], "height": row["height"], "text": row["text"], "imagePath": row["image_path"], "bookmarked": bool(row["bookmarked"]), "note": row["note"], "tags": json.loads(row["tags"])}
