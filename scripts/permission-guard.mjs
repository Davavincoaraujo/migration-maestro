import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

const roots = ["/Users/macos/Developer/migration-maestro", "/Users/macos/Developer/iibr-fed-portalbradesco"];
export function evaluateFilePermission(event) {
  if (!["Write", "Edit"].includes(event?.tool_name)) return undefined;
  const file = event?.tool_input?.file_path;
  if (typeof file !== "string" || !isAbsolute(file)) return "A file operation requires an absolute scoped path.";
  let candidate = resolve(file), parent = candidate, tail = [];
  try {
    while (true) {
      try { candidate = join(realpathSync(parent), ...tail.reverse()); break; }
      catch (error) {
        if (error.code !== "ENOENT") throw error;
        tail.push(basename(parent)); parent = dirname(parent);
      }
    }
  } catch { return "The destination could not be resolved safely."; }
  if (!roots.some(root => candidate.startsWith(root + "/"))) return "File is outside the two authorized Migration Maestro projects.";
  const parts = candidate.split("/");
  if (parts.some(p => [".git", ".codex", ".claude", ".aws"].includes(p) || p === ".env" || p.startsWith(".env."))) return "Changing security settings, Git metadata or credentials requires explicit approval.";
  if (event.tool_name === "Write") {
    try { lstatSync(candidate); return "Replacing an existing file with Write requires explicit approval; use a scoped Edit for routine changes."; }
    catch (error) { if (error.code !== "ENOENT") return "Destination status could not be verified."; }
  }
  return undefined;
}

if (process.argv[1] && resolve(process.argv[1]) === new URL(import.meta.url).pathname) {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 200000) { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: "Permission event exceeds bounded size." } })); process.exit(0); }
  }
  let reason;
  try { reason = evaluateFilePermission(JSON.parse(input)); }
  catch { reason = "Permission event is invalid; explicit approval is required."; }
  if (reason) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason } }));
}
