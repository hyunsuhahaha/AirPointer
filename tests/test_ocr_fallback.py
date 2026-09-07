import airpointer.ocr_fallback as ocr_fallback


def _stub_recognize(monkeypatch, text: str | Exception) -> None:
    async def fake_recognize(rect):
        if isinstance(text, Exception):
            raise text
        return text
    monkeypatch.setattr(ocr_fallback, "_recognize", fake_recognize)


def test_text_label_at_returns_the_recognized_text(monkeypatch) -> None:
    _stub_recognize(monkeypatch, "저장")
    assert ocr_fallback.text_label_at((0, 0, 10, 10)) == "저장"


def test_text_label_at_collapses_embedded_whitespace_and_newlines(monkeypatch) -> None:
    _stub_recognize(monkeypatch, "저장\n버튼   확인")
    assert ocr_fallback.text_label_at((0, 0, 10, 10)) == "저장 버튼 확인"


def test_text_label_at_returns_none_for_an_empty_result(monkeypatch) -> None:
    _stub_recognize(monkeypatch, "")
    assert ocr_fallback.text_label_at((0, 0, 10, 10)) is None


def test_text_label_at_returns_none_for_a_whitespace_only_result(monkeypatch) -> None:
    _stub_recognize(monkeypatch, "   \n  \t ")
    assert ocr_fallback.text_label_at((0, 0, 10, 10)) is None


def test_text_label_at_truncates_long_results(monkeypatch) -> None:
    _stub_recognize(monkeypatch, "가" * 100)
    label = ocr_fallback.text_label_at((0, 0, 10, 10))
    assert label is not None
    assert label.endswith("…")
    assert len(label) == ocr_fallback._MAX_LENGTH + 1


def test_text_label_at_returns_none_on_any_recognition_failure(monkeypatch) -> None:
    _stub_recognize(monkeypatch, RuntimeError("OCR engine not ready"))
    assert ocr_fallback.text_label_at((0, 0, 10, 10)) is None


def test_get_engine_creates_and_caches_on_first_use(monkeypatch) -> None:
    monkeypatch.setattr(ocr_fallback, "_engine", ocr_fallback._UNSET)
    calls = []

    class _FakeOcrEngine:
        @staticmethod
        def try_create_from_user_profile_languages():
            calls.append(1)
            return "the-engine"

    monkeypatch.setattr("winsdk.windows.media.ocr.OcrEngine", _FakeOcrEngine)

    assert ocr_fallback._get_engine() == "the-engine"
    assert ocr_fallback._get_engine() == "the-engine"
    assert len(calls) == 1  # second call must reuse the cached engine, not recreate it


def test_get_engine_caches_none_when_no_language_pack_is_available(monkeypatch) -> None:
    monkeypatch.setattr(ocr_fallback, "_engine", ocr_fallback._UNSET)
    calls = []

    class _FakeOcrEngine:
        @staticmethod
        def try_create_from_user_profile_languages():
            calls.append(1)
            return None

    monkeypatch.setattr("winsdk.windows.media.ocr.OcrEngine", _FakeOcrEngine)

    assert ocr_fallback._get_engine() is None
    assert ocr_fallback._get_engine() is None
    assert len(calls) == 1  # a missing language pack is a stable fact, not worth re-checking every call


def test_get_engine_caches_none_when_creation_raises(monkeypatch) -> None:
    monkeypatch.setattr(ocr_fallback, "_engine", ocr_fallback._UNSET)

    class _FakeOcrEngine:
        @staticmethod
        def try_create_from_user_profile_languages():
            raise RuntimeError("winsdk unavailable")

    monkeypatch.setattr("winsdk.windows.media.ocr.OcrEngine", _FakeOcrEngine)

    assert ocr_fallback._get_engine() is None


def test_recognize_returns_empty_string_without_an_engine(monkeypatch) -> None:
    # _get_engine() returning None (no language pack) must short-circuit
    # before ever touching ImageGrab/winsdk's bitmap pipeline.
    monkeypatch.setattr(ocr_fallback, "_get_engine", lambda: None)

    import asyncio
    assert asyncio.run(ocr_fallback._recognize((0, 0, 10, 10))) == ""
