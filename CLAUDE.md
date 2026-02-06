# CLAUDE.md - Project Guide for Claude Code

This file is automatically loaded into Claude Code's system prompt when working in this repo.

## Project Purpose

`how-2-claude` is a reference repository demonstrating how to use Claude Code's orchestrator/subagent patterns to build multi-agent workflows. The primary use case is a **JSON key scanner** that fans out work to parallel subagents and merges results.

## Repository Structure

```
how-2-claude/
├── CLAUDE.md                          # This file (loaded into Claude's context)
├── README.md                          # Project overview
├── docs/
│   ├── orchestrator-subagents.md      # How orchestrator + subagents work
│   └── json-key-scanner-example.md    # Concrete example: JSON key scanner
├── .claude/
│   └── skills/
│       ├── orchestrate-json-scan.md   # Skill: orchestrate the JSON scan
│       └── scan-json-keys.md          # Skill: scan for key usage (subagent)
├── examples/
│   ├── orchestrator.ts                # TypeScript orchestrator using Agent SDK
│   └── sample-data.json               # Sample JSON for testing
└── .gitignore
```

## Key Concepts

### Skills (`.claude/skills/`)
Skills are markdown files that define reusable agent behaviors. They live in `.claude/skills/` and are auto-discovered by Claude Code. Each skill has YAML frontmatter (name, description, tools) and a body with instructions.

### Subagents (Task tool)
Subagents are spawned via the **Task tool**. The orchestrator (main agent) delegates work to subagents, which run in isolated contexts and return summarized results. Subagents cannot talk to each other directly -- all coordination goes through the orchestrator.

### Orchestrator Pattern
The fan-out/fan-in pattern used here:
1. **Fan-out**: Orchestrator splits work and spawns parallel subagents
2. **Execute**: Each subagent processes its partition independently
3. **Fan-in**: Orchestrator collects results and merges into a single output

### Concurrency Safety
When multiple subagents need to write to a shared output file, the orchestrator must serialize writes. Subagents return data to the orchestrator, and only the orchestrator writes the merged output. This prevents race conditions.

## Commands

```bash
# Install dependencies (for TypeScript examples)
npm install

# Run the orchestrator example
npx tsx examples/orchestrator.ts

# Run tests
npm test
```

## Conventions

- Use TypeScript for all example code
- Skills use markdown with YAML frontmatter
- Documentation lives in `docs/`
- Keep subagent prompts focused and specific -- one task per subagent
- Subagents should return structured data (JSON), not prose
- The orchestrator is the only agent that writes to shared output files
