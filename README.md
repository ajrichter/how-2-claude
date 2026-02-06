# how-2-claude

Reference repository demonstrating **Claude Code orchestrator/subagent patterns** for multi-agent workflows. Examples in both **TypeScript** and **Python**.

## What's in here

| Path | What it is |
|------|------------|
| `CLAUDE.md` | Project guide loaded into Claude Code's context automatically |
| `docs/orchestrator-subagents.md` | Deep dive on how orchestrators and subagents work |
| `docs/json-key-scanner-example.md` | Concrete example: scanning JSON keys across a codebase |
| `.claude/skills/` | Skill definitions for orchestrator and scanner subagent |
| `examples/orchestrator.ts` | TypeScript orchestrator using the Claude Agent SDK |
| `examples/orchestrator.py` | Python orchestrator using the Claude Agent SDK |
| `examples/sample-data.json` | Sample 40-key JSON config for testing |
| `tests/orchestrator.test.ts` | TypeScript unit tests (vitest) |
| `tests/test_orchestrator.py` | Python unit tests (pytest) |
| `.github/workflows/ci.yml` | CI pipeline: lint, typecheck, test both languages |

## Core Concepts

### Orchestrator + Subagents

Claude Code supports a two-level agent hierarchy:

- **Orchestrator** (main agent): plans work, spawns subagents, merges results
- **Subagents**: isolated workers that process a partition of the problem and return data

Subagents are spawned via the **Task tool**. They run in parallel (up to ~10 concurrent), have their own context windows, and cannot communicate with each other directly. All coordination goes through the orchestrator.

### Skills

Skills are markdown files in `.claude/skills/` with YAML frontmatter. They define reusable agent behaviors and are auto-discovered by Claude Code.

### Concurrency Safety

When multiple subagents produce data for a shared output, the orchestrator is the **sole writer**. Subagents return data, never write to shared files. This prevents race conditions.

## Quick Start

### TypeScript

```bash
npm install
npx tsx examples/orchestrator.ts           # Run the orchestrator
npm run test:ts                            # Run tests
npm run typecheck                          # Type check
```

### Python

```bash
pip install -e ".[dev]"
python examples/orchestrator.py            # Run the orchestrator
pytest tests/test_orchestrator.py -v       # Run tests
ruff check examples/ tests/               # Lint
```

## The JSON Key Scanner Example

Given a large JSON config file, fan out to parallel subagents that each search the codebase for usages of a subset of keys, then merge all findings into a single `output/key-usage.json`.

```
config.json (40 keys)
    │
    ▼
Orchestrator partitions into 8 groups of 5
    │
    ├─→ SubAgent 1 (keys 1-5)   ──→ { "key1": ["file:line"], ... }
    ├─→ SubAgent 2 (keys 6-10)  ──→ { "key6": ["file:line"], ... }
    ├─→ ...
    └─→ SubAgent 8 (keys 36-40) ──→ { "key36": [...], ... }
    │
    ▼
Orchestrator merges all results → output/key-usage.json
```

Both the TypeScript (`examples/orchestrator.ts`) and Python (`examples/orchestrator.py`) implementations follow the same pattern:

1. **Read** the JSON config and extract all keys
2. **Partition** keys into batches of ~5
3. **Fan-out**: spawn one subagent per batch via `query()` / `asyncio.gather()`
4. **Fan-in**: collect results, parse JSON, merge into one dict
5. **Write** the merged output (single writer, concurrency safe)
6. **Report** summary statistics

## CI/CD

GitHub Actions (`.github/workflows/ci.yml`) runs on every push and PR:

| Job | What it does |
|-----|--------------|
| **test-python** | `ruff check` + `ruff format --check` + `mypy` + `pytest` (Python 3.11, 3.12) |
| **test-typescript** | `tsc --noEmit` + `vitest run` (Node 20, 22) |
| **validate-structure** | Checks all required files exist, JSON is valid, skills have frontmatter |

## Testing Strategy

Tests validate the **core pure functions** (chunk, extract_json, merge_results, build_scanner_prompt) without calling the Claude Agent SDK. This means:

- Tests run fast (no API calls, no network)
- No API keys required in CI
- Tests verify the logic that matters: partitioning, JSON extraction from messy LLM output, merging, error handling

### What's tested

| Function | Tests cover |
|----------|-------------|
| `chunk()` | Even/uneven splits, empty input, single chunk, chunk-size-1 |
| `extractJson()` | Plain JSON, markdown fences, surrounding prose, no-JSON, empty obj, multiline |
| `mergeResults()` | Multi-batch merge, sorted output, parse errors, backfill, empty input, dedup |
| `buildScannerPrompt()` | Key inclusion, search dir, exclusions, JSON format request |
| `sample-data.json` | Valid JSON, has keys, partitions correctly |

## Using This in Claude Code

From a Claude Code session in this repo, invoke the orchestrator skill:

```
Scan examples/sample-data.json and find all usages of every key across the codebase.
```

Claude Code reads `CLAUDE.md`, discovers the skills in `.claude/skills/`, and executes the fan-out/fan-in workflow using subagents automatically.
