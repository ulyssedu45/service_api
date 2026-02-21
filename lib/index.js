'use strict';

const platform = process.platform;

let impl;

if (platform === 'win32') {
  impl = require('./windows');
} else if (platform === 'linux') {
  impl = require('./linux');
} else {
  throw new Error(`Unsupported platform: ${platform}. Only 'win32' and 'linux' are supported.`);
}

/**
 * Check whether a service exists.
 * @param {string} serviceName
 * @returns {Promise<boolean>}
 */
function serviceExists(serviceName) {
  return impl.serviceExists(serviceName);
}

/**
 * Get the detailed status of a service.
 * @param {string} serviceName
 * @returns {Promise<{name: string, exists: boolean, state: string, pid: number, displayName?: string}>}
 */
function getServiceStatus(serviceName) {
  return impl.getServiceStatus(serviceName);
}

/**
 * List all services on the system.
 * @returns {Promise<Array<{name: string, exists: boolean, state: string, pid: number, displayName?: string}>>}
 */
function listServices() {
  return impl.listServices();
}

module.exports = { serviceExists, getServiceStatus, listServices };
