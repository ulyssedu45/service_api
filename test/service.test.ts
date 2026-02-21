'use strict';

/**
 * Tests for the Linux implementation (src/linux.ts).
 * Mocks fs.accessSync and fs.readFileSync to avoid requiring a real init system.
 */

import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import fs from 'fs';

// Use require to get the mutable child_process module (not a frozen __importStar wrapper)
const child_process = require('child_process');

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Runs `fn` with fs.accessSync and fs.readFileSync patched.
 * `existsSet` is the set of paths that "exist" (accessSync succeeds for them).
 * `pidMap` maps pid-file paths to their string contents.
 *
 * NOTE: requireLinux() must be called BEFORE withFsMock so that Node.js's
 * module loader uses the real fs to read the .js file.
 */
async function withFsMock(
  existsSet: Set<string>,
  pidMap: Record<string, string>,
  fn: () => unknown
): Promise<void> {
  const origAccess   = fs.accessSync;
  const origReadFile = fs.readFileSync;

  fs.accessSync = (p: any) => {
    if (existsSet.has(String(p))) return;
    const err: any = new Error(`ENOENT: ${p}`);
    err.code = 'ENOENT';
    throw err;
  };
  (fs as any).readFileSync = (p: any, enc?: any) => {
    const key = String(p);
    if (key in pidMap) return pidMap[key];
    const err: any = new Error(`ENOENT: ${p}`);
    err.code = 'ENOENT';
    throw err;
  };

  try {
    await fn();
  } finally {
    fs.accessSync        = origAccess;
    (fs as any).readFileSync = origReadFile;
  }
}

/** Re-require linux module with a fresh cache entry. */
function requireLinux() {
  delete require.cache[require.resolve('../src/linux')];
  return require('../src/linux');
}

/**
 * Runs `fn` with fs.accessSync, fs.readFileSync, and child_process.execSync patched.
 * `systemctlOutput` controls what execSync returns (or throws if null).
 */
async function withFullMock(
  existsSet: Set<string>,
  pidMap: Record<string, string>,
  systemctlOutput: string | null,
  fn: () => unknown
): Promise<void> {
  const origAccess   = fs.accessSync;
  const origReadFile = fs.readFileSync;
  const origExecSync = child_process.execSync;

  fs.accessSync = (p: any) => {
    if (existsSet.has(String(p))) return;
    const err: any = new Error(`ENOENT: ${p}`);
    err.code = 'ENOENT';
    throw err;
  };
  (fs as any).readFileSync = (p: any, enc?: any) => {
    const key = String(p);
    if (key in pidMap) return pidMap[key];
    const err: any = new Error(`ENOENT: ${p}`);
    err.code = 'ENOENT';
    throw err;
  };
  (child_process as any).execSync = (_cmd: any, _opts?: any) => {
    if (systemctlOutput === null) {
      throw new Error('execSync mock: command not found');
    }
    return systemctlOutput;
  };

  try {
    await fn();
  } finally {
    fs.accessSync = origAccess;
    (fs as any).readFileSync = origReadFile;
    (child_process as any).execSync = origExecSync;
  }
}

// ─── detectInitSystem ─────────────────────────────────────────────────────────

describe('Linux implementation — detectInitSystem', () => {
  it('returns systemd when /run/systemd/private exists', async () => {
    const { detectInitSystem } = requireLinux();
    await withFsMock(new Set(['/run/systemd/private']), {}, () => {
      assert.equal(detectInitSystem(), 'systemd');
    });
  });

  it('returns openrc when /run/openrc/softlevel exists', async () => {
    const { detectInitSystem } = requireLinux();
    await withFsMock(new Set(['/run/openrc/softlevel']), {}, () => {
      assert.equal(detectInitSystem(), 'openrc');
    });
  });

  it('returns sysv when only /etc/init.d exists', async () => {
    const { detectInitSystem } = requireLinux();
    await withFsMock(new Set(['/etc/init.d']), {}, () => {
      assert.equal(detectInitSystem(), 'sysv');
    });
  });
});

// ─── serviceExists — systemd (libsystemd unavailable → SysV fallback) ─────────

describe('Linux implementation — serviceExists (systemd via libsystemd)', () => {
  it('returns true when libsystemd unavailable and /etc/init.d/<name> exists (fallback SysV)', async () => {
    const { serviceExists } = requireLinux();
    await withFsMock(
      new Set(['/run/systemd/private', '/etc/init.d/nginx']),
      {},
      async () => {
        const result = await serviceExists('nginx');
        assert.equal(result, true);
      }
    );
  });

  it('returns false when libsystemd unavailable and /etc/init.d/<name> absent', async () => {
    const { serviceExists } = requireLinux();
    await withFsMock(
      new Set(['/run/systemd/private']),
      {},
      async () => {
        const result = await serviceExists('doesnotexist');
        assert.equal(result, false);
      }
    );
  });
});

// ─── serviceExists — OpenRC ───────────────────────────────────────────────────

describe('Linux implementation — serviceExists (OpenRC)', () => {
  it('returns true when /etc/init.d/<name> exists', async () => {
    const { serviceExists } = requireLinux();
    await withFsMock(
      new Set(['/run/openrc/softlevel', '/etc/init.d/nginx']),
      {},
      async () => {
        assert.equal(await serviceExists('nginx'), true);
      }
    );
  });

  it('returns false when /etc/init.d/<name> does not exist', async () => {
    const { serviceExists } = requireLinux();
    await withFsMock(
      new Set(['/run/openrc/softlevel']),
      {},
      async () => {
        assert.equal(await serviceExists('ghost'), false);
      }
    );
  });
});

// ─── serviceExists — SysV ────────────────────────────────────────────────────

describe('Linux implementation — serviceExists (SysV)', () => {
  it('returns true when /etc/init.d/<name> exists', async () => {
    const { serviceExists } = requireLinux();
    await withFsMock(
      new Set(['/etc/init.d/cron']),
      {},
      async () => {
        assert.equal(await serviceExists('cron'), true);
      }
    );
  });

  it('returns false when /etc/init.d/<name> does not exist', async () => {
    const { serviceExists } = requireLinux();
    await withFsMock(
      new Set([]),
      {},
      async () => {
        assert.equal(await serviceExists('ghost'), false);
      }
    );
  });
});

// ─── getServiceStatus — systemd (libsystemd unavailable → SysV fallback) ──────

describe('Linux implementation — getServiceStatus (systemd via libsystemd)', () => {
  it('RUNNING: /etc/init.d exists and /proc/<pid> exists (fallback SysV)', async () => {
    const { getServiceStatus } = requireLinux();
    await withFsMock(
      new Set(['/run/systemd/private', '/etc/init.d/sshd', '/proc/4321']),
      { '/var/run/sshd.pid': '4321\n' },
      async () => {
        const status = await getServiceStatus('sshd');
        assert.equal(status.name, 'sshd');
        assert.equal(status.exists, true);
        assert.equal(status.state, 'RUNNING');
        assert.equal(status.pid, 4321);
      }
    );
  });

  it('STOPPED: /etc/init.d exists but no pid/proc (fallback SysV)', async () => {
    const { getServiceStatus } = requireLinux();
    await withFsMock(
      new Set(['/run/systemd/private', '/etc/init.d/nginx']),
      {},
      async () => {
        const status = await getServiceStatus('nginx');
        assert.equal(status.state, 'STOPPED');
        assert.equal(status.pid, 0);
      }
    );
  });

  it('throws when /etc/init.d/<name> does not exist (fallback SysV)', async () => {
    const { getServiceStatus } = requireLinux();
    await withFsMock(
      new Set(['/run/systemd/private']),
      {},
      async () => {
        await assert.rejects(
          () => getServiceStatus('ghost'),
          (err: Error) => err.message.includes('does not exist')
        );
      }
    );
  });
});

// ─── getServiceStatus — OpenRC ────────────────────────────────────────────────

describe('Linux implementation — getServiceStatus (OpenRC)', () => {
  it('RUNNING when /run/openrc/started/<name> exists', async () => {
    const { getServiceStatus } = requireLinux();
    await withFsMock(
      new Set(['/run/openrc/softlevel', '/etc/init.d/nginx', '/run/openrc/started/nginx']),
      { '/run/nginx.pid': '9999\n' },
      async () => {
        const status = await getServiceStatus('nginx');
        assert.equal(status.state, 'RUNNING');
        assert.equal(status.pid, 9999);
      }
    );
  });

  it('STOPPED when no openrc state files present', async () => {
    const { getServiceStatus } = requireLinux();
    await withFsMock(
      new Set(['/run/openrc/softlevel', '/etc/init.d/nginx']),
      {},
      async () => {
        const status = await getServiceStatus('nginx');
        assert.equal(status.state, 'STOPPED');
        assert.equal(status.pid, 0);
      }
    );
  });

  it('pid read from /run/<name>.pid', async () => {
    const { getServiceStatus } = requireLinux();
    await withFsMock(
      new Set(['/run/openrc/softlevel', '/etc/init.d/sshd', '/run/openrc/started/sshd']),
      { '/run/sshd.pid': '1234\n' },
      async () => {
        const status = await getServiceStatus('sshd');
        assert.equal(status.pid, 1234);
      }
    );
  });
});

// ─── getServiceStatus — SysV ──────────────────────────────────────────────────

describe('Linux implementation — getServiceStatus (SysV)', () => {
  it('RUNNING when /etc/init.d/<name> exists and /proc/<pid> exists', async () => {
    const { getServiceStatus } = requireLinux();
    await withFsMock(
      new Set(['/etc/init.d/cron', '/proc/5678']),
      { '/var/run/cron.pid': '5678\n' },
      async () => {
        const status = await getServiceStatus('cron');
        assert.equal(status.state, 'RUNNING');
        assert.equal(status.pid, 5678);
      }
    );
  });

  it('STOPPED when pid=0 and no lock file', async () => {
    const { getServiceStatus } = requireLinux();
    await withFsMock(
      new Set(['/etc/init.d/cron']),
      {},
      async () => {
        const status = await getServiceStatus('cron');
        assert.equal(status.state, 'STOPPED');
        assert.equal(status.pid, 0);
      }
    );
  });
});

// ─── TypeError guards ─────────────────────────────────────────────────────────

describe('Linux implementation — TypeError guards', () => {
  it('serviceExists("") → TypeError', async () => {
    const { serviceExists } = requireLinux();
    await assert.rejects(() => serviceExists(''), TypeError);
  });

  it('serviceExists(null) → TypeError', async () => {
    const { serviceExists } = requireLinux();
    await assert.rejects(() => serviceExists(null as any), TypeError);
  });

  it('getServiceStatus("") → TypeError', async () => {
    const { getServiceStatus } = requireLinux();
    await assert.rejects(() => getServiceStatus(''), TypeError);
  });

  it('getServiceStatus(undefined) → TypeError', async () => {
    const { getServiceStatus } = requireLinux();
    await assert.rejects(() => getServiceStatus(undefined as any), TypeError);
  });
});

// ─── getServiceStatus — systemd (systemctl CLI fallback) ──────────────────────

describe('Linux implementation — getServiceStatus (systemctl CLI fallback)', () => {
  it('RUNNING when systemctl reports ActiveState=active (e.g. active exited)', async () => {
    const { getServiceStatus } = requireLinux();
    await withFullMock(
      new Set(['/run/systemd/private']),
      {},
      'LoadState=loaded\nActiveState=active\nSubState=exited\nMainPID=0\n',
      async () => {
        const status = await getServiceStatus('networking');
        assert.equal(status.name, 'networking');
        assert.equal(status.exists, true);
        assert.equal(status.state, 'RUNNING');
        assert.equal(status.pid, 0);
        assert.equal(status.rawCode, 'active');
      }
    );
  });

  it('STOPPED when systemctl reports ActiveState=inactive', async () => {
    const { getServiceStatus } = requireLinux();
    await withFullMock(
      new Set(['/run/systemd/private']),
      {},
      'LoadState=loaded\nActiveState=inactive\nSubState=dead\nMainPID=0\n',
      async () => {
        const status = await getServiceStatus('nginx');
        assert.equal(status.state, 'STOPPED');
        assert.equal(status.rawCode, 'inactive');
      }
    );
  });

  it('RUNNING with PID when systemctl reports ActiveState=active with MainPID', async () => {
    const { getServiceStatus } = requireLinux();
    await withFullMock(
      new Set(['/run/systemd/private']),
      {},
      'LoadState=loaded\nActiveState=active\nSubState=running\nMainPID=1234\n',
      async () => {
        const status = await getServiceStatus('nginx');
        assert.equal(status.state, 'RUNNING');
        assert.equal(status.pid, 1234);
        assert.equal(status.rawCode, 'active');
      }
    );
  });

  it('falls through to SysV when systemctl reports not-found and /etc/init.d exists', async () => {
    const { getServiceStatus } = requireLinux();
    await withFullMock(
      new Set(['/run/systemd/private', '/etc/init.d/legacy', '/proc/5555']),
      { '/var/run/legacy.pid': '5555\n' },
      'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n',
      async () => {
        const status = await getServiceStatus('legacy');
        assert.equal(status.state, 'RUNNING');
        assert.equal(status.pid, 5555);
      }
    );
  });

  it('falls through to SysV when systemctl is unavailable', async () => {
    const { getServiceStatus } = requireLinux();
    await withFullMock(
      new Set(['/run/systemd/private', '/etc/init.d/myapp', '/proc/7777']),
      { '/var/run/myapp.pid': '7777\n' },
      null, // systemctl unavailable
      async () => {
        const status = await getServiceStatus('myapp');
        assert.equal(status.state, 'RUNNING');
        assert.equal(status.pid, 7777);
      }
    );
  });
});

// ─── serviceExists — systemd (systemctl CLI fallback) ─────────────────────────

describe('Linux implementation — serviceExists (systemctl CLI fallback)', () => {
  it('returns true when systemctl reports LoadState=loaded', async () => {
    const { serviceExists } = requireLinux();
    await withFullMock(
      new Set(['/run/systemd/private']),
      {},
      'LoadState=loaded\nActiveState=active\nSubState=exited\nMainPID=0\n',
      async () => {
        assert.equal(await serviceExists('networking'), true);
      }
    );
  });

  it('falls through to SysV when systemctl reports not-found', async () => {
    const { serviceExists } = requireLinux();
    await withFullMock(
      new Set(['/run/systemd/private', '/etc/init.d/legacy']),
      {},
      'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n',
      async () => {
        assert.equal(await serviceExists('legacy'), true);
      }
    );
  });

  it('returns false when systemctl reports not-found and no SysV script', async () => {
    const { serviceExists } = requireLinux();
    await withFullMock(
      new Set(['/run/systemd/private']),
      {},
      'LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\n',
      async () => {
        assert.equal(await serviceExists('ghost'), false);
      }
    );
  });
});

// ─── index.ts — module contract ───────────────────────────────────────────────

describe('index.ts — module contract', () => {
  it('exports serviceExists and getServiceStatus functions', () => {
    delete require.cache[require.resolve('../index')];
    const api = require('../index');
    assert.equal(typeof api.serviceExists, 'function');
    assert.equal(typeof api.getServiceStatus, 'function');
  });
});
