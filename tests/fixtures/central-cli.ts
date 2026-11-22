// Test-only executable: real CLI argument parsing with an explicitly simulated session adapter.
import { centralCli } from '../../src/cli-autopilot-central.js';
import { simulatedDiscovery } from './verified-sessions.js';
await centralCli(process.argv.slice(2), simulatedDiscovery);
