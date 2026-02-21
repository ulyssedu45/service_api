'use strict';

const { execFile } = require('child_process');

/**
 * Runs systemctl with the given arguments.
 * @param {string[]} args
 * @returns {Promise<{stdout: string, stderr: string, code: number}>}
 */
function runSystemctl(args) {
  return new Promise((resolve, reject) => {
    execFile('systemctl', args, { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err && err.code === 'ENOENT') {
        return reject(new Error('systemctl is not available on this system'));
      }
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: err ? (typeof err.code === 'number' ? err.code : (err.status || 1)) : 0,
      });
    });
  });
}

/**
 * Check whether a service exists on Linux.
 * @param {string} serviceName
 * @returns {Promise<boolean>}
 */
async function serviceExists(serviceName) {
  const unitName = serviceName.endsWith('.service') ? serviceName : `${serviceName}.service`;
  const { stdout, code } = await runSystemctl(['list-unit-files', unitName, '--no-pager', '--no-legend']);
  if (code !== 0 && stdout.trim() === '') {
    return false;
  }
  return stdout.trim().length > 0;
}

/**
 * Get the status of a service on Linux.
 * @param {string} serviceName
 * @returns {Promise<object>}
 */
async function getServiceStatus(serviceName) {
  const unitName = serviceName.endsWith('.service') ? serviceName : `${serviceName}.service`;
  const name = serviceName.replace(/\.service$/, '');

  const exists = await serviceExists(serviceName);
  if (!exists) {
    return { name, exists: false, state: 'not_found', pid: 0 };
  }

  const { stdout } = await runSystemctl([
    'show', unitName,
    '--property=ActiveState,SubState,MainPID',
    '--no-pager',
  ]);

  const props = {};
  for (const line of stdout.split('\n')) {
    const idx = line.indexOf('=');
    if (idx !== -1) {
      props[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
    }
  }

  const activeState = props['ActiveState'] || 'unknown';
  const subState = props['SubState'] || 'unknown';
  const pid = parseInt(props['MainPID'] || '0', 10) || 0;

  let state;
  if (activeState === 'active' && subState === 'running') {
    state = 'running';
  } else if (activeState === 'inactive' || subState === 'dead') {
    state = 'stopped';
  } else if (activeState === 'activating') {
    state = 'start_pending';
  } else if (activeState === 'deactivating') {
    state = 'stop_pending';
  } else if (activeState === 'failed') {
    state = 'stopped';
  } else {
    state = 'unknown';
  }

  return { name, exists: true, state, pid };
}

/**
 * List all services on Linux.
 * @returns {Promise<Array<object>>}
 */
async function listServices() {
  const { stdout } = await runSystemctl([
    'list-units', '--type=service', '--all', '--no-pager', '--no-legend',
  ]);

  const services = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Format: UNIT LOAD ACTIVE SUB DESCRIPTION
    const parts = trimmed.split(/\s+/);
    if (parts.length < 4) continue;
    const unitName = parts[0].replace(/●\s*/, '');
    const activeState = parts[2] || 'unknown';
    const subState = parts[3] || 'unknown';
    const name = unitName.replace(/\.service$/, '');

    let state;
    if (activeState === 'active' && subState === 'running') {
      state = 'running';
    } else if (activeState === 'inactive' || subState === 'dead') {
      state = 'stopped';
    } else if (activeState === 'activating') {
      state = 'start_pending';
    } else if (activeState === 'deactivating') {
      state = 'stop_pending';
    } else if (activeState === 'failed') {
      state = 'stopped';
    } else {
      state = 'unknown';
    }

    services.push({ name, exists: true, state, pid: 0 });
  }
  return services;
}

module.exports = { serviceExists, getServiceStatus, listServices };
