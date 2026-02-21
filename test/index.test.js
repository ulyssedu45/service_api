'use strict';

/**
 * Basic unit tests for service_api.
 * On Linux: tests the linux.js module directly using systemctl (if available).
 * On Windows: tests the windows.js module via the native addon.
 */

const assert = require('assert');
const platform = process.platform;

let passed = 0;
let failed = 0;

function ok(description, value) {
  if (value) {
    console.log(`  ✓ ${description}`);
    passed++;
  } else {
    console.error(`  ✗ ${description}`);
    failed++;
  }
}

async function runTests() {
  console.log('\n=== service_api tests ===\n');

  // --- Test: module loads without error ---
  let api;
  try {
    if (platform === 'linux') {
      api = require('../lib/linux');
    } else if (platform === 'win32') {
      api = require('../lib/windows');
    } else {
      console.log('Platform not supported, skipping tests.');
      return;
    }
    ok('Module loads without error', true);
  } catch (err) {
    ok('Module loads without error', false);
    console.error('    Error:', err.message);
    return;
  }

  // --- Test: API surface ---
  ok('serviceExists is a function', typeof api.serviceExists === 'function');
  ok('getServiceStatus is a function', typeof api.getServiceStatus === 'function');
  ok('listServices is a function', typeof api.listServices === 'function');

  // --- Test: index.js exports the same API ---
  let indexApi;
  try {
    indexApi = require('../lib/index');
    ok('lib/index.js loads without error', true);
  } catch (err) {
    ok('lib/index.js loads without error', false);
    console.error('    Error:', err.message);
  }
  if (indexApi) {
    ok('index exports serviceExists', typeof indexApi.serviceExists === 'function');
    ok('index exports getServiceStatus', typeof indexApi.getServiceStatus === 'function');
    ok('index exports listServices', typeof indexApi.listServices === 'function');
  }

  if (platform === 'linux') {
    await runLinuxTests(api);
  } else if (platform === 'win32') {
    await runWindowsTests(api);
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

async function runLinuxTests(api) {
  // Test with a service that almost certainly doesn't exist
  const fakeName = 'definitely_nonexistent_service_xyz_12345';

  try {
    const exists = await api.serviceExists(fakeName);
    ok('serviceExists returns false for non-existent service', exists === false);
  } catch (err) {
    if (err.message.includes('systemctl is not available')) {
      console.log('  ~ systemctl not available, skipping runtime tests');
      return;
    }
    ok('serviceExists does not throw for non-existent service', false);
    console.error('    Error:', err.message);
  }

  try {
    const status = await api.getServiceStatus(fakeName);
    ok('getServiceStatus returns object for non-existent service', typeof status === 'object');
    ok('getServiceStatus returns exists=false for non-existent service', status.exists === false);
    ok("getServiceStatus returns state='not_found' for non-existent service", status.state === 'not_found');
    ok('getServiceStatus returns pid=0 for non-existent service', status.pid === 0);
    ok('getServiceStatus returns correct name', status.name === fakeName);
  } catch (err) {
    ok('getServiceStatus does not throw for non-existent service', false);
    console.error('    Error:', err.message);
  }

  try {
    const services = await api.listServices();
    ok('listServices returns an array', Array.isArray(services));
  } catch (err) {
    if (err.message.includes('systemctl is not available')) {
      console.log('  ~ systemctl not available, skipping listServices test');
    } else {
      ok('listServices does not throw', false);
      console.error('    Error:', err.message);
    }
  }
}

async function runWindowsTests(api) {
  const fakeName = 'definitely_nonexistent_service_xyz_12345';

  try {
    const exists = await api.serviceExists(fakeName);
    ok('serviceExists returns false for non-existent service', exists === false);
  } catch (err) {
    ok('serviceExists does not throw for non-existent service', false);
    console.error('    Error:', err.message);
  }

  try {
    const status = await api.getServiceStatus(fakeName);
    ok('getServiceStatus returns object for non-existent service', typeof status === 'object');
    ok('getServiceStatus returns exists=false for non-existent service', status.exists === false);
    ok("getServiceStatus returns state='not_found' for non-existent service", status.state === 'not_found');
    ok('getServiceStatus returns pid=0 for non-existent service', status.pid === 0);
  } catch (err) {
    ok('getServiceStatus does not throw for non-existent service', false);
    console.error('    Error:', err.message);
  }

  // Test with a well-known Windows service
  try {
    const exists = await api.serviceExists('wuauserv');
    ok('serviceExists returns boolean for wuauserv', typeof exists === 'boolean');
    if (exists) {
      const status = await api.getServiceStatus('wuauserv');
      ok('getServiceStatus returns object for wuauserv', typeof status === 'object');
      ok('getServiceStatus returns exists=true for wuauserv', status.exists === true);
      ok('getServiceStatus state is a string', typeof status.state === 'string');
      ok('getServiceStatus pid is a number', typeof status.pid === 'number');
    }
  } catch (err) {
    ok('serviceExists/getServiceStatus for wuauserv', false);
    console.error('    Error:', err.message);
  }
}

runTests().catch(err => {
  console.error('Unexpected error in test runner:', err);
  process.exitCode = 1;
});
