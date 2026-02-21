'use strict';

/**
 * Windows implementation of service_api.
 * Uses the Windows Service Control Manager (SCM) via koffi FFI bindings
 * to call advapi32.dll directly — no PowerShell or sc.exe involved.
 */

import koffi from 'koffi';
import { ServiceStatus } from './types';

// ─── Windows API constants ────────────────────────────────────────────────────

/** Right to connect to the SCM. */
const SC_MANAGER_CONNECT = 0x0001;

/** Right to query the service status. */
const SERVICE_QUERY_STATUS = 0x0004;

/** QueryServiceStatusEx InfoLevel: returns a SERVICE_STATUS_PROCESS structure. */
const SC_STATUS_PROCESS_INFO = 0;

/** GetLastError code when the named service does not exist in the SCM database. */
const ERROR_SERVICE_DOES_NOT_EXIST = 1060;

// ─── Service state map ────────────────────────────────────────────────────────

/** Maps dwCurrentState values to human-readable strings. */
const SERVICE_STATES: Record<number, string> = {
  1: 'STOPPED',
  2: 'START_PENDING',
  3: 'STOP_PENDING',
  4: 'RUNNING',
  5: 'CONTINUE_PENDING',
  6: 'PAUSE_PENDING',
  7: 'PAUSED'
};

// ─── koffi type definitions ───────────────────────────────────────────────────

/**
 * SERVICE_STATUS_PROCESS structure (winapi).
 * @see https://learn.microsoft.com/en-us/windows/win32/api/winsvc/ns-winsvc-service_status_process
 */
const SERVICE_STATUS_PROCESS = koffi.struct('SERVICE_STATUS_PROCESS', {
  dwServiceType:             'uint32',
  dwCurrentState:            'uint32',
  dwControlsAccepted:        'uint32',
  dwWin32ExitCode:           'uint32',
  dwServiceSpecificExitCode: 'uint32',
  dwCheckPoint:              'uint32',
  dwWaitHint:                'uint32',
  dwProcessId:               'uint32',
  dwServiceFlags:            'uint32'
});

// ─── DLL loading (lazy — only executed on Windows at require() time) ──────────

const advapi32 = koffi.load('advapi32');
const kernel32  = koffi.load('kernel32');

/**
 * Opens a connection to the service control manager.
 */
const OpenSCManagerW = advapi32.func(
  'void *OpenSCManagerW(str16 lpMachineName, str16 lpDatabaseName, uint32 dwDesiredAccess)'
);

/**
 * Opens an existing service object.
 */
const OpenServiceW = advapi32.func(
  'void *OpenServiceW(void *hSCManager, str16 lpServiceName, uint32 dwDesiredAccess)'
);

/**
 * Retrieves the current status of the specified service.
 */
const QueryServiceStatusEx = advapi32.func(
  'bool QueryServiceStatusEx(void *hService, int32 InfoLevel, _Out_ SERVICE_STATUS_PROCESS *lpBuffer, uint32 cbBufSize, _Out_ uint32 *pcbBytesNeeded)'
);

/** Closes an open handle to a service or the SCM. */
const CloseServiceHandle = advapi32.func(
  'bool CloseServiceHandle(void *hSCObject)'
);

/** Returns the last Win32 error code for the calling thread. */
const GetLastError = kernel32.func('uint32 GetLastError()');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Returns true when a koffi pointer value represents a NULL handle.
 */
function isNullHandle(handle: unknown): boolean {
  return handle === null || handle === 0;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Checks whether a Windows service exists in the SCM database.
 *
 * @param serviceName - The short name of the service (e.g. "wuauserv").
 * @returns Resolves to `true` if the service exists.
 * @throws If the SCM cannot be opened.
 */
export async function serviceExists(serviceName: string): Promise<boolean> {
  if (!serviceName || typeof serviceName !== 'string') {
    throw new TypeError('serviceName must be a non-empty string');
  }

  const hSCM = OpenSCManagerW(null, null, SC_MANAGER_CONNECT);
  if (isNullHandle(hSCM)) {
    throw new Error(`OpenSCManagerW failed (GetLastError=${GetLastError()})`);
  }

  try {
    const hService = OpenServiceW(hSCM, serviceName, SERVICE_QUERY_STATUS);
    if (isNullHandle(hService)) {
      const err = GetLastError();
      if (err === ERROR_SERVICE_DOES_NOT_EXIST) {
        return false;
      }
      throw new Error(`OpenServiceW failed (GetLastError=${err})`);
    }
    CloseServiceHandle(hService);
    return true;
  } finally {
    CloseServiceHandle(hSCM);
  }
}

/**
 * Returns the current status of a Windows service.
 *
 * @param serviceName - The short name of the service (e.g. "wuauserv").
 * @returns The service status.
 * @throws If the service does not exist or cannot be queried.
 */
export async function getServiceStatus(serviceName: string): Promise<ServiceStatus> {
  if (!serviceName || typeof serviceName !== 'string') {
    throw new TypeError('serviceName must be a non-empty string');
  }

  const hSCM = OpenSCManagerW(null, null, SC_MANAGER_CONNECT);
  if (isNullHandle(hSCM)) {
    throw new Error(`OpenSCManagerW failed (GetLastError=${GetLastError()})`);
  }

  try {
    const hService = OpenServiceW(hSCM, serviceName, SERVICE_QUERY_STATUS);
    if (isNullHandle(hService)) {
      const err = GetLastError();
      if (err === ERROR_SERVICE_DOES_NOT_EXIST) {
        throw new Error(`Service "${serviceName}" does not exist`);
      }
      throw new Error(`OpenServiceW failed (GetLastError=${err})`);
    }

    try {
      const statusBuf: Record<string, number> = {};
      const bytesNeeded = [0];
      const ok = QueryServiceStatusEx(
        hService,
        SC_STATUS_PROCESS_INFO,
        statusBuf,
        koffi.sizeof(SERVICE_STATUS_PROCESS),
        bytesNeeded
      );

      if (!ok) {
        throw new Error(`QueryServiceStatusEx failed (GetLastError=${GetLastError()})`);
      }

      const stateCode = statusBuf.dwCurrentState;
      return {
        name:    serviceName,
        exists:  true,
        state:   SERVICE_STATES[stateCode] || `UNKNOWN(${stateCode})`,
        pid:     statusBuf.dwProcessId,
        rawCode: stateCode
      };
    } finally {
      CloseServiceHandle(hService);
    }
  } finally {
    CloseServiceHandle(hSCM);
  }
}
