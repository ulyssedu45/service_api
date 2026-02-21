'use strict';

/**
 * Linux implementation of service_api.
 * Uses three native backends in cascade:
 *   1. systemd  — libsystemd.so.0 via koffi (D-Bus sd_bus), with systemctl CLI fallback
 *   2. OpenRC   — pure filesystem reads (/run/openrc/…)
 *   3. SysV     — /etc/init.d/ + /proc/<pid>
 */

import fs from 'fs';
import { execSync } from 'child_process';
import { ServiceStatus } from './types';

// ─── Filesystem helpers ───────────────────────────────────────────────────────

function fsExistsSync(p: string): boolean {
  try {
    fs.accessSync(p);
    return true;
  } catch {
    return false;
  }
}

function readPidFile(...paths: string[]): number {
  for (const p of paths) {
    try {
      const raw = fs.readFileSync(p, 'utf8').trim();
      const pid = parseInt(raw, 10);
      if (pid > 0) return pid;
    } catch {
      // try next
    }
  }
  return 0;
}

// ─── Init system detection ────────────────────────────────────────────────────

type InitSystem = 'systemd' | 'openrc' | 'sysv';

export function detectInitSystem(): InitSystem {
  if (fsExistsSync('/run/systemd/private') || fsExistsSync('/sys/fs/cgroup/systemd')) {
    return 'systemd';
  }
  if (fsExistsSync('/run/openrc/softlevel') || fsExistsSync('/run/openrc')) {
    return 'openrc';
  }
  return 'sysv';
}

// ─── Systemd state map ────────────────────────────────────────────────────────

const SYSTEMD_STATE_MAP: Record<string, string> = {
  active:       'RUNNING',
  activating:   'START_PENDING',
  deactivating: 'STOP_PENDING',
  inactive:     'STOPPED',
  failed:       'STOPPED',
  reloading:    'CONTINUE_PENDING'
};

// ─── systemd backend — koffi + libsystemd ────────────────────────────────────

interface LibsystemdBindings {
  sd_bus_open_system: (ret: object) => number;
  sd_bus_get_property_string: (
    bus: object, dest: string, path: string, iface: string,
    member: string, error: object, ret: object
  ) => number;
  sd_bus_unref: (bus: object) => object;
}

let _libsystemd: LibsystemdBindings | null = null;
let _libsystemdAvailable: boolean | null = null;

function tryLoadLibsystemd(): boolean {
  if (_libsystemdAvailable !== null) return _libsystemdAvailable;
  try {
    const koffi = require('koffi');
    const lib = koffi.load('libsystemd.so.0');
    _libsystemd = {
      sd_bus_open_system: lib.func('int sd_bus_open_system(void **ret)'),
      sd_bus_get_property_string: lib.func(
        'int sd_bus_get_property_string(void *bus, str dest, str path, str iface, str member, void **error, char **ret)'
      ),
      sd_bus_unref: lib.func('void *sd_bus_unref(void *bus)')
    };
    _libsystemdAvailable = true;
  } catch {
    _libsystemdAvailable = false;
  }
  return _libsystemdAvailable;
}

const SYSTEMD_DEST = 'org.freedesktop.systemd1';
const UNIT_IFACE   = 'org.freedesktop.systemd1.Unit';

function unitObjectPath(serviceName: string): string {
  const unit = serviceName.includes('.') ? serviceName : `${serviceName}.service`;
  const encoded = Array.from(unit).map(c => {
    if (/[A-Za-z0-9]/.test(c)) return c;
    return `_${c.charCodeAt(0).toString(16).padStart(2, '0')}`;
  }).join('');
  return `/org/freedesktop/systemd1/unit/${encoded}`;
}

interface SystemdQueryResult {
  loadState:   string;
  activeState: string;
  subState:    string;
  mainPid:     number;
}

function queryLibsystemd(serviceName: string): SystemdQueryResult {
  const lib = _libsystemd!;
  const busRef = [null];
  if (lib.sd_bus_open_system(busRef) < 0 || busRef[0] === null) {
    throw new Error('sd_bus_open_system failed');
  }
  const bus = busRef[0];
  const path = unitObjectPath(serviceName);

  function getProp(member: string): string {
    const retRef = [null];
    const r = lib.sd_bus_get_property_string(bus, SYSTEMD_DEST, path, UNIT_IFACE, member, [null], retRef);
    if (r < 0) return '';
    return retRef[0] ? String(retRef[0]) : '';
  }

  try {
    const loadState   = getProp('LoadState');
    const activeState = getProp('ActiveState');
    const subState    = getProp('SubState');
    const mainPidStr  = getProp('MainPID');
    return {
      loadState,
      activeState,
      subState,
      mainPid: parseInt(mainPidStr, 10) || 0
    };
  } finally {
    lib.sd_bus_unref(bus);
  }
}

// ─── systemd fallback — systemctl CLI ─────────────────────────────────────────

function querySystemctl(serviceName: string): SystemdQueryResult {
  const unit = serviceName.includes('.') ? serviceName : `${serviceName}.service`;
  try {
    const output = execSync(
      `systemctl show ${unit} --property=LoadState,ActiveState,SubState,MainPID --no-pager`,
      { encoding: 'utf8', timeout: 5000, stdio: ['pipe', 'pipe', 'pipe'] }
    );
    const props: Record<string, string> = {};
    for (const line of output.trim().split('\n')) {
      const idx = line.indexOf('=');
      if (idx > 0) {
        props[line.slice(0, idx)] = line.slice(idx + 1);
      }
    }
    return {
      loadState:   props['LoadState']   || '',
      activeState: props['ActiveState'] || '',
      subState:    props['SubState']    || '',
      mainPid:     parseInt(props['MainPID'] || '0', 10) || 0
    };
  } catch {
    throw new Error(`systemctl query failed for "${serviceName}"`);
  }
}

// ─── OpenRC backend ───────────────────────────────────────────────────────────

function openrcExists(serviceName: string): boolean {
  return (
    fsExistsSync(`/etc/init.d/${serviceName}`) ||
    fsExistsSync(`/etc/runlevels/default/${serviceName}`)
  );
}

function openrcState(serviceName: string): string {
  if (fsExistsSync(`/run/openrc/started/${serviceName}`))  return 'RUNNING';
  if (fsExistsSync(`/run/openrc/starting/${serviceName}`)) return 'START_PENDING';
  if (fsExistsSync(`/run/openrc/stopping/${serviceName}`)) return 'STOP_PENDING';
  return 'STOPPED';
}

// ─── SysV backend ─────────────────────────────────────────────────────────────

function sysvExists(serviceName: string): boolean {
  return fsExistsSync(`/etc/init.d/${serviceName}`);
}

function sysvRunning(serviceName: string): { running: boolean; pid: number } {
  const pid = readPidFile(`/var/run/${serviceName}.pid`, `/run/${serviceName}.pid`);
  if (pid > 0) {
    return { running: fsExistsSync(`/proc/${pid}`), pid };
  }
  const hasLock =
    fsExistsSync(`/var/run/${serviceName}.lock`) ||
    fsExistsSync(`/run/${serviceName}.lock`);
  return { running: hasLock, pid: 0 };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether a Linux service exists.
 *
 * @param serviceName - The service name (e.g. "nginx", "sshd").
 * @returns Resolves to `true` if the service is known to the init system.
 */
export async function serviceExists(serviceName: string): Promise<boolean> {
  if (!serviceName || typeof serviceName !== 'string') {
    throw new TypeError('serviceName must be a non-empty string');
  }

  const init = detectInitSystem();

  if (init === 'systemd') {
    if (tryLoadLibsystemd()) {
      try {
        const { loadState } = queryLibsystemd(serviceName);
        return loadState !== 'not-found' && loadState !== '';
      } catch {
        // fall through to SysV
      }
    }
    // libsystemd unavailable or query failed — try systemctl CLI
    try {
      const { loadState } = querySystemctl(serviceName);
      if (loadState !== '' && loadState !== 'not-found') return true;
      // systemctl says not-found — check SysV fallback
    } catch {
      // systemctl unavailable — fallback to SysV
    }
    return sysvExists(serviceName);
  }

  if (init === 'openrc') {
    return openrcExists(serviceName);
  }

  // SysV
  return sysvExists(serviceName);
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

  const init = detectInitSystem();

  // ── systemd ────────────────────────────────────────────────────────────────
  if (init === 'systemd') {
    if (tryLoadLibsystemd()) {
      let result: SystemdQueryResult;
      try {
        result = queryLibsystemd(serviceName);
      } catch {
        // libsystemd query failed — try systemctl CLI
        return _systemctlStatus(serviceName);
      }
      const { loadState, activeState, mainPid } = result;
      if (loadState === 'not-found' || loadState === '') {
        throw new Error(`Service "${serviceName}" does not exist`);
      }
      return {
        name:    serviceName,
        exists:  true,
        state:   SYSTEMD_STATE_MAP[activeState] || `UNKNOWN(${activeState})`,
        pid:     mainPid,
        rawCode: activeState
      };
    }
    // libsystemd unavailable — try systemctl CLI
    return _systemctlStatus(serviceName);
  }

  // ── OpenRC ─────────────────────────────────────────────────────────────────
  if (init === 'openrc') {
    if (!openrcExists(serviceName)) {
      throw new Error(`Service "${serviceName}" does not exist`);
    }
    const state = openrcState(serviceName);
    const pid   = readPidFile(`/run/${serviceName}.pid`, `/var/run/${serviceName}.pid`);
    return {
      name:    serviceName,
      exists:  true,
      state,
      pid,
      rawCode: state.toLowerCase()
    };
  }

  // ── SysV ───────────────────────────────────────────────────────────────────
  return _sysvStatus(serviceName);
}

function _sysvStatus(serviceName: string): ServiceStatus {
  if (!sysvExists(serviceName)) {
    throw new Error(`Service "${serviceName}" does not exist`);
  }
  const { running, pid } = sysvRunning(serviceName);
  return {
    name:    serviceName,
    exists:  true,
    state:   running ? 'RUNNING' : 'STOPPED',
    pid,
    rawCode: running ? 'active' : 'inactive'
  };
}

function _systemctlStatus(serviceName: string): ServiceStatus {
  let result: SystemdQueryResult;
  try {
    result = querySystemctl(serviceName);
  } catch {
    // systemctl unavailable — fall through to SysV
    return _sysvStatus(serviceName);
  }
  const { loadState, activeState, mainPid } = result;
  if (loadState === 'not-found' || loadState === '') {
    // Service not known to systemd — fall through to SysV
    return _sysvStatus(serviceName);
  }
  return {
    name:    serviceName,
    exists:  true,
    state:   SYSTEMD_STATE_MAP[activeState] || `UNKNOWN(${activeState})`,
    pid:     mainPid,
    rawCode: activeState
  };
}
