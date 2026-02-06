"""
Tests for the orchestrator's core logic.

These tests validate the pure functions (chunk, extract_json, merge_results,
build_scanner_prompt) without calling the Claude Agent SDK, so they run
fast and require no API keys.

Run with:
    pytest tests/test_orchestrator.py -v
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Add project root to path so we can import the orchestrator module
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "examples"))

from orchestrator import (  # noqa: E402
    BATCH_SIZE,
    build_scanner_prompt,
    chunk,
    extract_json,
    merge_results,
)


# ---------------------------------------------------------------------------
# chunk()
# ---------------------------------------------------------------------------


class TestChunk:
    def test_even_split(self) -> None:
        result = chunk(["a", "b", "c", "d"], 2)
        assert result == [["a", "b"], ["c", "d"]]

    def test_uneven_split(self) -> None:
        result = chunk(["a", "b", "c", "d", "e"], 2)
        assert result == [["a", "b"], ["c", "d"], ["e"]]

    def test_single_chunk(self) -> None:
        result = chunk(["a", "b"], 10)
        assert result == [["a", "b"]]

    def test_empty_input(self) -> None:
        result = chunk([], 5)
        assert result == []

    def test_chunk_size_one(self) -> None:
        result = chunk(["a", "b", "c"], 1)
        assert result == [["a"], ["b"], ["c"]]

    def test_default_batch_size(self) -> None:
        """Ensure BATCH_SIZE constant is a reasonable value."""
        assert BATCH_SIZE > 0
        assert BATCH_SIZE <= 20


# ---------------------------------------------------------------------------
# extract_json()
# ---------------------------------------------------------------------------


class TestExtractJson:
    def test_plain_json(self) -> None:
        text = '{"api_url": ["src/config.ts:12"], "db_host": []}'
        result = extract_json(text)
        assert result == {"api_url": ["src/config.ts:12"], "db_host": []}

    def test_json_with_markdown_fences(self) -> None:
        text = '```json\n{"key": ["file:1"]}\n```'
        result = extract_json(text)
        assert result == {"key": ["file:1"]}

    def test_json_with_surrounding_prose(self) -> None:
        text = 'Here are the results:\n{"a": ["x:1"]}\nDone.'
        result = extract_json(text)
        assert result == {"a": ["x:1"]}

    def test_no_json_returns_none(self) -> None:
        text = "No JSON here at all"
        result = extract_json(text)
        assert result is None

    def test_empty_object(self) -> None:
        text = "{}"
        result = extract_json(text)
        assert result == {}

    def test_nested_json(self) -> None:
        text = '{"a": ["file:1"], "b": ["file:2", "file:3"]}'
        result = extract_json(text)
        assert result == {"a": ["file:1"], "b": ["file:2", "file:3"]}

    def test_multiline_json(self) -> None:
        text = """{
  "api_url": [
    "src/config.ts:12",
    "src/server.ts:45"
  ],
  "db_host": []
}"""
        result = extract_json(text)
        assert result is not None
        assert len(result["api_url"]) == 2
        assert result["db_host"] == []


# ---------------------------------------------------------------------------
# merge_results()
# ---------------------------------------------------------------------------


class TestMergeResults:
    def test_basic_merge(self) -> None:
        results = [
            {
                "index": 0,
                "batch": ["a", "b"],
                "result": '{"a": ["f:1"], "b": []}',
            },
            {
                "index": 1,
                "batch": ["c"],
                "result": '{"c": ["g:2", "h:3"]}',
            },
        ]
        merged, errors = merge_results(results)
        assert errors == 0
        assert merged == {"a": ["f:1"], "b": [], "c": ["g:2", "h:3"]}

    def test_sorted_output(self) -> None:
        results = [
            {"index": 0, "batch": ["z", "a"], "result": '{"z": [], "a": []}'},
        ]
        merged, errors = merge_results(results)
        keys = list(merged.keys())
        assert keys == ["a", "z"]

    def test_unparseable_result_backfills_keys(self) -> None:
        results = [
            {
                "index": 0,
                "batch": ["x", "y"],
                "result": "This is not JSON at all",
            },
        ]
        merged, errors = merge_results(results)
        assert errors == 1
        assert merged == {"x": [], "y": []}

    def test_mixed_valid_and_invalid(self) -> None:
        results = [
            {
                "index": 0,
                "batch": ["a"],
                "result": '{"a": ["f:1"]}',
            },
            {
                "index": 1,
                "batch": ["b"],
                "result": "garbage",
            },
        ]
        merged, errors = merge_results(results)
        assert errors == 1
        assert merged["a"] == ["f:1"]
        assert merged["b"] == []

    def test_empty_results(self) -> None:
        merged, errors = merge_results([])
        assert merged == {}
        assert errors == 0

    def test_all_empty_arrays(self) -> None:
        results = [
            {
                "index": 0,
                "batch": ["a", "b", "c"],
                "result": '{"a": [], "b": [], "c": []}',
            },
        ]
        merged, errors = merge_results(results)
        assert errors == 0
        assert all(v == [] for v in merged.values())

    def test_duplicate_key_across_batches_last_wins(self) -> None:
        """If a key appears in multiple subagent results, later one wins."""
        results = [
            {
                "index": 0,
                "batch": ["a"],
                "result": '{"a": ["old:1"]}',
            },
            {
                "index": 1,
                "batch": ["a"],
                "result": '{"a": ["new:2"]}',
            },
        ]
        merged, errors = merge_results(results)
        assert errors == 0
        assert merged["a"] == ["new:2"]


# ---------------------------------------------------------------------------
# build_scanner_prompt()
# ---------------------------------------------------------------------------


class TestBuildScannerPrompt:
    def test_contains_all_keys(self) -> None:
        keys = ["api_url", "db_host", "db_port"]
        prompt = build_scanner_prompt(keys, ".")
        for key in keys:
            assert key in prompt

    def test_contains_search_dir(self) -> None:
        prompt = build_scanner_prompt(["key"], "/some/dir")
        assert "/some/dir" in prompt

    def test_contains_exclusion_dirs(self) -> None:
        prompt = build_scanner_prompt(["key"], ".")
        assert "node_modules" in prompt
        assert ".git" in prompt
        assert "output" in prompt

    def test_requests_json_output(self) -> None:
        prompt = build_scanner_prompt(["key"], ".")
        assert "JSON" in prompt

    def test_keys_as_json_array(self) -> None:
        keys = ["a", "b", "c"]
        prompt = build_scanner_prompt(keys, ".")
        # The keys should appear as a JSON array in the prompt
        assert '["a", "b", "c"]' in prompt


# ---------------------------------------------------------------------------
# Integration: sample-data.json loads correctly
# ---------------------------------------------------------------------------


class TestSampleData:
    def test_sample_data_is_valid_json(self) -> None:
        sample_path = (
            Path(__file__).resolve().parent.parent / "examples" / "sample-data.json"
        )
        data = json.loads(sample_path.read_text())
        assert isinstance(data, dict)

    def test_sample_data_has_keys(self) -> None:
        sample_path = (
            Path(__file__).resolve().parent.parent / "examples" / "sample-data.json"
        )
        data = json.loads(sample_path.read_text())
        assert len(data) > 0

    def test_sample_data_keys_partition_correctly(self) -> None:
        sample_path = (
            Path(__file__).resolve().parent.parent / "examples" / "sample-data.json"
        )
        data = json.loads(sample_path.read_text())
        keys = list(data.keys())
        batches = chunk(keys, BATCH_SIZE)

        # All keys accounted for
        flattened = [k for batch in batches for k in batch]
        assert flattened == keys

        # No batch exceeds BATCH_SIZE
        for batch in batches:
            assert len(batch) <= BATCH_SIZE

        # Last batch may be smaller, but not empty
        for batch in batches:
            assert len(batch) > 0
