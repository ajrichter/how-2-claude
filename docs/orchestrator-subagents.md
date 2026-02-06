# Orchestrator & Subagents: How They Work

## Overview

Claude Code supports a **multi-agent architecture** where a main agent (the orchestrator) delegates work to specialized subagents via the **Task tool**. This enables parallel execution, context isolation, and divide-and-conquer workflows.

## Core Architecture

```
┌─────────────────────────────────┐
│         ORCHESTRATOR            │
│  (main agent / supervisor)      │
│                                 │
│  - Owns the conversation        │
│  - Plans and partitions work    │
│  - Spawns subagents via Task    │
│  - Merges results               │
│  - Writes shared output         │
└──────────┬──────────────────────┘
           │ Task tool (fan-out)
     ┌─────┼─────┐
     │     │     │
     ▼     ▼     ▼
┌────────┐ ┌────────┐ ┌────────┐
│SubAgent│ │SubAgent│ │SubAgent│
│   A    │ │   B    │ │   C    │
│        │ │        │ │        │
│Isolated│ │Isolated│ │Isolated│
│Context │ │Context │ │Context │
└───┬────┘ └───┬────┘ └───┬────┘
    │          │          │
    └──────────┴──────────┘
           │ Results (fan-in)
           ▼
    ┌──────────────┐
    │  Orchestrator │
    │  merges into  │
    │ shared output │
    └──────────────┘
```

## The Task Tool

The Task tool is the mechanism for spawning subagents. When Claude Code's orchestrator calls the Task tool, it:

1. Creates a new agent with its own isolated context window
2. Passes the task prompt and specifies which tools the subagent can use
3. The subagent executes autonomously (reads files, runs commands, etc.)
4. The subagent returns a summarized result to the orchestrator
5. The orchestrator integrates the result into its own context

### Task Tool Parameters

| Parameter | Description |
|-----------|-------------|
| `description` | Short label (3-5 words) for the task |
| `prompt` | Detailed instructions for the subagent |
| `subagent_type` | Agent specialization: `Bash`, `Explore`, `Plan`, `general-purpose` |
| `model` | Optional model override: `sonnet`, `opus`, `haiku` |
| `run_in_background` | Run async, check results later |

### Subagent Types

| Type | Best For | Tools Available |
|------|----------|-----------------|
| `Bash` | Running commands, git ops | Bash only |
| `Explore` | Codebase search, finding files | Read, Glob, Grep, Bash, WebSearch |
| `Plan` | Designing implementation strategies | Read, Glob, Grep, Bash, WebSearch |
| `general-purpose` | Complex multi-step tasks | All tools |

## Key Constraints

### No Inter-Subagent Communication
Subagents cannot talk to each other. All coordination goes through the orchestrator. If SubAgent A discovers something SubAgent B needs, the orchestrator must relay it.

### No Nesting
Subagents cannot spawn their own subagents. The architecture is strictly two-level: orchestrator → subagents.

### Concurrency Limit
Up to ~10 subagents can run concurrently. Additional tasks queue and execute as earlier ones complete.

### Context Isolation
Each subagent has its own context window. It cannot see the orchestrator's conversation history unless explicitly passed in the prompt. This is a feature -- it keeps each agent focused and prevents context pollution.

## Orchestration Patterns

### Pattern 1: Fan-Out / Fan-In (Parallel)

Best for: Independent subtasks that can run simultaneously.

```
Orchestrator:
  1. Partition the problem into N independent chunks
  2. Spawn N subagents in parallel (single message, multiple Task calls)
  3. Collect all N results
  4. Merge results into unified output
```

**Key rule**: Launch all parallel subagents in a **single message** with multiple Task tool calls. This triggers true parallel execution.

### Pattern 2: Sequential Pipeline

Best for: Tasks where each step depends on the previous step's output.

```
Orchestrator:
  1. Spawn SubAgent A → get Result A
  2. Use Result A to construct prompt for SubAgent B
  3. Spawn SubAgent B → get Result B
  4. Use Result B to construct prompt for SubAgent C
  5. ...
```

### Pattern 3: Planner + Workers

Best for: When the problem structure isn't known upfront.

```
Orchestrator:
  1. Spawn a Plan subagent to analyze the problem
  2. Plan subagent returns a work breakdown
  3. Orchestrator spawns worker subagents for each item
  4. Collect and merge worker results
```

### Pattern 4: Iterative Refinement

Best for: Tasks requiring review and correction.

```
Orchestrator:
  1. Spawn worker subagent → get draft result
  2. Spawn reviewer subagent → get feedback
  3. Spawn worker subagent with feedback → get improved result
  4. Repeat until quality threshold met
```

## Concurrency Safety for Shared Output

When multiple subagents produce data that must be merged into a single file:

**WRONG** -- subagents write directly to the same file:
```
SubAgent A → writes output.json  ← RACE CONDITION
SubAgent B → writes output.json  ← DATA LOSS
```

**RIGHT** -- subagents return data, orchestrator merges:
```
SubAgent A → returns JSON fragment A to orchestrator
SubAgent B → returns JSON fragment B to orchestrator
Orchestrator → merges A + B → writes output.json (single writer)
```

The orchestrator is the **sole writer** to any shared resource. Subagents are pure functions: they read inputs and return outputs, never mutating shared state.

## Skills: Reusable Agent Definitions

Skills are markdown files in `.claude/skills/` that define reusable behaviors. They combine:
- **YAML frontmatter**: metadata (name, description, tools)
- **Markdown body**: instructions the agent follows

```markdown
---
name: analyze-component
description: Analyze a React component for performance issues
tools: Read, Grep, Glob
---

You are a React performance analyst. Given a component path:
1. Read the component source
2. Check for missing memoization
3. Look for unnecessary re-renders
4. Return a structured JSON report
```

Skills are auto-discovered from `.claude/skills/` and can be invoked by name or matched automatically based on task description.

## Putting It Together: Orchestrator Prompt Design

A well-designed orchestrator prompt:

1. **States the goal** clearly
2. **Defines the partitioning strategy** (how to split work)
3. **Specifies subagent responsibilities** (what each subagent does)
4. **Describes the merge strategy** (how results combine)
5. **Handles edge cases** (what if a subagent finds nothing? what if there's a conflict?)

Example:

```
You are an orchestrator. Your goal is to scan a large JSON config file
and find all places each key is used across the codebase.

Steps:
1. Read the JSON file and extract all top-level keys
2. Partition keys into groups of ~5
3. For each group, spawn a subagent with these instructions:
   - Search the codebase for all usages of each assigned key
   - Return a JSON object: { "key": ["file:line", ...], ... }
4. Collect all subagent results
5. Merge into a single JSON map and write to output/key-usage.json
6. Report a summary of findings
```

## Further Reading

- [Claude Code Subagents Docs](https://code.claude.com/docs/en/sub-agents.md)
- [Agent SDK Overview](https://platform.claude.com/docs/en/agent-sdk/overview)
- [Skills Guide](https://code.claude.com/docs/en/skills.md)
