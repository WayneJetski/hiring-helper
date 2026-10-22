/**
 * Decides when a sync may start. One sync runs at a time; a request that arrives
 * mid-sync joins it, except a forced full sync that arrives during an incremental one:
 * that waits for the incremental to end and then runs, since joining would silently
 * skip the full fetch and the inactive-marking that only a full sync does.
 */

import { SingleFlight } from '../utils/single-flight.js';

export class SyncCoordinator<T> {
  private readonly flight = new SingleFlight<T>();
  private isRunningFullSync = false;

  get isRunning(): boolean {
    return this.flight.isRunning;
  }

  request(forceFull: boolean, run: () => Promise<T>): Promise<T> {
    if (forceFull && this.flight.isRunning && !this.isRunningFullSync) {
      return this.flight.whenIdle().then(() => this.request(true, run));
    }
    return this.flight.run(() => {
      this.isRunningFullSync = forceFull;
      return run();
    });
  }
}
