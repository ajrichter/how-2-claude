"""
orchestrator.py

Demonstrates the fan-out/fan-in orchestrator pattern using the
Claude Agent SDK (Python). Reads a JSON config, partitions its keys,
spawns parallel subagents to search for key usage, and merges results
into a single output file.

Usage:
    python examples/orchestrator.py [path-to-json] [search-directory]

Requirements:
    pip install claude-agent-sdk
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

DEFAULT_JSON_PATH = "examples/sample-data.json"
DEFAULT_SEARCH_DIR = "."
BATCH_SIZE = 5  # keys per subagent
OUTPUT_PATH = "output/key-usage.json"

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def chunk(items: list[str], size: int) -> list[list[str]]:
    """Partition a list into chunks of `size`."""
    return [items[i : i + size] for i in range(0, len(items), size)]


def build_scanner_prompt(keys: list[str], search_dir: str) -> str:
    """Build the prompt for a scanner subagent."""
    keys_json = json.dumps(keys)
    return f"""You are a JSON key scanner. Search the directory \
"{search_dir}" for all usages of these keys:

{keys_json}

For each key, use Grep to find files referencing it. Search for:
- String literals: "key" or 'key'
- Property access: .key or ["key"]
- Destructuring: {{ key }} or {{ key:

Exclude: node_modules, .git, dist, output, build directories.
Exclude the JSON config file itself.

Return ONLY a valid JSON object mapping each key to an array of "file:line" strings.
Example: {{ "api_url": ["src/config.ts:12"], "db_host": [] }}

No markdown fences, no explanation -- just the JSON object."""


def extract_json(text: str) -> dict[str, list[str]] | None:
    """Extract the first JSON object from a string, handling markdown fences."""
    match = re.search(r"\{[\s\S]*\}", text)
    if not match:
        return None
    return json.loads(match.group(0))


def merge_results(
    subagent_results: list[dict[str, Any]],
) -> tuple[dict[str, list[str]], int]:
    """Merge all subagent result dicts into one sorted dict.

    Returns (merged_dict, parse_error_count).
    """
    merged: dict[str, list[str]] = {}
    parse_errors = 0

    for entry in subagent_results:
        index = entry["index"]
        batch = entry["batch"]
        raw_result = entry["result"]

        try:
            parsed = extract_json(raw_result)
            if parsed is None:
                raise ValueError("No JSON object found in response")

            for key, usages in parsed.items():
                merged[key] = usages

            print(f"[orchestrator] SubAgent {index + 1}: parsed {len(parsed)} keys")
        except (json.JSONDecodeError, ValueError) as err:
            parse_errors += 1
            print(
                f"[orchestrator] SubAgent {index + 1} "
                f"returned unparseable result: {err}"
            )
            # Backfill keys with empty arrays
            for key in batch:
                if key not in merged:
                    merged[key] = []

    sorted_merged = dict(sorted(merged.items()))
    return sorted_merged, parse_errors


# ---------------------------------------------------------------------------
# Subagent runner
# ---------------------------------------------------------------------------


async def run_subagent(batch: list[str], index: int, search_dir: str) -> dict[str, Any]:
    """Spawn a single scanner subagent and collect its result."""
    # Defer import so pure helpers can be used without the SDK installed
    from claude_agent_sdk import query

    print(f"[orchestrator] SubAgent {index + 1}: keys {json.dumps(batch)}")

    prompt = build_scanner_prompt(batch, search_dir)
    result_text = ""

    # query() returns an async iterator of events
    async for event in query(
        prompt=prompt,
        options={
            "max_turns": 10,
            "system_prompt": (
                "You are a code scanner. Return only JSON. No prose, no markdown."
            ),
        },
    ):
        if event.type == "assistant" and event.message and event.message.content:
            for block in event.message.content:
                if block.type == "text":
                    result_text += block.text

    return {"index": index, "batch": batch, "result": result_text}


# ---------------------------------------------------------------------------
# Main orchestrator
# ---------------------------------------------------------------------------


async def orchestrate(json_path: str, search_dir: str) -> dict[str, list[str]]:
    """Run the full fan-out/fan-in orchestration pipeline.

    Returns the merged key-usage dict.
    """
    # Phase 1: Read and extract keys
    print(f"[orchestrator] Reading {json_path}...")
    raw_json = Path(json_path).read_text()
    config = json.loads(raw_json)
    all_keys = list(config.keys())
    print(f"[orchestrator] Found {len(all_keys)} top-level keys")

    # Phase 2: Partition keys into batches
    batches = chunk(all_keys, BATCH_SIZE)
    print(f"[orchestrator] Split into {len(batches)} batches of ~{BATCH_SIZE}")

    # Phase 3: Fan-out -- spawn parallel subagents
    print(f"[orchestrator] Spawning {len(batches)} scanner subagents...")

    tasks = [
        run_subagent(batch, index, search_dir) for index, batch in enumerate(batches)
    ]
    subagent_results = await asyncio.gather(*tasks)

    # Phase 4: Fan-in -- merge results
    print("[orchestrator] All subagents complete. Merging results...")
    merged, parse_errors = merge_results(list(subagent_results))

    # Phase 5: Write output (single writer -- concurrency safe)
    output_dir = os.path.dirname(OUTPUT_PATH)
    if output_dir:
        os.makedirs(output_dir, exist_ok=True)

    Path(OUTPUT_PATH).write_text(json.dumps(merged, indent=2))
    print(f"[orchestrator] Wrote results to {OUTPUT_PATH}")

    # Phase 6: Summary
    total_keys = len(merged)
    keys_with_usages = sum(1 for v in merged.values() if v)
    keys_without = total_keys - keys_with_usages
    total_refs = sum(len(v) for v in merged.values())

    print("\n--- Summary ---")
    print(f"Total keys scanned:    {total_keys}")
    print(f"Keys with usages:      {keys_with_usages}")
    print(f"Keys with NO usages:   {keys_without} (potential dead config)")
    print(f"Total references:      {total_refs}")
    if parse_errors > 0:
        print(f"Parse errors:          {parse_errors}")

    return merged


def main() -> None:
    json_path = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_JSON_PATH
    search_dir = sys.argv[2] if len(sys.argv) > 2 else DEFAULT_SEARCH_DIR
    asyncio.run(orchestrate(json_path, search_dir))


if __name__ == "__main__":
    main()
