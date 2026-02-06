# Example: JSON Key Scanner with Orchestrator + Subagents

## Problem Statement

You have a large JSON configuration file with many keys. You need to find everywhere each key is referenced across the codebase, then produce a unified report. Doing this sequentially is slow and context-heavy. Instead, we fan the work out to parallel subagents.

## Workflow

```
                    ┌───────────────────┐
                    │   config.json     │
                    │  (100+ keys)      │
                    └────────┬──────────┘
                             │
                    ┌────────▼──────────┐
                    │   ORCHESTRATOR    │
                    │                   │
                    │ 1. Read config    │
                    │ 2. Extract keys   │
                    │ 3. Partition into │
                    │    groups of ~5   │
                    └────────┬──────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼───┐  ┌──────▼─────┐  ┌────▼────────┐
     │ SubAgent 1 │  │ SubAgent 2 │  │ SubAgent N  │
     │            │  │            │  │             │
     │ Keys:      │  │ Keys:      │  │ Keys:       │
     │ - api_url  │  │ - theme    │  │ - timeout   │
     │ - db_host  │  │ - locale   │  │ - retry_max │
     │ - db_port  │  │ - currency │  │ - log_level │
     │ - db_name  │  │ - timezone │  │ - debug     │
     │ - db_user  │  │ - date_fmt │  │ - verbose   │
     │            │  │            │  │             │
     │ Search for │  │ Search for │  │ Search for  │
     │ each key   │  │ each key   │  │ each key    │
     │ in codebase│  │ in codebase│  │ in codebase │
     └─────┬──────┘  └─────┬──────┘  └──────┬──────┘
           │               │                │
           │  JSON result  │  JSON result   │  JSON result
           └───────────────┼────────────────┘
                           │
                  ┌────────▼──────────┐
                  │   ORCHESTRATOR    │
                  │                   │
                  │ 4. Collect all    │
                  │    results        │
                  │ 5. Merge into     │
                  │    single map     │
                  │ 6. Write output   │
                  │ 7. Report summary │
                  └───────────────────┘
                           │
                  ┌────────▼──────────┐
                  │  key-usage.json   │
                  │                   │
                  │ {                 │
                  │   "api_url": [    │
                  │     "src/a.ts:12",│
                  │     "src/b.ts:45" │
                  │   ],              │
                  │   "db_host": [    │
                  │     "src/c.ts:8"  │
                  │   ],              │
                  │   ...             │
                  │ }                 │
                  └───────────────────┘
```

## Why This Pattern?

| Concern | Solution |
|---------|----------|
| **Speed** | N subagents search in parallel instead of 1 agent searching sequentially |
| **Context limits** | Each subagent only holds results for its ~5 keys, not all 100+ |
| **Concurrency safety** | Only the orchestrator writes to `key-usage.json` |
| **Reliability** | If one subagent fails, others still complete; orchestrator can retry the failed group |

## Concurrency Safety: Why the Orchestrator Must Merge

If subagents wrote directly to `key-usage.json`:

1. SubAgent A reads the file, sees `{}`
2. SubAgent B reads the file, sees `{}`
3. SubAgent A writes `{ "api_url": [...] }`
4. SubAgent B writes `{ "theme": [...] }` -- **overwrites SubAgent A's data**

Instead, subagents return their results as data. The orchestrator holds all results in memory, merges them with `Object.assign()` or spread syntax, and performs a single atomic write.

## Step-by-Step Implementation

### Step 1: Create the Orchestrator Skill

File: `.claude/skills/orchestrate-json-scan.md`

This skill tells Claude how to act as the orchestrator. It reads the JSON, partitions keys, spawns subagents, and merges results.

### Step 2: Create the Scanner Skill

File: `.claude/skills/scan-json-keys.md`

This skill tells a subagent how to search for key usages and return structured results.

### Step 3: Invoke the Orchestrator

From Claude Code, simply describe what you want:

```
Scan config.json and find all usages of every key across the codebase.
Use the orchestrate-json-scan skill.
```

Or invoke it as a slash command if configured.

### Step 4: The Orchestrator Executes

1. Reads `config.json`, extracts keys
2. Groups keys into batches of ~5
3. Spawns one `general-purpose` subagent per batch, all in a single message (parallel)
4. Each subagent uses Grep/Glob to search, returns JSON
5. Orchestrator collects all returned JSON fragments
6. Merges fragments: `{ ...resultA, ...resultB, ...resultC }`
7. Writes merged result to `output/key-usage.json`
8. Prints summary to the user

## Adapting This Pattern

This same fan-out/fan-in pattern works for:

- **Dead code detection**: Subagents check if different groups of exports are imported anywhere
- **Migration audits**: Subagents scan for usage of deprecated APIs
- **Dependency analysis**: Subagents trace import chains for different modules
- **Test coverage gaps**: Subagents check which functions in different modules lack tests
- **i18n key validation**: Subagents verify translation keys are used in templates

The key insight: any problem where you can **partition the input**, **process partitions independently**, and **merge outputs deterministically** is a candidate for this pattern.
