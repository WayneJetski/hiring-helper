/**
 * How the updater starts `hiring-helper restart`. Pure, so the Windows quoting is testable.
 */

import { join } from 'node:path';

export interface RestartCommand {
  file: string;
  args: string[];
  /** Pass the arguments to Windows exactly as written (cmd.exe does its own parsing). */
  windowsVerbatimArguments: boolean;
}

export function buildRestartCommand(
  repoRoot: string,
  isWindows: boolean,
  options: { stopFirst: boolean }
): RestartCommand {
  const restartArguments = ['restart', '--no-open', ...(options.stopFirst ? ['--stop-first'] : [])];

  if (!isWindows) {
    return { file: join(repoRoot, 'bin', 'hiring-helper'), args: restartArguments, windowsVerbatimArguments: false };
  }

  // A .cmd file must go through cmd.exe, which splits an unquoted path at the first space
  // (C:\Users\Jane Doe\...). With /s, cmd strips the outer pair of quotes and keeps the inner ones.
  const script = join(repoRoot, 'bin', 'hiring-helper.cmd');
  const commandLine = `"${script}" ${restartArguments.join(' ')}`;
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', `"${commandLine}"`], windowsVerbatimArguments: true };
}
