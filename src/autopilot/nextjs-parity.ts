import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { join } from "node:path";

const outcomes = ["not-run", "passed", "failed", "blocked"] as const;
type Outcome = typeof outcomes[number];
export const parityGapCodes = ["agent-ipc", "next-dependencies", "browser-dependencies", "content-omissions", "navigation-approximation", "unverified-components", "media-placeholders", "accessibility-review", "responsive-review"] as const;
export type NextjsParitySummary = {
  status: "blocked" | "awaiting-human-review";
  build: Outcome;
  typecheck: Outcome;
  tests: Outcome;
  accessibility: Outcome;
  screenshots: Outcome;
  gaps: (typeof parityGapCodes[number])[];
};
const baselineFiles = ["source.json", "index.html", "built.index.html", "inventory.json", "mapping.json"] as const;

/** Optional continuation evidence, never a controller transition or execution authorization.
 * Only fixed enums leave the filesystem. Raw prompts, source content and paths stay local.
 */
export async function readNextjsParity(root: string, id: string): Promise<NextjsParitySummary | undefined> {
  try {
    const file = join(root, "nextjs-parity.json");
    const stat = await lstat(file);
    if (!stat.isFile() || stat.size > 100_000) return;
    const value = JSON.parse(await readFile(file, "utf8"));
    if (value.schema !== "nextjs-parity-v1" || value.pilotId !== id || !["blocked", "awaiting-human-review"].includes(value.status)) return;
    for (const key of ["build", "typecheck", "tests", "accessibility", "screenshots"]) {
      if (!outcomes.includes(value.checks?.[key])) return;
    }
    if (!Array.isArray(value.gaps) || value.gaps.length > parityGapCodes.length ||
        new Set(value.gaps).size !== value.gaps.length || value.gaps.some((g: unknown) => !parityGapCodes.includes(g as typeof parityGapCodes[number]))) return;
    // A previous HTML pilot's passing checks cannot qualify a Next.js implementation.
    if (value.status === "awaiting-human-review" &&
        ["build", "typecheck", "tests", "accessibility", "screenshots"].some(k => value.checks[k] !== "passed")) return;
    for (const name of baselineFiles) {
      const baseline = join(root, name);
      const baselineStat = await lstat(baseline);
      if (!baselineStat.isFile() || baselineStat.size > 5_000_000 ||
          !/^[a-f0-9]{64}$/.test(value.baselineDigests?.[name] ?? "")) return;
      const digest = createHash("sha256").update(await readFile(baseline)).digest("hex");
      if (digest !== value.baselineDigests[name]) return;
    }
    return {
      status: value.status,
      build: value.checks.build, typecheck: value.checks.typecheck, tests: value.checks.tests,
      accessibility: value.checks.accessibility, screenshots: value.checks.screenshots,
      gaps: value.gaps
    };
  } catch { /* Missing, malformed or stale continuation evidence must not imply readiness. */ }
}
