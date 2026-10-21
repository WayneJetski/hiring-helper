/**
 * Update Service
 *
 * Tells the app whether a newer version is on the install's git remote, and applies
 * it when the person asks: pull, install packages if they changed, build, restart.
 *
 * Only an install made by the installer (started through `hiring-helper`, which sets
 * HIRING_HELPER_MANAGED) can update itself; a developer's checkout never does.
 *
 * "Newer" means the remote branch the install follows has a commit this copy does
 * not have. Nothing here ever happens on its own: checking is read-only, and applying
 * is always a person's click. Every side effect (git, npm, restart) is injected so
 * the whole sequence, including rolling back a failed update, is testable.
 */

export interface CommandResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string; timeoutMs: number }
) => Promise<CommandResult>;

export type ApplyState = 'idle' | 'updating' | 'restarting' | 'failed';

export interface UpdateStatus {
  /** Version from package.json. */
  currentVersion: string;
  currentCommit: string | null;
  branch: string | null;
  /** Installed and started by `hiring-helper`, so it may update itself. */
  isManagedInstall: boolean;
  update: {
    available: boolean;
    latestCommit: string | null;
    /** A page showing what changed, when the remote is on GitHub. */
    compareUrl: string | null;
    checkedAt: string | null;
    /** Why no answer could be given (offline, not a git install). */
    error: string | null;
  };
  apply: {
    state: ApplyState;
    step: string | null;
    error: string | null;
    startedAt: string | null;
  };
}

export type StartUpdateResult =
  | { ok: true }
  | {
      ok: false;
      code: 'not_managed' | 'busy' | 'scoring_running' | 'local_changes' | 'no_update';
      message: string;
    };

export interface UpdateServiceDeps {
  repoRoot: string;
  run: CommandRunner;
  isManagedInstall: boolean;
  readVersion: () => string;
  /**
   * Windows cannot replace a native module the running server has loaded, so `npm ci` must
   * wait until the server is stopped. When true and packages changed, the install and build
   * are left to the restart, which stops the server first.
   */
  installPackagesDuringRestart: boolean;
  /**
   * Start the detached restart; rejects if it could not be started. `stopFirst` asks it to
   * stop this server before it installs and builds.
   */
  restart: (options: { stopFirst: boolean }) => Promise<void>;
  /** Record that the build is current, so the restart does not build again. */
  writeBuildStamp: () => Promise<void>;
  now: () => number;
  /** How long a check stays fresh. */
  checkCacheMs: number;
}

const GIT_NETWORK_TIMEOUT_MS = 15_000;
const GIT_LOCAL_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const ERROR_TAIL_CHARS = 400;
/** Tracked files that npm may rewrite by itself; changes to them never block an update. */
const GENERATED_FILES = ['package-lock.json'];

interface CheckResult {
  currentCommit: string | null;
  branch: string | null;
  available: boolean;
  latestCommit: string | null;
  compareUrl: string | null;
  error: string | null;
}

/**
 * The environment for git and npm run by the updater. The server itself runs with
 * NODE_ENV=production, and a child inheriting that would make `npm ci` skip the
 * development packages (TypeScript, Vite) that the build needs. Git must never stop to
 * ask for a password, since nobody is there to answer.
 */
export function commandEnvironment(parent: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...parent, GIT_TERMINAL_PROMPT: '0' };
  delete env.NODE_ENV;
  delete env.npm_config_production;
  delete env.NPM_CONFIG_PRODUCTION;
  delete env.npm_config_omit;
  delete env.NPM_CONFIG_OMIT;
  return env;
}

const shortSha = (sha: string): string => sha.slice(0, 7);

/**
 * What went wrong, from a command's output, for a person to read. Compiler and runtime
 * errors are picked out; npm's own boilerplate ("npm error workspace ...") is dropped.
 */
export function summarizeFailure(result: Pick<CommandResult, 'stdout' | 'stderr'>): string {
  const lines = `${result.stdout}\n${result.stderr}`
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
  // npm reports the real cause (EBUSY, EPERM, ERESOLVE) on its own "npm error" lines, so look
  // for it before dropping that prefix; only the generic remainder is boilerplate.
  const errorLines = lines
    .filter((line) => /error TS\d+|error:|SyntaxError|Cannot find|ERESOLVE|ENOENT|EACCES|EBUSY|EPERM|EEXIST|ENOSPC/i.test(line))
    .map((line) => line.replace(/^npm (error|ERR!)\s*/i, ''));
  const readable = lines.filter((line) => !/^npm (error|ERR!|notice|warn)/i.test(line));
  const chosen = (errorLines.length > 0 ? errorLines : readable).slice(-4).join(' | ');
  return chosen.length <= ERROR_TAIL_CHARS ? chosen : `…${chosen.slice(-ERROR_TAIL_CHARS)}`;
}

/**
 * A GitHub "what changed" link between two commits, from the remote's address.
 * Handles https, ssh and scp-style GitHub remotes; any other host gives null.
 */
export function buildCompareUrl(originUrl: string, fromSha: string, toSha: string): string | null {
  const match = /github\.com[:/]+([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(originUrl.trim());
  if (!match) return null;
  return `https://github.com/${match[1]}/${match[2]}/compare/${shortSha(fromSha)}...${shortSha(toSha)}`;
}

export class UpdateService {
  private cachedCheck: CheckResult | null = null;
  private cachedAtMs = 0;
  private isUpdating = false;
  private apply: UpdateStatus['apply'] = { state: 'idle', step: null, error: null, startedAt: null };

  constructor(private readonly deps: UpdateServiceDeps) {}

  async getStatus(options: { refresh?: boolean } = {}): Promise<UpdateStatus> {
    const check = await this.checkForUpdate(options.refresh === true);
    return {
      currentVersion: this.deps.readVersion(),
      currentCommit: check.currentCommit,
      branch: check.branch,
      isManagedInstall: this.deps.isManagedInstall,
      update: {
        available: check.available,
        latestCommit: check.latestCommit,
        compareUrl: check.compareUrl,
        checkedAt: this.cachedAtMs === 0 ? null : new Date(this.cachedAtMs).toISOString(),
        error: check.error,
      },
      apply: { ...this.apply },
    };
  }

  /**
   * Check the remote, reusing a recent answer. Only managed installs are checked at
   * all (a developer's checkout never reaches out), and nothing is checked mid-update.
   */
  private async checkForUpdate(refresh: boolean): Promise<CheckResult> {
    const isFresh = this.cachedCheck !== null && this.deps.now() - this.cachedAtMs < this.deps.checkCacheMs;
    if (this.cachedCheck !== null && (isFresh || this.isUpdating) && !refresh) return this.cachedCheck;
    if (!this.deps.isManagedInstall) {
      return { currentCommit: null, branch: null, available: false, latestCommit: null, compareUrl: null, error: null };
    }

    const result = await this.readRemote();
    this.cachedCheck = result;
    this.cachedAtMs = this.deps.now();
    return result;
  }

  private git(args: string[], timeoutMs = GIT_LOCAL_TIMEOUT_MS): Promise<CommandResult> {
    return this.deps.run('git', args, { cwd: this.deps.repoRoot, timeoutMs });
  }

  private async readRemote(): Promise<CheckResult> {
    const none = { currentCommit: null, branch: null, available: false, latestCommit: null, compareUrl: null };
    const head = await this.git(['rev-parse', 'HEAD']);
    if (!head.ok) {
      return { ...none, error: 'This copy of Hiring Helper was not installed with git, so it cannot check for updates.' };
    }
    const localSha = head.stdout.trim();
    const branchResult = await this.git(['rev-parse', '--abbrev-ref', 'HEAD']);
    const branch = branchResult.ok ? branchResult.stdout.trim() : '';
    const base = { ...none, currentCommit: shortSha(localSha), branch: branch || null };
    if (branch === '' || branch === 'HEAD') {
      return { ...base, error: 'This copy is not on a branch, so it cannot check for updates.' };
    }

    const remote = await this.git(['ls-remote', 'origin', `refs/heads/${branch}`], GIT_NETWORK_TIMEOUT_MS);
    if (!remote.ok) return { ...base, error: 'Could not reach the update server to check for updates.' };
    const remoteSha = remote.stdout.trim().split(/\s+/)[0] ?? '';
    if (remoteSha === '') return { ...base, error: `The update server has no "${branch}" branch.` };

    // Up to date or ahead when the remote's newest commit is already part of this copy's history.
    // (Not merely "present on disk": a failed update leaves the commit downloaded but not applied.)
    const isRemoteIncluded = (await this.git(['merge-base', '--is-ancestor', remoteSha, 'HEAD'])).ok;
    const available = remoteSha !== localSha && !isRemoteIncluded;
    if (!available) return { ...base, latestCommit: shortSha(remoteSha), error: null };

    const origin = await this.git(['config', '--get', 'remote.origin.url']);
    return {
      ...base,
      available: true,
      latestCommit: shortSha(remoteSha),
      compareUrl: origin.ok ? buildCompareUrl(origin.stdout, localSha, remoteSha) : null,
      error: null,
    };
  }

  /** Begin updating in the background. Check `getStatus().apply` for progress. */
  async startUpdate(isScoringRunning: boolean): Promise<StartUpdateResult> {
    if (!this.deps.isManagedInstall) {
      return {
        ok: false,
        code: 'not_managed',
        message: 'This copy was not started with the hiring-helper command, so it cannot update itself.',
      };
    }
    if (this.isUpdating) {
      return { ok: false, code: 'busy', message: 'An update is already in progress.' };
    }
    if (isScoringRunning) {
      return {
        ok: false,
        code: 'scoring_running',
        message: 'Scoring is running. Wait for it to finish (or cancel it), then update.',
      };
    }

    const changes = await this.git(['status', '--porcelain', '--untracked-files=no']);
    if (changes.ok) {
      const changedPaths = changes.stdout
        .split('\n')
        .map((line) => line.slice(3).trim())
        .filter((path) => path !== '');
      if (changedPaths.some((path) => !GENERATED_FILES.includes(path))) {
        return {
          ok: false,
          code: 'local_changes',
          message: 'This copy has local changes, so it cannot be updated automatically.',
        };
      }
      // Files a tool rewrites on its own are not the person's changes; put them back so the pull is clean.
      if (changedPaths.length > 0) await this.git(['checkout', '--', ...changedPaths]);
    }

    const check = await this.checkForUpdate(true);
    if (!check.available) {
      return { ok: false, code: 'no_update', message: check.error ?? 'You already have the latest version.' };
    }

    this.isUpdating = true;
    this.apply = { state: 'updating', step: 'Starting', error: null, startedAt: new Date(this.deps.now()).toISOString() };
    void this.runUpdate();
    return { ok: true };
  }

  private setStep(step: string): void {
    this.apply = { ...this.apply, step };
  }

  private fail(message: string): void {
    this.apply = { ...this.apply, state: 'failed', step: null, error: message };
    this.isUpdating = false;
  }

  private async runUpdate(): Promise<void> {
    const { repoRoot, run } = this.deps;
    let previousSha = '';
    let hasTouchedPackages = false;

    try {
      previousSha = (await this.git(['rev-parse', 'HEAD'])).stdout.trim();
      const branch = (await this.git(['rev-parse', '--abbrev-ref', 'HEAD'])).stdout.trim();

      this.setStep('Downloading the update');
      const pull = await this.git(['pull', '--ff-only', 'origin', branch], GIT_NETWORK_TIMEOUT_MS * 4);
      if (!pull.ok) {
        this.fail(`The update could not be downloaded. Nothing was changed. ${summarizeFailure(pull)}`);
        return;
      }

      const changed = await this.git(['diff', '--name-only', previousSha, 'HEAD']);
      const packagesChanged = /(^|\/)package(-lock)?\.json$/m.test(changed.stdout);
      const isInstallDeferred = packagesChanged && this.deps.installPackagesDuringRestart;

      if (packagesChanged && !isInstallDeferred) {
        this.setStep('Installing packages');
        hasTouchedPackages = true;
        const install = await run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: repoRoot, timeoutMs: INSTALL_TIMEOUT_MS });
        if (!install.ok) {
          await this.rollBack(previousSha, hasTouchedPackages, `Installing the new packages failed. ${summarizeFailure(install)}`);
          return;
        }
      }

      if (!isInstallDeferred) {
        this.setStep('Building the new version');
        const build = await run('npm', ['run', 'build'], { cwd: repoRoot, timeoutMs: BUILD_TIMEOUT_MS });
        if (!build.ok) {
          await this.rollBack(previousSha, hasTouchedPackages, `Building the new version failed. ${summarizeFailure(build)}`);
          return;
        }
        await this.deps.writeBuildStamp();
      }

      this.setStep('Restarting');
      this.apply = { ...this.apply, state: 'restarting' };
      this.cachedCheck = null; // the next status reflects the new version
      await this.deps.restart({ stopFirst: isInstallDeferred });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      if (previousSha !== '' && this.apply.state === 'updating') {
        await this.rollBack(previousSha, hasTouchedPackages, `The update stopped unexpectedly. ${reason}`);
      } else {
        this.fail(`The app could not restart itself. ${reason}`);
      }
    }
  }

  /** Put the previous version back, so a failed update leaves the app working. */
  private async rollBack(previousSha: string, hasTouchedPackages: boolean, reason: string): Promise<void> {
    const { repoRoot, run } = this.deps;
    this.setStep('Restoring the previous version');
    const reset = await this.git(['reset', '--hard', previousSha]);
    if (!reset.ok) {
      this.fail(`${reason} Restoring the previous version also failed: ${summarizeFailure(reset)}`);
      return;
    }
    if (hasTouchedPackages) {
      await run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: repoRoot, timeoutMs: INSTALL_TIMEOUT_MS });
    }
    const rebuild = await run('npm', ['run', 'build'], { cwd: repoRoot, timeoutMs: BUILD_TIMEOUT_MS });
    this.cachedCheck = null;
    this.fail(
      rebuild.ok
        ? `${reason} Your previous version was restored and is still running.`
        : `${reason} Restoring the previous version did not finish building; run "hiring-helper update" from a terminal.`
    );
  }
}
