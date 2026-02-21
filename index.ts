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

import { ServiceStatus, ServiceModule } from './src/types';

const platform = process.platform;

let impl: ServiceModule;

if (platform === 'win32') {
  impl = require('./src/windows');
} else if (platform === 'linux' || platform === 'darwin') {
  impl = require('./src/linux');
} else {
  throw new Error(`service_api: unsupported platform "${platform}"`);
}

/**
 * Checks whether a service exists on the current operating system.
 *
 * @param serviceName
 *   - **Windows**: the short service name (e.g. `"wuauserv"`, `"spooler"`).
 *   - **Linux**:   the systemd unit name without the `.service` suffix
 *                  (e.g. `"nginx"`, `"sshd"`).
 *
 * @returns `true` if the service is registered, `false` otherwise.
 * @throws  {TypeError} If `serviceName` is not a non-empty string.
 * @throws  {Error}     If the service manager cannot be contacted.
 */
const serviceExists = impl.serviceExists;

/**
 * Returns the current status of a service.
 *
 * @param serviceName - See {@link serviceExists} for naming convention.
 * @returns The service status.
 * @throws  {TypeError} If `serviceName` is not a non-empty string.
 * @throws  {Error}     If the service does not exist or cannot be queried.
 */
const getServiceStatus = impl.getServiceStatus;

export { serviceExists, getServiceStatus, ServiceStatus };
