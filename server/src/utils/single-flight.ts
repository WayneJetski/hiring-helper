/**
 * Runs a task at most once at a time: a caller that arrives while it is running gets
 * the same promise instead of starting a second run.
 */
const noop = (): void => {};

export class SingleFlight<T> {
  private current: Promise<T> | null = null;

  get isRunning(): boolean {
    return this.current !== null;
  }

  /** Resolves once the current run (if any) has ended, whether it succeeded or failed. */
  whenIdle(): Promise<void> {
    return this.current ? this.current.then(noop, noop) : Promise.resolve();
  }

  run(task: () => Promise<T>): Promise<T> {
    if (this.current) return this.current;
    const running = task().finally(() => {
      this.current = null;
    });
    this.current = running;
    return running;
  }
}
