'use strict';

let _addon;

function getAddon() {
  if (!_addon) {
    try {
      _addon = require('../build/Release/service_status');
    } catch (err) {
      throw new Error(
        'Native Windows addon could not be loaded. ' +
        'Please run `npm run build` first. Original error: ' + err.message
      );
    }
  }
  return _addon;
}

/**
 * Check whether a service exists on Windows.
 * @param {string} serviceName
 * @returns {Promise<boolean>}
 */
function serviceExists(serviceName) {
  return new Promise((resolve, reject) => {
    try {
      const result = getAddon().serviceExists(serviceName);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Get the status of a service on Windows.
 * @param {string} serviceName
 * @returns {Promise<object>}
 */
function getServiceStatus(serviceName) {
  return new Promise((resolve, reject) => {
    try {
      const result = getAddon().getServiceStatus(serviceName);
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * List all services on Windows.
 * @returns {Promise<Array<object>>}
 */
function listServices() {
  return new Promise((resolve, reject) => {
    try {
      const result = getAddon().listServices();
      resolve(result);
    } catch (err) {
      reject(err);
    }
  });
}

module.exports = { serviceExists, getServiceStatus, listServices };
