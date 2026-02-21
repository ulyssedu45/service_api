'use strict';

/**
 * Linux implementation of service_api.
 * Uses systemctl (systemd) to query service status, with a fallback to
 * the legacy SysV `service` command for non-systemd systems.
 */

import { ServiceStatus } from './types';

/**
 * Thin async wrapper around child_process.execFile.
 */
function execFileAsync(
  cmd: string,
  args: string[],
  opts: { timeout: number }
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    require('child_process').execFile(
      cmd,
      args,
      opts,
      (err: NodeJS.ErrnoException | null, stdout: string, stderr: string) => {
        if (err) {
          (err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stdout = stdout;
          (err as NodeJS.ErrnoException & { stdout?: string; stderr?: string }).stderr = stderr;
          reject(err);
        } else {
          resolve({ stdout: stdout || '', stderr: stderr || '' });
        }
      }
    );
  });
}

// ─── Systemd state map ────────────────────────────────────────────────────────

/**
 * Maps systemctl ActiveState values to the canonical state strings used
 * by service_api (mirrors Windows SERVICE_STATES for a consistent API).
 */
const SYSTEMD_STATE_MAP: Record<string, string> = {
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
 */
async function isSystemd(): Promise<boolean> {
  try {
    await execFileAsync('systemctl', ['--version'], { timeout: 3000 });
    return true;
  } catch {
    return false;
  }
}

interface SystemdQueryResult {
  loadState: string;
  activeState: string;
  subState: string;
  mainPid: number;
}

/**
 * Queries a service via systemctl (systemd).
 */
async function querySystemd(serviceName: string): Promise<SystemdQueryResult> {
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

  const props: Record<string, string> = {};
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
 */
async function querySysV(serviceName: string): Promise<{ running: boolean }> {
  try {
    await execFileAsync('service', [serviceName, 'status'], { timeout: 5000 });
    return { running: true };
  } catch {
    return { running: false };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether a Linux service exists.
 *
 * @param serviceName - The service name (e.g. "nginx", "sshd").
 * @returns Resolves to `true` if the service is known.
 * @throws If the service manager cannot be contacted.
 */
export async function serviceExists(serviceName: string): Promise<boolean> {
  if (!serviceName || typeof serviceName !== 'string') {
    throw new TypeError('serviceName must be a non-empty string');
  }

  if (await isSystemd()) {
    const { loadState } = await querySystemd(serviceName);
    return loadState !== 'not-found' && loadState !== '';
  }

  // SysV fallback: check if an init script is present.
  const { access: fsAccess } = require('fs').promises;
  try {
    await fsAccess(`/etc/init.d/${serviceName}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the current status of a Linux service.
 *
 * @param serviceName - The service name (e.g. "nginx", "sshd").
 * @returns The service status.
 * @throws If the service does not exist or cannot be queried.
 */
export async function getServiceStatus(serviceName: string): Promise<ServiceStatus> {
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
