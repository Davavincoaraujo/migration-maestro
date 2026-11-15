import { spawn } from "node:child_process";

export type AcpPreflight = {
  available: boolean;
  reason: "ACP_CHECK_OK" | "ACP_CHECK_FAILED" | "ACP_UNAVAILABLE" | "ACP_TIMEOUT";
};

/** Check adapter dependencies only; never launch an ACP session or execute agent tools. */
export function checkHermesAcp(executable = "hermes", timeoutMs = 10000): Promise<AcpPreflight> {
  if (!/^[a-zA-Z0-9._/-]{1,256}$/.test(executable)) throw new Error("INVALID_EXECUTABLE");
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) throw new Error("INVALID_TIMEOUT");
  return new Promise(resolve => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (result: AcpPreflight) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const child = spawn(executable, ["acp", "--check"], {
      shell: false,
      stdio: "ignore",
      env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "" }
    });
    timer = setTimeout(() => {
      child.kill();
      finish({ available: false, reason: "ACP_TIMEOUT" });
    }, timeoutMs);
    child.on("error", () => finish({ available: false, reason: "ACP_UNAVAILABLE" }));
    child.on("close", code => finish({
      available: code === 0,
      reason: code === 0 ? "ACP_CHECK_OK" : "ACP_CHECK_FAILED"
    }));
  });
}
