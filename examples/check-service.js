"use strict";

/**
 * service_api — usage examples
 *
 * The SAME code runs unchanged on Windows and Linux.
 * The library selects the correct OS backend automatically.
 *
 * Run:
 *   node examples/check-service.js
 *   node examples/check-service.js <serviceName>
 */

const { serviceExists, getServiceStatus } = require("..");

// Pick a sensible default service name for each OS so the demo works
// out-of-the-box. You can override it by passing a CLI argument.
const DEFAULT_SERVICE =
  process.platform === "win32"
    ? "wuauserv" // Windows Update (present on every Windows installation)
    : "cron"; // cron daemon (present on most Linux distributions)

const serviceName = process.argv[2] || DEFAULT_SERVICE;

async function main() {
  console.log(`Platform : ${process.platform}`);
  console.log(`Service  : ${serviceName}\n`);

  // ── 1. Check existence ────────────────────────────────────────────────────
  //    Identical call on Windows and Linux — no platform checks needed.
  const exists = await serviceExists(serviceName);
  console.log(`Exists   : ${exists}`);

  if (!exists) {
    console.log(`\n"${serviceName}" is not registered on this system.`);
    return;
  }

  // ── 2. Get full status ────────────────────────────────────────────────────
  //    Returns the same ServiceStatus shape on both platforms.
  const status = await getServiceStatus(serviceName);

  console.log(`State    : ${status.state}`);
  console.log(`PID      : ${status.pid || "(not running)"}`);
  console.log(`Raw code : ${status.rawCode}`);

  // ── 3. React to state ─────────────────────────────────────────────────────
  //    Use the normalized state strings — no OS-specific values needed.
  switch (status.state) {
    case "RUNNING":
      console.log(`\n✔  "${serviceName}" is running (PID ${status.pid}).`);
      break;
    case "STOPPED":
      console.log(`\n✖  "${serviceName}" is stopped.`);
      break;
    case "START_PENDING":
    case "STOP_PENDING":
    case "CONTINUE_PENDING":
    case "PAUSE_PENDING":
      console.log(`\n⏳ "${serviceName}" is transitioning (${status.state}).`);
      break;
    case "PAUSED":
      console.log(`\n⏸  "${serviceName}" is paused.`);
      break;
    default:
      console.log(`\n?  "${serviceName}" is in an unexpected state: ${status.state}`);
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
