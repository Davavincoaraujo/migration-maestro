import { realpath, stat, writeFile, mkdir } from "node:fs/promises";
import { join, relative, sep, isAbsolute, resolve } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { verifyBoundComponent } from "./component-binding-resolver.js";
import type { UePatternConfig } from "./local-ue-pattern.js";
import type { TaskPacket } from "./autopilot-task-packet.js";
export interface Handoff { status: "prepared"; executionAuthorized: false; requiresHumanReview: true; task: TaskPacket["task"]; }
export function validateHandoffTask(value: unknown): TaskPacket {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_TASK_PACKET");
  const packet = value as TaskPacket;
  if (packet.schemaVersion !== 1 || packet.status !== "review_required" ||
    !["adapt_component", "review_reuse", "investigate"].includes(packet.task) ||
    packet.execution?.authorized !== false || packet.execution?.repositoryWrite !== false ||
    packet.execution?.publish !== false || packet.execution?.humanApprovalRequired !== true) throw new Error("INVALID_TASK_PACKET");
  return packet;
}
function inside(root: string, target: string): boolean {
  const rel = relative(root, target);
  return rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
}
async function gitStatus(project: string): Promise<string> {
  return new Promise((done, fail) => {
    const child = spawn("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: project, shell: false, stdio: ["ignore", "pipe", "ignore"] });
    let output = ""; let length = 0;
    const timer = setTimeout(() => { child.kill(); fail(new Error("GIT_TIMEOUT")); }, 8000);
    child.stdout.on("data", (chunk: Buffer) => {
      length += chunk.length;
      if (length > 10000) { child.kill(); fail(new Error("GIT_OUTPUT_LIMIT")); }
      else output += chunk.toString();
    });
    child.on("error", () => { clearTimeout(timer); fail(new Error("GIT_UNAVAILABLE")); });
    child.on("close", code => { clearTimeout(timer); if (code === 0) done(output); else fail(new Error("GIT_STATUS_FAILED")); });
  });
}
/** Prepare a local, non-executable handoff. Never invoke Claude, edit corporate code or publish. */
export async function prepareLocalHandoff(config: UePatternConfig, componentPath: string, packetValue: unknown, outputDir: string): Promise<Handoff> {
  const packet = validateHandoffTask(packetValue);
  if (packet.task === "investigate") throw new Error("TASK_NOT_READY");
  if (!(await verifyBoundComponent(config, componentPath))) throw new Error("COMPONENT_NOT_VERIFIED");
  const project = await realpath(config.projectDirectory);
  if (!(await stat(project)).isDirectory()) throw new Error("PROJECT_UNAVAILABLE");
  const status = await gitStatus(project);
  if (status.trim()) throw new Error("PROJECT_HAS_CHANGES");
  const localDir = resolve(outputDir);
  const workspace = await realpath(resolve("./local-output")).catch(() => null);
  if (!workspace || !inside(workspace, localDir)) throw new Error("INVALID_OUTPUT_DIRECTORY");
  await mkdir(localDir, { recursive: true, mode: 0o700 });
  const safePath = componentPath.replaceAll("/", "_");
  const hash = createHash("sha256").update(componentPath + ":" + packet.task).digest("hex").slice(0, 12);
  const filename = join(localDir, "handoff-" + safePath + "-" + hash + ".md");
  const markdown = [
    "# Local review-only implementation handoff",
    "",
    "Task: " + packet.task,
    "Component: " + componentPath,
    "",
    "No permission to modify files, run autonomous agents, publish or open PRs.",
    "Human must verify that the catalog candidate actually corresponds to this component.",
    "",
    "## Steps",
    ...packet.steps.map(step => "- " + step),
    "",
    "## Checks",
    ...packet.checks.map(check => "- " + check),
    "",
    "## Required decision",
    "Review the intended diff and obtain explicit corporate authorization before any repository write.",
    "",
  ].join("\n");
  await writeFile(filename, markdown, { flag: "wx", mode: 0o600 });
  return { status: "prepared", executionAuthorized: false, requiresHumanReview: true, task: packet.task };
}
