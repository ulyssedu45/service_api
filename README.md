# service_api

Cross-platform Node.js library to **check the existence and status of OS services** using native system APIs.

**The same code runs unchanged on Windows and Linux** — the library selects the correct OS backend automatically. No `if (platform === 'win32')` guards are needed in your application.

| Platform    | Backend                                                                                                                                             |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Windows** | `advapi32.dll` — calls the Windows Service Control Manager (SCM) directly via [koffi](https://koffi.dev/) FFI bindings. No PowerShell, no `sc.exe`. |
| **Linux**   | `systemctl` (systemd), with a fallback to the legacy SysV `service` command.                                                                        |

---

## Installation

```bash
npm install @ulyssedu45/service_api
```

> **Requirements**: Node.js ≥ 18. koffi ships pre-built binaries for Windows and Linux (x64 / arm64) — no compilation step is needed.

---

## Usage

The import and every function call look **identical** on Windows and Linux:

```js
const { serviceExists, getServiceStatus } = require("@ulyssedu45/service_api");

// ── Check whether a service exists ───────────────────────────────────────────
const exists = await serviceExists("myService");
console.log(exists); // true | false

// ── Get the full status ───────────────────────────────────────────────────────
const status = await getServiceStatus("myService");
console.log(status);
// {
//   name:    'myService',
//   exists:  true,
//   state:   'RUNNING',  // normalized — same values on both platforms
//   pid:     12345,
//   rawCode: ...         // raw OS value: ActiveState string (Linux) or dwCurrentState number (Windows)
// }
```

### Service name convention

| Platform | Name to use                            | Examples                             |
| -------- | -------------------------------------- | ------------------------------------ |
| Windows  | Short service name                     | `"wuauserv"`, `"spooler"`, `"W3SVC"` |
| Linux    | systemd unit name (without `.service`) | `"nginx"`, `"sshd"`, `"cron"`        |

---

## Examples

### Check existence and react to state

```js
const { serviceExists, getServiceStatus } = require("@ulyssedu45/service_api");

async function checkService(name) {
  if (!(await serviceExists(name))) {
    console.log(`${name} is not installed.`);
    return;
  }

  const { state, pid } = await getServiceStatus(name);

  if (state === "RUNNING") {
    console.log(`${name} is running (PID ${pid}).`);
  } else if (state === "STOPPED") {
    console.log(`${name} is stopped.`);
  } else {
    console.log(`${name} state: ${state}`);
  }
}

// Windows
checkService("spooler");

// Linux
checkService("nginx");
```

### Check multiple services at once

```js
const { getServiceStatus } = require("@ulyssedu45/service_api");

const services =
  process.platform === "win32"
    ? ["spooler", "wuauserv", "W3SVC"] // Windows
    : ["nginx", "sshd", "cron"]; // Linux

const results = await Promise.all(services.map((name) => getServiceStatus(name).catch((err) => ({ name, exists: false, error: err.message }))));

for (const s of results) {
  if (!s.exists) {
    console.log(`${s.name}: not found`);
  } else {
    console.log(`${s.name}: ${s.state} (PID ${s.pid || "-"})`);
  }
}
```

### Runnable demo

```bash
# Uses a sensible default service for the current OS
node examples/check-service.js

# Pass any service name as an argument
node examples/check-service.js nginx      # Linux
node examples/check-service.js spooler   # Windows
```

---

## API

### `serviceExists(serviceName) → Promise<boolean>`

Returns `true` if the service is registered with the OS service manager, `false` if it does not exist.

- Throws `TypeError` if `serviceName` is not a non-empty string.
- Throws `Error` if the service manager cannot be contacted.

### `getServiceStatus(serviceName) → Promise<ServiceStatus>`

Returns a `ServiceStatus` object:

| Field     | Type             | Description                                                                       |
| --------- | ---------------- | --------------------------------------------------------------------------------- |
| `name`    | `string`         | The service name as provided.                                                     |
| `exists`  | `boolean`        | Always `true` (throws if the service is missing).                                 |
| `state`   | `string`         | Normalized state — see table below.                                               |
| `pid`     | `number`         | Main process ID (`0` when the service is not running).                            |
| `rawCode` | `string\|number` | Raw OS value: `ActiveState` string on Linux, `dwCurrentState` integer on Windows. |

- Throws `Error` if the service does not exist or cannot be queried.

### State values

| `state`            | Linux (ActiveState)   | Windows (dwCurrentState) |
| ------------------ | --------------------- | ------------------------ |
| `RUNNING`          | `active`              | `4` (SERVICE_RUNNING)    |
| `STOPPED`          | `inactive` / `failed` | `1` (SERVICE_STOPPED)    |
| `START_PENDING`    | `activating`          | `2`                      |
| `STOP_PENDING`     | `deactivating`        | `3`                      |
| `CONTINUE_PENDING` | `reloading`           | `5`                      |
| `PAUSE_PENDING`    | —                     | `6`                      |
| `PAUSED`           | —                     | `7`                      |

---

## How it works on Windows

The library uses [koffi](https://koffi.dev/) to call `advapi32.dll` functions directly from Node.js — no PowerShell, no `sc.exe`, no child processes:

1. **`OpenSCManagerW`** — opens a connection to the local SCM.
2. **`OpenServiceW`** — opens a handle to the named service.
3. **`QueryServiceStatusEx`** — fills a `SERVICE_STATUS_PROCESS` structure with the current state and PID.
4. **`CloseServiceHandle`** — releases both handles.

If `OpenServiceW` fails with error `1060` (`ERROR_SERVICE_DOES_NOT_EXIST`), `serviceExists` returns `false` rather than throwing.

---

## Running the tests

```bash
npm test
```

Tests use Node.js's built-in `node:test` runner (no extra dependencies).
