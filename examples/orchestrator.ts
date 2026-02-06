/**
 * orchestrator.ts
 *
 * Demonstrates the fan-out/fan-in orchestrator pattern using the Claude Agent SDK.
 * This script reads a JSON config, partitions its keys, spawns parallel subagents
 * to search for key usage, and merges results into a single output file.
 *
 * Usage:
 *   npx tsx examples/orchestrator.ts [path-to-json] [search-directory]
 *
 * Requirements:
 *   npm install @anthropic-ai/claude-agent-sdk
 */

import { query, type MessageStream } from "@anthropic-ai/claude-agent-sdk";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DEFAULT_JSON_PATH = "examples/sample-data.json";
const DEFAULT_SEARCH_DIR = ".";
const BATCH_SIZE = 5; // keys per subagent
const OUTPUT_PATH = "output/key-usage.json";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Partition an array into chunks of `size` */
function chunk<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

/** Build the prompt for a scanner subagent */
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

// ---------------------------------------------------------------------------
// Main orchestrator
// ---------------------------------------------------------------------------

async function main() {
  const jsonPath = process.argv[2] || DEFAULT_JSON_PATH;
  const searchDir = process.argv[3] || DEFAULT_SEARCH_DIR;

  // Phase 1: Read and extract keys
  console.log(`[orchestrator] Reading ${jsonPath}...`);
  const rawJson = fs.readFileSync(jsonPath, "utf-8");
  const config = JSON.parse(rawJson);
  const allKeys = Object.keys(config);
  console.log(`[orchestrator] Found ${allKeys.length} top-level keys`);

  // Phase 2: Partition keys into batches
  const batches = chunk(allKeys, BATCH_SIZE);
  console.log(
    `[orchestrator] Split into ${batches.length} batches of ~${BATCH_SIZE}`
  );

  // Phase 3: Fan-out -- spawn parallel subagents
  console.log(`[orchestrator] Spawning ${batches.length} scanner subagents...`);

  const subagentPromises = batches.map(async (batch, index) => {
    console.log(
      `[orchestrator] SubAgent ${index + 1}: keys ${JSON.stringify(batch)}`
    );

    const prompt = buildScannerPrompt(batch, searchDir);

    // Each call to query() creates an independent subagent
    const stream: MessageStream = query({
      prompt,
      options: {
        maxTurns: 10,
        systemPrompt:
          "You are a code scanner. Return only JSON. No prose, no markdown.",
      },
    });

    // Collect the subagent's final text output
    let result = "";
    for await (const event of stream) {
      if (event.type === "assistant" && event.message?.content) {
        for (const block of event.message.content) {
          if (block.type === "text") {
            result += block.text;
          }
        }
      }
    }

    return { index, batch, result };
  });

  const subagentResults = await Promise.all(subagentPromises);

  // Phase 4: Fan-in -- merge results
  console.log(`[orchestrator] All subagents complete. Merging results...`);

  const merged: Record<string, string[]> = {};
  let parseErrors = 0;

  for (const { index, batch, result } of subagentResults) {
    try {
      // Extract JSON from the response (handle possible markdown fences)
      const jsonMatch = result.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON object found in response");

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, string[]>;

      for (const [key, usages] of Object.entries(parsed)) {
        merged[key] = usages;
      }

      console.log(
        `[orchestrator] SubAgent ${index + 1}: parsed ${Object.keys(parsed).length} keys`
      );
    } catch (err) {
      parseErrors++;
      console.error(
        `[orchestrator] SubAgent ${index + 1} returned unparseable result:`,
        (err as Error).message
      );
      // Fill in the batch keys with empty arrays so we don't lose track
      for (const key of batch) {
        if (!(key in merged)) {
          merged[key] = [];
        }
      }
    }
  }

  // Sort keys alphabetically
  const sorted = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b))
  );

  // Phase 5: Write output (single writer -- concurrency safe)
  const outputDir = path.dirname(OUTPUT_PATH);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(sorted, null, 2));
  console.log(`[orchestrator] Wrote results to ${OUTPUT_PATH}`);

  // Phase 6: Summary
  const totalKeys = Object.keys(sorted).length;
  const keysWithUsages = Object.values(sorted).filter(
    (v) => v.length > 0
  ).length;
  const keysWithout = totalKeys - keysWithUsages;
  const totalRefs = Object.values(sorted).reduce(
    (sum, v) => sum + v.length,
    0
  );

  console.log(`\n--- Summary ---`);
  console.log(`Total keys scanned:    ${totalKeys}`);
  console.log(`Keys with usages:      ${keysWithUsages}`);
  console.log(`Keys with NO usages:   ${keysWithout} (potential dead config)`);
  console.log(`Total references:      ${totalRefs}`);
  if (parseErrors > 0) {
    console.log(`Parse errors:          ${parseErrors}`);
  }
}

main().catch((err) => {
  console.error("[orchestrator] Fatal error:", err);
  process.exit(1);
});
