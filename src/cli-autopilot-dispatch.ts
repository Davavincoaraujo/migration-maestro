import { cliDispatchExecutor, executePendingDispatch } from "./autopilot/dispatch-executor.js";
const [root, stage, ...extra] = process.argv.slice(2);
try {
  if (!root || !stage || extra.length) throw Error("Usage: npm run autopilot:dispatch -- <job-directory> <STAGE>");
  const receipt = await executePendingDispatch(root, stage, cliDispatchExecutor());
  console.log(JSON.stringify(receipt, null, 2));
} catch (error) {
  const code = error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : "DISPATCH_BLOCKED_INSPECT_REQUEST_AND_ATTEMPT";
  console.error(code);
  process.exitCode = 1;
}
