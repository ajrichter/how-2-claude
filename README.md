# how-2-claude

Reference repository demonstrating **Claude Code orchestrator/subagent patterns** for multi-agent workflows.

## What's in here

| Path | What it is |
|------|------------|
| `CLAUDE.md` | Project guide loaded into Claude Code's context automatically |
| `docs/orchestrator-subagents.md` | Deep dive on how orchestrators and subagents work |
| `docs/json-key-scanner-example.md` | Concrete example: scanning JSON keys across a codebase |
| `.claude/skills/orchestrate-json-scan.md` | Skill definition for the orchestrator agent |
| `.claude/skills/scan-json-keys.md` | Skill definition for the scanner subagent |
| `examples/orchestrator.ts` | TypeScript orchestrator using the Claude Agent SDK |
| `examples/sample-data.json` | Sample JSON config for testing |

## Core Concepts

### Orchestrator + Subagents

Claude Code supports a two-level agent hierarchy:

- **Orchestrator** (main agent): plans work, spawns subagents, merges results
- **Subagents**: isolated workers that process a partition of the problem and return data

Subagents are spawned via the **Task tool**. They run in parallel (up to ~10 concurrent), have their own context windows, and cannot communicate with each other directly. All coordination goes through the orchestrator.

### Skills

Skills are markdown files in `.claude/skills/` with YAML frontmatter. They define reusable agent behaviors and are auto-discovered by Claude Code.

### Concurrency Safety

When multiple subagents produce data for a shared output, the orchestrator is the **sole writer**. Subagents return data, never write to shared files.

## Quick Start

```bash
# Read the architecture docs
cat docs/orchestrator-subagents.md

# Look at the example workflow
cat docs/json-key-scanner-example.md

# Run the orchestrator (requires Agent SDK)
npm install
npx tsx examples/orchestrator.ts
```

## The JSON Key Scanner Example

The primary use case demonstrated here: given a large JSON config file, fan out to parallel subagents that each search the codebase for usages of a subset of keys, then merge all findings into a single `output/key-usage.json`.

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

## Using This in Claude Code

From a Claude Code session in this repo, you can invoke the orchestrator skill directly:

```
Scan examples/sample-data.json and find all usages of every key across the codebase.
```

Claude Code will read the CLAUDE.md, discover the skills in `.claude/skills/`, and execute the fan-out/fan-in workflow using subagents.
