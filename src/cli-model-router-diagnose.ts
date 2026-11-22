import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { parseMaestriSessionMetadata } from "./integrations/model-discovery.js";
import { readModelRouterConfig } from "./ai/model-router-config.js";
import { maestriTransport } from "./integrations/maestri-central-cli.js";

// Raw terminal output stays in memory; only structure, hashes and model metadata leave.
const [stdoutFile, stderrFile, shellStatus, shellExecutable, agent = "Hermes"] = process.argv.slice(2);
if (!stdoutFile || !stderrFile || !shellExecutable) throw Error("DIAGNOSTIC_ARGUMENTS_REQUIRED");
const config = await readModelRouterConfig();
const summarize = (buffer: Buffer) => {
  const raw = buffer.toString("utf8");
  const lines = raw.trimEnd().split(/\r?\n/);
  const session = parseMaestriSessionMetadata(agent, raw, config);
  return {
    bytes: buffer.length, sha256: createHash("sha256").update(buffer).digest("hex"),
    lines: lines.length, lastLineLength: lines.at(-1)?.length ?? 0,
    ansi: raw.includes("\x1b"), replacementCharacters: raw.includes("\ufffd"),
    permissionDenied: /Operation not permitted|EPERM/.test(raw),
    modelId: session.modelId, profile: session.profile, availability: session.availability,
    diagnostic: session.diagnostic,
    // Locates a footer hidden behind wrappers without disclosing conversation text.
    modelShapedLineDistancesFromEnd: lines.flatMap((line, index) =>
      parseMaestriSessionMetadata(agent, line, config).modelId ? [lines.length - 1 - index] : []).slice(-10),
  };
};
const shellOut = await readFile(stdoutFile);
const shellErr = await readFile(stderrFile);
const executable = process.env.MAESTRI_CLI || "maestri";
const child = spawnSync(executable, ["check", agent], {
  shell: false, stdio: ["ignore", "pipe", "pipe"], timeout: 30000, maxBuffer: 128000,
});
const nodeOut = child.stdout ?? Buffer.alloc(0);
const nodeErr = child.stderr ?? Buffer.alloc(0);
let transport: unknown;
try { transport = summarize(Buffer.from(await maestriTransport()("check", [agent]))); }
catch (error) { transport = { diagnostic: error instanceof Error && /^MAESTRI_[A-Z_]+$/.test(error.message) ? error.message : "DIAGNOSTIC_FAILED" }; }
console.log(JSON.stringify({
  context: {
    inheritedEnvironmentAndCwd: true,
    shellExecutableMatchesOverride: !process.env.MAESTRI_CLI || process.env.MAESTRI_CLI === shellExecutable,
    cliOverridePresent: Boolean(process.env.MAESTRI_CLI),
    nodeStdoutIsTTY: Boolean(process.stdout.isTTY),
    note: "Sequential snapshots can differ. No environment values or terminal text are printed. Shell aliases/functions may differ from PATH executable.",
  },
  shell: { exitCode: Number(shellStatus), stdout: summarize(shellOut), stderr: summarize(shellErr) },
  node: { exitCode: child.status, spawnError: child.error ? "CHILD_PROCESS_FAILED" : null,
    stdout: summarize(nodeOut), stderr: summarize(nodeErr) },
  stdoutEqual: shellOut.equals(nodeOut), stderrEqual: shellErr.equals(nodeErr),
  transport,
}, null, 2));
