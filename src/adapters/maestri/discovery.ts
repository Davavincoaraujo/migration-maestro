import { access, stat } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";

export interface MaestriDiscovery {
  available: boolean;
  command: string;
  agentsText?: string;
  reason?: "APP_NOT_FOUND" | "INTEGRATION_NOT_CONFIGURED" | "UNSUPPORTED_PLATFORM";
  appPath?: string;
  appInstalled: boolean;
  agentsAvailable: boolean;
}

/**
 * Detect the installed macOS application without assuming an undocumented CLI,
 * reading app-private data, or launching it. Detection does NOT discover agents.
 */
export async function discoverMaestriAgents(timeoutMs = 5000): Promise<MaestriDiscovery> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30000) {
    throw new Error("INVALID_TIMEOUT");
  }
  if (platform() !== "darwin") {
    return { available: false, command: "none", appInstalled: false, agentsAvailable: false, reason: "UNSUPPORTED_PLATFORM" };
  }
  const candidates = [
    "/Applications/Maestri.app",
    join(homedir(), "Applications", "Maestri.app")
  ];
  for (const appPath of candidates) {
    try {
      const bundle = await stat(appPath);
      if (!bundle.isDirectory()) continue;
      await access(join(appPath, "Contents", "MacOS", "Maestri"), constants.X_OK);
      return {
        available: false,
        command: "none",
        appInstalled: true,
        agentsAvailable: false,
        appPath,
        reason: "INTEGRATION_NOT_CONFIGURED"
      };
    } catch {
      // Missing or inaccessible candidate: check the next standard install path.
    }
  }
  return { available: false, command: "none", appInstalled: false, agentsAvailable: false, reason: "APP_NOT_FOUND" };
}
