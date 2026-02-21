'use strict';

/**
 * service_api — cross-platform Node.js library to check Windows/Linux service
 * existence and status.
 *
 * On Windows the library calls the Service Control Manager (SCM) via the
 * advapi32.dll Windows API using koffi FFI bindings (no PowerShell, no sc.exe).
 *
 * On Linux the library queries systemd via systemctl, falling back to the
 * legacy SysV `service` command on non-systemd systems.
 *
 * @module service_api
 */

const platform = process.platform;

/** @type {{ serviceExists: Function, getServiceStatus: Function }} */
let impl;

if (platform === 'win32') {
  impl = require('./src/windows');
} else if (platform === 'linux' || platform === 'darwin') {
  impl = require('./src/linux');
} else {
  throw new Error(`service_api: unsupported platform "${platform}"`);
}

/**
 * @typedef {Object} ServiceStatus
 * @property {string}  name    - The service name as provided.
 * @property {boolean} exists  - Always `true` (throws if the service is missing).
 * @property {string}  state   - One of: RUNNING | STOPPED | START_PENDING |
 *                               STOP_PENDING | CONTINUE_PENDING | PAUSE_PENDING |
 *                               PAUSED | UNKNOWN(<raw>).
 * @property {number}  pid     - Main process ID (0 when the service is stopped).
 * @property {string|number} rawCode - The raw state value from the OS.
 */

/**
 * Checks whether a service exists on the current operating system.
 *
 * @param {string} serviceName
 *   - **Windows**: the short service name (e.g. `"wuauserv"`, `"spooler"`).
 *   - **Linux**:   the systemd unit name without the `.service` suffix
 *                  (e.g. `"nginx"`, `"sshd"`).
 *
 * @returns {Promise<boolean>} `true` if the service is registered, `false` otherwise.
 * @throws  {TypeError} If `serviceName` is not a non-empty string.
 * @throws  {Error}     If the service manager cannot be contacted.
 *
 * @example
 * const { serviceExists } = require('service_api');
 * if (await serviceExists('nginx')) console.log('nginx is installed');
 */
const serviceExists = impl.serviceExists;

/**
 * Returns the current status of a service.
 *
 * @param {string} serviceName - See {@link serviceExists} for naming convention.
 * @returns {Promise<ServiceStatus>}
 * @throws  {TypeError} If `serviceName` is not a non-empty string.
 * @throws  {Error}     If the service does not exist or cannot be queried.
 *
 * @example
 * const { getServiceStatus } = require('service_api');
 * const status = await getServiceStatus('nginx');
 * // { name: 'nginx', exists: true, state: 'RUNNING', pid: 1234, rawCode: 'active' }
 */
const getServiceStatus = impl.getServiceStatus;

module.exports = { serviceExists, getServiceStatus };
