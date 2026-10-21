/**
 * Tests for update checking and applying, using a scripted fake for git and npm
 * (no repository, network or restart). Run with: npm run test --workspace=server
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  UpdateService,
  buildCompareUrl,
  commandEnvironment,
  summarizeFailure,
  type CommandResult,
  type CommandRunner,
  type UpdateServiceDeps,
} from './update.service.js';

const LOCAL = 'aaaaaaa1111111111111111111111111111111aa';
const REMOTE = 'bbbbbbb2222222222222222222222222222222bb';

const ok = (stdout = ''): CommandResult => ({ ok: true, stdout, stderr: '' });
const failed = (stderr = 'boom'): CommandResult => ({ ok: false, stdout: '', stderr });

/** Answers commands from a table keyed by "command arg arg"; records every call. */
function fakeRunner(answers: Record<string, CommandResult | CommandResult[]>): {
  run: CommandRunner;
  calls: string[];
} {
  const calls: string[] = [];
  const queues = new Map<string, CommandResult[]>();
  for (const [key, value] of Object.entries(answers)) queues.set(key, Array.isArray(value) ? [...value] : [value]);

  const run: CommandRunner = async (command, args) => {
    const line = `${command} ${args.join(' ')}`;
    calls.push(line);
    const key = [...queues.keys()].find((candidate) => line.startsWith(candidate));
    if (!key) return ok();
    const queue = queues.get(key) as CommandResult[];
    return queue.length > 1 ? (queue.shift() as CommandResult) : queue[0];
  };
  return { run, calls };
}

/** A clean install on main, one commit behind the remote. */
const behindRemote: Record<string, CommandResult | CommandResult[]> = {
  'git rev-parse HEAD': ok(`${LOCAL}\n`),
  'git rev-parse --abbrev-ref HEAD': ok('main\n'),
  'git ls-remote': ok(`${REMOTE}\trefs/heads/main\n`),
  'git merge-base --is-ancestor': failed('not an ancestor'),
  'git config --get remote.origin.url': ok('https://github.com/WayneJetski/hiring-helper.git\n'),
  'git status --porcelain': ok(''),
  'git diff --name-only': ok('server/src/index.ts\n'),
};

function makeService(
  answers: Record<string, CommandResult | CommandResult[]>,
  overrides: Partial<UpdateServiceDeps> = {}
) {
  const { run, calls } = fakeRunner(answers);
  const events: string[] = [];
  let nowMs = 1_000_000;
  const service = new UpdateService({
    repoRoot: '/install',
    run,
    isManagedInstall: true,
    readVersion: () => '2.0.0',
    installPackagesDuringRestart: false,
    restart: async ({ stopFirst }) => {
      events.push(stopFirst ? 'restart-stop-first' : 'restart');
    },
    writeBuildStamp: async () => {
      events.push('stamp');
    },
    now: () => nowMs,
    checkCacheMs: 30 * 60_000,
    ...overrides,
  });
  return { service, calls, events, advance: (ms: number) => (nowMs += ms) };
}

async function settle(service: UpdateService): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const { state } = (await service.getStatus()).apply;
    if (state === 'failed' || state === 'restarting' || state === 'idle') return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('update never settled');
}

// ---- compare links ----

test('builds a GitHub compare link from https, ssh and scp-style remotes', () => {
  const expected = 'https://github.com/WayneJetski/hiring-helper/compare/aaaaaaa...bbbbbbb';
  assert.equal(buildCompareUrl('https://github.com/WayneJetski/hiring-helper.git', LOCAL, REMOTE), expected);
  assert.equal(buildCompareUrl('https://github.com/WayneJetski/hiring-helper', LOCAL, REMOTE), expected);
  assert.equal(buildCompareUrl('git@github.com:WayneJetski/hiring-helper.git', LOCAL, REMOTE), expected);
  assert.equal(buildCompareUrl('ssh://git@github.com/WayneJetski/hiring-helper.git', LOCAL, REMOTE), expected);
});

test('no compare link for a remote that is not on GitHub', () => {
  assert.equal(buildCompareUrl('https://git.example.com/team/app.git', LOCAL, REMOTE), null);
  assert.equal(buildCompareUrl('/some/local/path', LOCAL, REMOTE), null);
});

// ---- checking ----

test('reports an update when the remote has a commit this copy does not', async () => {
  const { service } = makeService(behindRemote);
  const status = await service.getStatus();
  assert.equal(status.update.available, true);
  assert.equal(status.update.latestCommit, 'bbbbbbb');
  assert.equal(status.currentCommit, 'aaaaaaa');
  assert.match(status.update.compareUrl ?? '', /compare\/aaaaaaa\.\.\.bbbbbbb$/);
  assert.equal(status.currentVersion, '2.0.0');
  assert.equal(status.branch, 'main');
});

test('up to date when the remote is the same commit', async () => {
  const { service } = makeService({ ...behindRemote, 'git ls-remote': ok(`${LOCAL}\trefs/heads/main\n`) });
  assert.equal((await service.getStatus()).update.available, false);
});

test('not an update when this copy is ahead of the remote (it already has that commit)', async () => {
  const { service } = makeService({ ...behindRemote, 'git merge-base --is-ancestor': ok() });
  assert.equal((await service.getStatus()).update.available, false);
});

test('an unreachable remote reports why, never a false "update available"', async () => {
  const { service } = makeService({ ...behindRemote, 'git ls-remote': failed('could not resolve host') });
  const status = await service.getStatus();
  assert.equal(status.update.available, false);
  assert.match(status.update.error ?? '', /Could not reach the update server/);
});

test('a copy that is not a git checkout says so', async () => {
  const { service } = makeService({ ...behindRemote, 'git rev-parse HEAD': failed('not a git repository') });
  assert.match((await service.getStatus()).update.error ?? '', /not installed with git/);
});

test('a detached checkout cannot check', async () => {
  const { service } = makeService({ ...behindRemote, 'git rev-parse --abbrev-ref HEAD': ok('HEAD\n') });
  assert.match((await service.getStatus()).update.error ?? '', /not on a branch/);
});

test('a copy that is not managed never reaches out to check', async () => {
  const { service, calls } = makeService(behindRemote, { isManagedInstall: false });
  const status = await service.getStatus();
  assert.equal(status.update.available, false);
  assert.equal(status.isManagedInstall, false);
  assert.deepEqual(calls, [], 'no git command was run');
});

test('a check is reused for a while, and a refresh forces a new one', async () => {
  const { service, calls, advance } = makeService(behindRemote);
  await service.getStatus();
  await service.getStatus();
  assert.equal(calls.filter((call) => call.startsWith('git ls-remote')).length, 1);

  advance(31 * 60_000);
  await service.getStatus();
  assert.equal(calls.filter((call) => call.startsWith('git ls-remote')).length, 2);

  await service.getStatus({ refresh: true });
  assert.equal(calls.filter((call) => call.startsWith('git ls-remote')).length, 3);
});

// ---- refusing to update ----

test('a copy that is not managed refuses to update', async () => {
  const { service, calls } = makeService(behindRemote, { isManagedInstall: false });
  const result = await service.startUpdate(false);
  assert.equal(result.ok === false && result.code, 'not_managed');
  assert.equal(calls.some((call) => call.startsWith('git pull')), false);
});

test('an update will not start while scoring is running', async () => {
  const { service, calls } = makeService(behindRemote);
  const result = await service.startUpdate(true);
  assert.equal(result.ok === false && result.code, 'scoring_running');
  assert.equal(calls.some((call) => call.startsWith('git pull')), false);
});

test('local changes to tracked files block the update', async () => {
  const { service } = makeService({ ...behindRemote, 'git status --porcelain': ok(' M server/src/index.ts\n') });
  const result = await service.startUpdate(false);
  assert.equal(result.ok === false && result.code, 'local_changes');
});

test('npm rewriting the lockfile by itself does not block an update, and is put back before the pull', async () => {
  const { service, calls } = makeService({ ...behindRemote, 'git status --porcelain': ok(' M package-lock.json\n') });
  assert.deepEqual(await service.startUpdate(false), { ok: true });
  await settle(service);
  const restore = calls.findIndex((call) => call === 'git checkout -- package-lock.json');
  const pull = calls.findIndex((call) => call.startsWith('git pull'));
  assert.ok(restore !== -1 && pull > restore, 'lockfile restored, then pulled');
});

test('a lockfile change next to a real change still blocks the update', async () => {
  const { service, calls } = makeService({
    ...behindRemote,
    'git status --porcelain': ok(' M package-lock.json\n M server/src/index.ts\n'),
  });
  const result = await service.startUpdate(false);
  assert.equal(result.ok === false && result.code, 'local_changes');
  assert.equal(calls.some((call) => call.startsWith('git checkout')), false, 'nothing was touched');
});

test('nothing to update says so', async () => {
  const { service } = makeService({ ...behindRemote, 'git ls-remote': ok(`${LOCAL}\trefs/heads/main\n`) });
  const result = await service.startUpdate(false);
  assert.equal(result.ok === false && result.code, 'no_update');
});

// ---- applying ----

test('a successful update pulls, builds, records the build, then restarts', async () => {
  const { service, calls, events } = makeService(behindRemote);
  assert.deepEqual(await service.startUpdate(false), { ok: true });
  await settle(service);

  const pull = calls.findIndex((call) => call === 'git pull --ff-only origin main');
  const build = calls.findIndex((call) => call === 'npm run build');
  assert.ok(pull !== -1 && build > pull, 'pulled, then built');
  assert.equal(calls.some((call) => call.startsWith('npm ci')), false, 'packages did not change');
  assert.deepEqual(events, ['stamp', 'restart']);
  assert.equal((await service.getStatus()).apply.state, 'restarting');
});

test('packages are installed first when package files changed', async () => {
  const { service, calls } = makeService({
    ...behindRemote,
    'git diff --name-only': ok('package-lock.json\nserver/src/index.ts\n'),
  });
  await service.startUpdate(false);
  await settle(service);
  const install = calls.findIndex((call) => call.startsWith('npm ci'));
  const build = calls.findIndex((call) => call === 'npm run build');
  assert.ok(install !== -1 && build > install);
});

test('when the install must wait for the restart, the server is stopped first and installs nothing itself', async () => {
  const { service, calls, events } = makeService(
    { ...behindRemote, 'git diff --name-only': ok('package-lock.json\nserver/src/index.ts\n') },
    { installPackagesDuringRestart: true }
  );
  await service.startUpdate(false);
  await settle(service);
  assert.equal(calls.some((call) => call.startsWith('npm ')), false, 'no npm while the server holds its native module');
  assert.deepEqual(events, ['restart-stop-first']);
  assert.equal((await service.getStatus()).apply.state, 'restarting');
});

test('a source-only update still builds in place even where installs wait for the restart', async () => {
  const { service, calls, events } = makeService(behindRemote, { installPackagesDuringRestart: true });
  await service.startUpdate(false);
  await settle(service);
  assert.ok(calls.includes('npm run build'));
  assert.deepEqual(events, ['stamp', 'restart']);
});

test('a deferred install that cannot restart is rolled back without reinstalling packages', async () => {
  const { service, calls } = makeService(
    { ...behindRemote, 'git diff --name-only': ok('package.json\n') },
    {
      installPackagesDuringRestart: true,
      restart: async () => {
        throw new Error('spawn ENOENT');
      },
    }
  );
  await service.startUpdate(false);
  await settle(service);
  assert.equal(calls.some((call) => call.startsWith('npm ci')), false);
});

test('only one update runs at a time', async () => {
  const { service } = makeService(behindRemote);
  assert.deepEqual(await service.startUpdate(false), { ok: true });
  const second = await service.startUpdate(false);
  assert.equal(second.ok === false && second.code, 'busy');
  await settle(service);
});

test('a failed download changes nothing and does not restart', async () => {
  const { service, calls, events } = makeService({
    ...behindRemote,
    'git pull': failed('fatal: Not possible to fast-forward'),
  });
  await service.startUpdate(false);
  await settle(service);

  const { apply } = await service.getStatus();
  assert.equal(apply.state, 'failed');
  assert.match(apply.error ?? '', /could not be downloaded.*Nothing was changed/);
  assert.equal(calls.some((call) => call.startsWith('git reset')), false, 'nothing to roll back');
  assert.deepEqual(events, []);
});

test('a failed build restores the previous version and does not restart', async () => {
  const { service, calls, events } = makeService({
    ...behindRemote,
    'npm run build': [failed('error TS2322: bad types'), ok()],
  });
  await service.startUpdate(false);
  await settle(service);

  const { apply } = await service.getStatus();
  assert.equal(apply.state, 'failed');
  assert.match(apply.error ?? '', /Building the new version failed.*error TS2322/s);
  assert.match(apply.error ?? '', /previous version was restored and is still running/);
  assert.ok(calls.includes(`git reset --hard ${LOCAL}`));
  assert.equal(calls.filter((call) => call === 'npm run build').length, 2, 'rebuilt the old version');
  assert.deepEqual(events, [], 'no restart, and no build stamp for a build that failed');
});

test('a failed package install restores the previous packages too', async () => {
  const { service, calls } = makeService({
    ...behindRemote,
    'git diff --name-only': ok('package.json\n'),
    'npm ci': [failed('ERESOLVE'), ok()],
  });
  await service.startUpdate(false);
  await settle(service);

  assert.equal(calls.filter((call) => call.startsWith('npm ci')).length, 2, 'installed again after the reset');
  assert.match((await service.getStatus()).apply.error ?? '', /previous version was restored/);
});

test('if restoring the old version cannot rebuild, the message says what to do', async () => {
  const { service } = makeService({ ...behindRemote, 'npm run build': failed('still broken') });
  await service.startUpdate(false);
  await settle(service);
  assert.match((await service.getStatus()).apply.error ?? '', /hiring-helper update/);
});

test('a restart that cannot be started is reported as a failure', async () => {
  const { service } = makeService(behindRemote, {
    restart: async () => {
      throw new Error('spawn ENOENT');
    },
  });
  await service.startUpdate(false);
  await settle(service);
  const { apply } = await service.getStatus();
  assert.equal(apply.state, 'failed');
  assert.match(apply.error ?? '', /could not restart itself.*ENOENT/);
});

// ---- failure summaries ----

test('the real npm cause is kept even though npm prefixes every line with "npm error"', () => {
  const summary = summarizeFailure({
    stdout: '',
    stderr: [
      'npm error code EBUSY',
      "npm error syscall rmdir",
      "npm error EBUSY: resource busy or locked, unlink 'C:\\app\\node_modules\\better-sqlite3\\build\\Release\\better_sqlite3.node'",
      'npm error A complete log of this run can be found in: C:\\logs',
    ].join('\n'),
  });
  assert.match(summary, /EBUSY/);
  assert.match(summary, /better_sqlite3\.node/);
  assert.doesNotMatch(summary, /^npm error/);
});

test('a failure with no recognisable error falls back to the readable lines', () => {
  assert.equal(summarizeFailure({ stdout: 'npm warn x\nsomething odd happened', stderr: '' }), 'something odd happened');
});

// ---- environment for git and npm ----

test('child commands do not inherit production mode, which would drop the dev packages the build needs', () => {
  const env = commandEnvironment({ NODE_ENV: 'production', npm_config_production: 'true', NPM_CONFIG_OMIT: 'dev', PATH: '/bin', HOME: '/h' });
  assert.equal(env.NODE_ENV, undefined);
  assert.equal(env.npm_config_production, undefined);
  assert.equal(env.NPM_CONFIG_OMIT, undefined);
  assert.equal(env.PATH, '/bin');
  assert.equal(env.HOME, '/h');
});

test('git is told never to stop and ask for a password', () => {
  assert.equal(commandEnvironment({}).GIT_TERMINAL_PROMPT, '0');
});

test('packages are installed with the development ones included', async () => {
  const { service, calls } = makeService({ ...behindRemote, 'git diff --name-only': ok('package-lock.json\n') });
  await service.startUpdate(false);
  await settle(service);
  assert.ok(calls.includes('npm ci --include=dev --no-audit --no-fund'));
});

// ---- reading failures ----

test('a build failure shows the compiler error, not npm boilerplate', () => {
  const summary = summarizeFailure({
    stdout: "src/utils/rate-limit.ts(30,14): error TS2322: Type 'string' is not assignable to type 'number'.\n",
    stderr: 'npm error Lifecycle script `build` failed with error:\nnpm error workspace server@1.0.0\nnpm error location /some/long/path\n',
  });
  assert.match(summary, /error TS2322/);
  assert.doesNotMatch(summary, /npm error/);
  assert.doesNotMatch(summary, /location/);
});

test('with no recognizable error line, the last lines of output are shown', () => {
  assert.equal(summarizeFailure({ stdout: 'one\ntwo\nthree', stderr: '' }), 'one | two | three');
});

test('a very long message is cut from the front, keeping the end', () => {
  const summary = summarizeFailure({ stdout: '', stderr: `error: ${'x'.repeat(2000)}END` });
  assert.ok(summary.length <= 401);
  assert.ok(summary.endsWith('END'));
});

test('a rolled-back release is offered again: present on disk is not the same as included', async () => {
  // A failed update leaves the remote commit downloaded; git says it is not part of this copy's history.
  const { service } = makeService({ ...behindRemote, 'git merge-base --is-ancestor': failed('') });
  assert.equal((await service.getStatus()).update.available, true);
});
