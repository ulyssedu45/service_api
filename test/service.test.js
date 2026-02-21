'use strict';

/**
 * Tests for the Linux implementation (src/linux.js).
 * These tests mock child_process.execFile and fs.promises.access to avoid
 * requiring a real system service manager.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

// ─── We test src/linux.js in isolation ───────────────────────────────────────



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
