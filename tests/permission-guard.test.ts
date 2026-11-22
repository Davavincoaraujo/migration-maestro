import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function check(tool_name: string, file_path: string) {
  const result = spawnSync(process.execPath, [resolve("scripts/permission-guard.mjs")], { input: JSON.stringify({ tool_name, tool_input: { file_path } }), encoding: "utf8" });
  assert.equal(result.status, 0);
  return result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : undefined;
}
test("project hook asks before whole-file overwrite, security config changes and outside edits", () => {
  assert.equal(check("Write", resolve("src/cli.ts")).permissionDecision, "ask");
  assert.equal(check("Edit", resolve(".claude/settings.json")).permissionDecision, "ask");
  assert.equal(check("Edit", "/tmp/outside.txt").permissionDecision, "ask");
  assert.equal(check("Edit", resolve("src/cli.ts")), undefined);
  assert.equal(check("Write", resolve("src/nonexistent-component-permission-fixture.tsx")), undefined);
});
