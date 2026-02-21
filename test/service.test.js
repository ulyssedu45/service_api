'use strict';

/**
 * Tests for the Linux implementation (src/linux.js).
 * These tests mock child_process.execFile and fs.promises.access to avoid
 * requiring a real system service manager.
 */

const { describe, it, before, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ─── We test src/linux.js in isolation ───────────────────────────────────────

// Ensure the module is loaded fresh for each test block by clearing the cache.
function freshLinux() {
  // Clear the cached module and its child_process dependency so mocks apply.
  Object.keys(require.cache).forEach(k => {
    if (k.includes('src/linux') || k.includes('src\\linux')) {
      delete require.cache[k];
    }
  });
  return require('../src/linux');
}

// ─── Helpers to build fake execFile ──────────────────────────────────────────

/**
 * Installs a mock for child_process.execFile (and its promisified variant).
 * Returns an object whose `resolve` / `reject` properties can be replaced to
 * control the next call.
 */
function mockExecFile(responses) {
  // responses: Array<{stdout?, stderr?, error?}>
  let callIndex = 0;

  const { execFile } = require('child_process');
  const childProcess = require('child_process');

  // Replace execFile with a version that calls our fake async handler
  childProcess.execFile = function fakeExecFile(cmd, args, opts, cb) {
    const res = responses[callIndex] || responses[responses.length - 1];
    callIndex++;
    if (res.error) {
      cb(res.error, res.stdout || '', res.stderr || '');
    } else {
      cb(null, res.stdout || '', res.stderr || '');
    }
    return { kill: () => {} };
  };

  return {
    restore() {
      childProcess.execFile = execFile;
    }
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Linux implementation — serviceExists', () => {
  it('returns true for an existing systemd service', async () => {
    const cp = require('child_process');
    const orig = cp.execFile;

    let callCount = 0;
    cp.execFile = function (cmd, args, opts, cb) {
      callCount++;
      if (callCount === 1) {
        // isSystemd() probe
        cb(null, 'systemd 252\n', '');
      } else {
        // querySystemd — service is loaded and running
        cb(null, 'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=1234\n', '');
      }
      return { kill: () => {} };
    };

    try {
      delete require.cache[require.resolve('../src/linux')];
      const { serviceExists } = require('../src/linux');
      const result = await serviceExists('nginx');
      assert.equal(result, true);
    } finally {
      cp.execFile = orig;
      delete require.cache[require.resolve('../src/linux')];
    }
  });

  it('returns false for a non-existent systemd service', async () => {
    const cp = require('child_process');
    const orig = cp.execFile;

    let callCount = 0;
    cp.execFile = function (cmd, args, opts, cb) {
      callCount++;
      if (callCount === 1) {
        cb(null, 'systemd 252\n', '');
      } else {
        // systemd reports not-found
        cb(null, 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n', '');
      }
      return { kill: () => {} };
    };

    try {
      delete require.cache[require.resolve('../src/linux')];
      const { serviceExists } = require('../src/linux');
      const result = await serviceExists('doesnotexist');
      assert.equal(result, false);
    } finally {
      cp.execFile = orig;
      delete require.cache[require.resolve('../src/linux')];
    }
  });

  it('throws TypeError for invalid serviceName', async () => {
    delete require.cache[require.resolve('../src/linux')];
    const { serviceExists } = require('../src/linux');
    await assert.rejects(() => serviceExists(''), TypeError);
    await assert.rejects(() => serviceExists(null), TypeError);
    await assert.rejects(() => serviceExists(42), TypeError);
  });
});

describe('Linux implementation — getServiceStatus', () => {
  it('returns RUNNING status for an active service', async () => {
    const cp = require('child_process');
    const orig = cp.execFile;

    let callCount = 0;
    cp.execFile = function (cmd, args, opts, cb) {
      callCount++;
      if (callCount === 1) {
        cb(null, 'systemd 252\n', '');
      } else {
        cb(null, 'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=4321\n', '');
      }
      return { kill: () => {} };
    };

    try {
      delete require.cache[require.resolve('../src/linux')];
      const { getServiceStatus } = require('../src/linux');
      const status = await getServiceStatus('sshd');
      assert.equal(status.name, 'sshd');
      assert.equal(status.exists, true);
      assert.equal(status.state, 'RUNNING');
      assert.equal(status.pid, 4321);
      assert.equal(status.rawCode, 'active');
    } finally {
      cp.execFile = orig;
      delete require.cache[require.resolve('../src/linux')];
    }
  });

  it('returns STOPPED status for an inactive service', async () => {
    const cp = require('child_process');
    const orig = cp.execFile;

    let callCount = 0;
    cp.execFile = function (cmd, args, opts, cb) {
      callCount++;
      if (callCount === 1) {
        cb(null, 'systemd 252\n', '');
      } else {
        cb(null, 'LoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\n', '');
      }
      return { kill: () => {} };
    };

    try {
      delete require.cache[require.resolve('../src/linux')];
      const { getServiceStatus } = require('../src/linux');
      const status = await getServiceStatus('nginx');
      assert.equal(status.state, 'STOPPED');
      assert.equal(status.pid, 0);
    } finally {
      cp.execFile = orig;
      delete require.cache[require.resolve('../src/linux')];
    }
  });

  it('returns START_PENDING for an activating service', async () => {
    const cp = require('child_process');
    const orig = cp.execFile;

    let callCount = 0;
    cp.execFile = function (cmd, args, opts, cb) {
      callCount++;
      if (callCount === 1) {
        cb(null, 'systemd 252\n', '');
      } else {
        cb(null, 'LoadState=loaded\nActiveState=activating\nSubState=start\nMainPID=0\n', '');
      }
      return { kill: () => {} };
    };

    try {
      delete require.cache[require.resolve('../src/linux')];
      const { getServiceStatus } = require('../src/linux');
      const status = await getServiceStatus('myservice');
      assert.equal(status.state, 'START_PENDING');
    } finally {
      cp.execFile = orig;
      delete require.cache[require.resolve('../src/linux')];
    }
  });

  it('throws when the service does not exist', async () => {
    const cp = require('child_process');
    const orig = cp.execFile;

    let callCount = 0;
    cp.execFile = function (cmd, args, opts, cb) {
      callCount++;
      if (callCount === 1) {
        cb(null, 'systemd 252\n', '');
      } else {
        cb(null, 'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n', '');
      }
      return { kill: () => {} };
    };

    try {
      delete require.cache[require.resolve('../src/linux')];
      const { getServiceStatus } = require('../src/linux');
      await assert.rejects(
        () => getServiceStatus('ghost'),
        err => err.message.includes('does not exist')
      );
    } finally {
      cp.execFile = orig;
      delete require.cache[require.resolve('../src/linux')];
    }
  });

  it('throws TypeError for invalid serviceName', async () => {
    delete require.cache[require.resolve('../src/linux')];
    const { getServiceStatus } = require('../src/linux');
    await assert.rejects(() => getServiceStatus(''), TypeError);
    await assert.rejects(() => getServiceStatus(undefined), TypeError);
  });
});

describe('index.js — module contract', () => {
  it('exports serviceExists and getServiceStatus functions', () => {
    // On Linux (our CI), the main index loads linux.js.
    delete require.cache[require.resolve('../index')];
    const api = require('../index');
    assert.equal(typeof api.serviceExists, 'function');
    assert.equal(typeof api.getServiceStatus, 'function');
  });
});
