'use strict';

/**
 * Linux implementation of service_api.
 * Uses systemctl (systemd) to query service status, with a fallback to
 * the legacy SysV `service` command for non-systemd systems.
 */

/**
 * Thin async wrapper around child_process.execFile that looks up execFile from
 * the module cache on every call.  This keeps the function mockable in tests
 * without having to promisify a captured reference.
 *
 * @param {string}   cmd
 * @param {string[]} args
 * @param {object}   opts
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function execFileAsync(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    require('child_process').execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout: stdout || '', stderr: stderr || '' });
      }
    });
  });
}

// ─── Systemd state map ────────────────────────────────────────────────────────

/**
 * Maps systemctl ActiveState values to the canonical state strings used
 * by service_api (mirrors Windows SERVICE_STATES for a consistent API).
 */
const SYSTEMD_STATE_MAP = {
  active:       'RUNNING',
  activating:   'START_PENDING',
  deactivating: 'STOP_PENDING',
  inactive:     'STOPPED',
  failed:       'STOPPED',
  reloading:    'CONTINUE_PENDING'
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Detects whether the current system runs systemd.
 *
 * @returns {Promise<boolean>}
 */
async function isSystemd() {
  try {
    await execFileAsync('systemctl', ['--version'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Queries a service via systemctl (systemd).
 *
 * @param {string} serviceName
 * @returns {Promise<{activeState: string, subState: string, mainPid: number, loadState: string}>}
 */
async function querySystemd(serviceName) {
  // --value prints only the property value, one per line; --property restricts output.
  const { stdout } = await execFileAsync(
    'systemctl',
    [
      'show',
      '--no-pager',
      '--property=LoadState,ActiveState,SubState,MainPID',
      `${serviceName}.service`
    ],
    { timeout: 5000 }
  );

  const props = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx !== -1) {
      props[line.slice(0, idx)] = line.slice(idx + 1);
    }
  }

  return {
    loadState:   (props.LoadState  || '').trim(),
    activeState: (props.ActiveState || '').trim(),
    subState:    (props.SubState   || '').trim(),
    mainPid:     parseInt(props.MainPID || '0', 10) || 0
  };
}

/**
 * Queries a service via the legacy SysV `service` command.
 *
 * @param {string} serviceName
 * @returns {Promise<{running: boolean}>}
 */
async function querySysV(serviceName) {
  try {
    await execFileAsync('service', [serviceName, 'status'], { timeout: 5000 });
    return { running: true };
  } catch (err) {
    // exit code 3 = stopped (LSB convention); anything non-zero = not running
    return { running: false };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether a Linux service exists.
 *
 * @param {string} serviceName - The service name (e.g. "nginx", "sshd").
 * @returns {Promise<boolean>} Resolves to `true` if the service is known.
 * @throws {Error} If the service manager cannot be contacted.
 */
async function serviceExists(serviceName) {
  if (!serviceName || typeof serviceName !== 'string') {
    throw new TypeError('serviceName must be a non-empty string');
  }

  if (await isSystemd()) {
    const { loadState } = await querySystemd(serviceName);
    // systemd reports "not-found" for unknown unit names.
    return loadState !== 'not-found' && loadState !== '';
  }

  // SysV fallback: check if an init script is present.
  const { access } = require('fs').promises;
  try {
    await access(`/etc/init.d/${serviceName}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the current status of a Linux service.
 *
 * @param {string} serviceName - The service name (e.g. "nginx", "sshd").
 * @returns {Promise<ServiceStatus>}
 * @throws {Error} If the service does not exist or cannot be queried.
 */
async function getServiceStatus(serviceName) {
  if (!serviceName || typeof serviceName !== 'string') {
    throw new TypeError('serviceName must be a non-empty string');
  }

  if (await isSystemd()) {
    const { loadState, activeState, subState, mainPid } = await querySystemd(serviceName);

    if (loadState === 'not-found' || loadState === '') {
      throw new Error(`Service "${serviceName}" does not exist`);
    }

    const state = SYSTEMD_STATE_MAP[activeState] || `UNKNOWN(${activeState})`;

    return {
      name:    serviceName,
      exists:  true,
      state,
      pid:     mainPid,
      rawCode: activeState
    };
  }

  // SysV fallback
  const exists = await serviceExists(serviceName);
  if (!exists) {
    throw new Error(`Service "${serviceName}" does not exist`);
  }

  const { running } = await querySysV(serviceName);
  return {
    name:    serviceName,
    exists:  true,
    state:   running ? 'RUNNING' : 'STOPPED',
    pid:     0,
    rawCode: running ? 'active' : 'inactive'
  };
}

module.exports = { serviceExists, getServiceStatus };
