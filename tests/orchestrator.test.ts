/**
 * Tests for the TypeScript orchestrator's core logic.
 *
 * These tests validate the pure functions (chunk, buildScannerPrompt, and
 * the merge/extract logic) without calling the Claude Agent SDK.
 *
 * Run with:
 *   npx vitest run tests/orchestrator.test.ts
 */

import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Re-implement core functions here for testing (the orchestrator.ts uses
// top-level await via main(), so we extract the pure logic)
// ---------------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

function buildScannerPrompt(keys: string[], searchDir: string): string {
  return `You are a JSON key scanner. Search the directory "${searchDir}" for all usages of these keys:

${JSON.stringify(keys)}

For each key, use Grep to find files referencing it. Search for:
- String literals: "key" or 'key'
- Property access: .key or ["key"]
- Destructuring: { key } or { key:

Exclude: node_modules, .git, dist, output, build directories.
Exclude the JSON config file itself.

Return ONLY a valid JSON object mapping each key to an array of "file:line" strings.
Example: { "api_url": ["src/config.ts:12"], "db_host": [] }

No markdown fences, no explanation -- just the JSON object.`;
}

function extractJson(text: string): Record<string, string[]> | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return JSON.parse(match[0]);
}

interface SubagentResult {
  index: number;
  batch: string[];
  result: string;
}

function mergeResults(
  subagentResults: SubagentResult[]
): { merged: Record<string, string[]>; parseErrors: number } {
  const merged: Record<string, string[]> = {};
  let parseErrors = 0;

  for (const { index, batch, result } of subagentResults) {
    try {
      const parsed = extractJson(result);
      if (!parsed) throw new Error("No JSON object found in response");

      for (const [key, usages] of Object.entries(parsed)) {
        merged[key] = usages;
      }
    } catch {
      parseErrors++;
      for (const key of batch) {
        if (!(key in merged)) {
          merged[key] = [];
        }
      }
    }
  }

  const sorted = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))
  );

  return { merged: sorted, parseErrors };
}

// ---------------------------------------------------------------------------
// Tests: chunk()
// ---------------------------------------------------------------------------

describe("chunk", () => {
  it("splits evenly", () => {
    expect(chunk(["a", "b", "c", "d"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles uneven splits", () => {
    expect(chunk(["a", "b", "c", "d", "e"], 2)).toEqual([
      ["a", "b"],
      ["c", "d"],
      ["e"],
    ]);
  });

  it("returns single chunk when size > length", () => {
    expect(chunk(["a", "b"], 10)).toEqual([["a", "b"]]);
  });

  it("handles empty array", () => {
    expect(chunk([], 5)).toEqual([]);
  });

  it("handles chunk size of 1", () => {
    expect(chunk(["a", "b", "c"], 1)).toEqual([["a"], ["b"], ["c"]]);
  });
});

// ---------------------------------------------------------------------------
// Tests: extractJson()
// ---------------------------------------------------------------------------

describe("extractJson", () => {
  it("extracts plain JSON", () => {
    const text = '{"api_url": ["src/config.ts:12"], "db_host": []}';
    expect(extractJson(text)).toEqual({
      api_url: ["src/config.ts:12"],
      db_host: [],
    });
  });

  it("extracts JSON from markdown fences", () => {
    const text = '```json\n{"key": ["file:1"]}\n```';
    expect(extractJson(text)).toEqual({ key: ["file:1"] });
  });

  it("extracts JSON surrounded by prose", () => {
    const text = 'Here are results:\n{"a": ["x:1"]}\nDone.';
    expect(extractJson(text)).toEqual({ a: ["x:1"] });
  });

  it("returns null when no JSON found", () => {
    expect(extractJson("No JSON here")).toBeNull();
  });

  it("handles empty object", () => {
    expect(extractJson("{}")).toEqual({});
  });

  it("handles multiline JSON", () => {
    const text = `{
  "api_url": [
    "src/config.ts:12",
    "src/server.ts:45"
  ],
  "db_host": []
}`;
    const result = extractJson(text);
    expect(result).not.toBeNull();
    expect(result!["api_url"]).toHaveLength(2);
    expect(result!["db_host"]).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Tests: mergeResults()
// ---------------------------------------------------------------------------

describe("mergeResults", () => {
  it("merges multiple valid results", () => {
    const { merged, parseErrors } = mergeResults([
      { index: 0, batch: ["a", "b"], result: '{"a": ["f:1"], "b": []}' },
      { index: 1, batch: ["c"], result: '{"c": ["g:2", "h:3"]}' },
    ]);
    expect(parseErrors).toBe(0);
    expect(merged).toEqual({ a: ["f:1"], b: [], c: ["g:2", "h:3"] });
  });

  it("sorts keys alphabetically", () => {
    const { merged } = mergeResults([
      { index: 0, batch: ["z", "a"], result: '{"z": [], "a": []}' },
    ]);
    expect(Object.keys(merged)).toEqual(["a", "z"]);
  });

  it("backfills keys on parse error", () => {
    const { merged, parseErrors } = mergeResults([
      { index: 0, batch: ["x", "y"], result: "Not JSON" },
    ]);
    expect(parseErrors).toBe(1);
    expect(merged).toEqual({ x: [], y: [] });
  });

  it("handles mix of valid and invalid", () => {
    const { merged, parseErrors } = mergeResults([
      { index: 0, batch: ["a"], result: '{"a": ["f:1"]}' },
      { index: 1, batch: ["b"], result: "garbage" },
    ]);
    expect(parseErrors).toBe(1);
    expect(merged["a"]).toEqual(["f:1"]);
    expect(merged["b"]).toEqual([]);
  });

  it("handles empty results array", () => {
    const { merged, parseErrors } = mergeResults([]);
    expect(merged).toEqual({});
    expect(parseErrors).toBe(0);
  });

  it("later result overwrites earlier for same key", () => {
    const { merged } = mergeResults([
      { index: 0, batch: ["a"], result: '{"a": ["old:1"]}' },
      { index: 1, batch: ["a"], result: '{"a": ["new:2"]}' },
    ]);
    expect(merged["a"]).toEqual(["new:2"]);
  });
});

// ---------------------------------------------------------------------------
// Tests: buildScannerPrompt()
// ---------------------------------------------------------------------------

describe("buildScannerPrompt", () => {
  it("includes all keys", () => {
    const prompt = buildScannerPrompt(["api_url", "db_host", "db_port"], ".");
    expect(prompt).toContain("api_url");
    expect(prompt).toContain("db_host");
    expect(prompt).toContain("db_port");
  });

  it("includes the search directory", () => {
    const prompt = buildScannerPrompt(["key"], "/some/dir");
    expect(prompt).toContain("/some/dir");
  });

  it("mentions exclusion directories", () => {
    const prompt = buildScannerPrompt(["key"], ".");
    expect(prompt).toContain("node_modules");
    expect(prompt).toContain(".git");
    expect(prompt).toContain("output");
  });

  it("requests JSON output", () => {
    const prompt = buildScannerPrompt(["key"], ".");
    expect(prompt).toContain("JSON");
  });

  it("encodes keys as JSON array", () => {
    const prompt = buildScannerPrompt(["a", "b", "c"], ".");
    expect(prompt).toContain('["a","b","c"]');
  });
});

// ---------------------------------------------------------------------------
// Tests: sample-data.json integrity
// ---------------------------------------------------------------------------

describe("sample-data.json", () => {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const samplePath = path.join(__dirname, "..", "examples", "sample-data.json");

  it("is valid JSON", () => {
    const raw = fs.readFileSync(samplePath, "utf-8");
    const data = JSON.parse(raw);
    expect(typeof data).toBe("object");
    expect(data).not.toBeNull();
  });

  it("has keys", () => {
    const raw = fs.readFileSync(samplePath, "utf-8");
    const data = JSON.parse(raw);
    expect(Object.keys(data).length).toBeGreaterThan(0);
  });

  it("partitions correctly with chunk()", () => {
    const raw = fs.readFileSync(samplePath, "utf-8");
    const data = JSON.parse(raw);
    const keys = Object.keys(data);
    const batches = chunk(keys, 5);

    // All keys accounted for
    const flattened = batches.flat();
    expect(flattened).toEqual(keys);

    // No batch exceeds batch size
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(5);
      expect(batch.length).toBeGreaterThan(0);
    }
  });
});
