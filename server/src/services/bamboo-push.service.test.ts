/**
 * Unit tests for BambooPushService — the logic that pushes local status changes
 * back to BambooHR. Run with: npm run test --workspace=server
 *
 * These use in-memory fakes for the BambooHR client and the repositories, so no
 * network call and no database access happens. The fake client exposes ONLY
 * updateApplicationStatus and records every call, which lets us assert the
 * never-emails invariant structurally: the service cannot call an email path
 * because no such method exists, and the recorded calls are all status updates.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { BambooPushService } from './bamboo-push.service.js';
import type { ApplicationStatusWriter } from './bamboohr-status-writer.service.js';
import type {
  ApplicationsRepository,
  PendingStatusPush,
} from '../repositories/applications.repository.js';
import type { ContentUpdatesRepository } from '../repositories/content-updates.repository.js';

interface StatusCall {
  method: 'updateApplicationStatus';
  applicationId: number;
  statusId: number;
}

/**
 * Fake BambooHR client: records status-update calls and lets a test decide the
 * outcome per application id (resolve, or reject with a given error message).
 */
class FakeBambooHRService {
  calls: StatusCall[] = [];
  private failures = new Map<number, Error>();

  failOn(applicationId: number, error: Error): void {
    this.failures.set(applicationId, error);
  }

  async updateApplicationStatus(applicationId: number, statusId: number): Promise<void> {
    this.calls.push({ method: 'updateApplicationStatus', applicationId, statusId });
    const failure = this.failures.get(applicationId);
    if (failure) throw failure;
  }
}

/** Fake pending-push store: serves a fixed pending list and records reconciles. */
class FakeApplicationsRepo {
  reconciled: Array<{ id: number; statusId: number }> = [];
  constructor(private pending: PendingStatusPush[]) {}

  findPendingStatusPushes(jobId?: number): PendingStatusPush[] {
    // jobId scoping is exercised by the repository's SQL, not here; the service
    // simply forwards it. Return the seeded list unchanged.
    void jobId;
    return this.pending;
  }

  markStatusPushed(applicationId: number, pushedStatusId: number): void {
    this.reconciled.push({ id: applicationId, statusId: pushedStatusId });
  }

  restored: Array<{ id: number; statusId: number }> = [];
  restoreStatuses(entries: Array<{ id: number; statusId: number }>): number {
    this.restored.push(...entries);
    return entries.length;
  }
}

class FakeContentUpdatesRepo {
  created: Array<{ syncType?: string; applicationsSynced: number; notes?: string }> = [];
  create(update: { syncType?: string; applicationsSynced: number; notes?: string }): void {
    this.created.push(update);
  }
}

function pending(id: number, toStatusId: number): PendingStatusPush {
  return {
    id,
    name: `Candidate ${id}`,
    appliedDate: '2026-07-01',
    fromStatusId: 1,
    fromLabel: 'New',
    toStatusId,
    toLabel: `Status ${toStatusId}`,
  };
}

function makeService(
  pendingList: PendingStatusPush[],
  client = new FakeBambooHRService()
): {
  service: BambooPushService;
  client: FakeBambooHRService;
  repo: FakeApplicationsRepo;
  updates: FakeContentUpdatesRepo;
} {
  const repo = new FakeApplicationsRepo(pendingList);
  const updates = new FakeContentUpdatesRepo();
  const service = new BambooPushService(
    client as ApplicationStatusWriter,
    repo as unknown as ApplicationsRepository,
    updates as unknown as ContentUpdatesRepository
  );
  return { service, client, repo, updates };
}

test('pushes each pending status change and reconciles it', async () => {
  const { service, client, repo } = makeService([pending(101, 10), pending(102, 33)]);

  const result = await service.pushStatuses(45);

  assert.equal(result.total, 2);
  assert.equal(result.pushed, 2);
  assert.equal(result.failed, 0);
  assert.equal(result.rateLimited, false);
  assert.deepEqual(
    client.calls,
    [
      { method: 'updateApplicationStatus', applicationId: 101, statusId: 10 },
      { method: 'updateApplicationStatus', applicationId: 102, statusId: 33 },
    ],
    'each pending change is sent as a status update'
  );
  assert.deepEqual(repo.reconciled, [
    { id: 101, statusId: 10 },
    { id: 102, statusId: 33 },
  ]);
});

test('never emails candidates: the only BambooHR call is a status update', async () => {
  const { service, client } = makeService([pending(101, 10), pending(102, 33)]);

  await service.pushStatuses();

  // Structural guarantee: the client exposes no email/notify method at all.
  assert.equal(
    (client as unknown as { sendEmail?: unknown }).sendEmail,
    undefined,
    'fake client has no email method'
  );
  // And every recorded call is a status update — nothing candidate-facing.
  assert.ok(client.calls.length > 0);
  assert.ok(
    client.calls.every((c) => c.method === 'updateApplicationStatus'),
    'only status updates were sent'
  );
});

test('a rate limit (429) halts the run and returns partial progress', async () => {
  const client = new FakeBambooHRService();
  client.failOn(102, new Error('Request failed: 429 Too Many Requests'));
  const { service, repo, updates } = makeService(
    [pending(101, 10), pending(102, 33), pending(103, 15)],
    client
  );

  const result = await service.pushStatuses(45);

  assert.equal(result.pushed, 1, 'only the first change was pushed before the 429');
  assert.equal(result.rateLimited, true);
  assert.equal(client.calls.length, 2, 'stopped after the 429; the third was never attempted');
  assert.deepEqual(repo.reconciled, [{ id: 101, statusId: 10 }], 'only the success was reconciled');
  assert.equal(updates.created.length, 1);
  assert.equal(updates.created[0].syncType, 'rate_limited');
});

test('a non-rate-limit failure is recorded and the run continues', async () => {
  const client = new FakeBambooHRService();
  client.failOn(101, new Error('BambooHR 400 Bad Request'));
  const { service, repo } = makeService([pending(101, 10), pending(102, 33)], client);

  const result = await service.pushStatuses();

  assert.equal(result.pushed, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.rateLimited, false);
  const failed = result.results.find((r) => !r.ok);
  assert.ok(failed);
  assert.equal(failed?.id, 101);
  assert.match(failed?.error ?? '', /400/);
  assert.deepEqual(repo.reconciled, [{ id: 102, statusId: 33 }], 'the failed row is not reconciled');
});

test('ids filter restricts the push to the selected subset', async () => {
  const { service, client } = makeService([pending(101, 10), pending(102, 33), pending(103, 15)]);

  const result = await service.pushStatuses(45, [102]);

  assert.equal(result.total, 1);
  assert.equal(result.pushed, 1);
  assert.deepEqual(client.calls, [
    { method: 'updateApplicationStatus', applicationId: 102, statusId: 33 },
  ]);
});

test('previewPush reports the pending count and list', () => {
  const { service } = makeService([pending(101, 10), pending(102, 33)]);
  const preview = service.previewPush(45);
  assert.equal(preview.count, 2);
  assert.equal(preview.pending.length, 2);
});

test('discardPending puts each applicant back to the stage BambooHR has, without calling BambooHR', () => {
  const { service, client, repo } = makeService([pending(101, 10), pending(102, 33)]);

  const result = service.discardPending(45);

  assert.deepEqual(result, { discarded: 2, skipped: 0 });
  assert.deepEqual(repo.restored, [
    { id: 101, statusId: 1 },
    { id: 102, statusId: 1 },
  ]);
  assert.deepEqual(client.calls, [], 'rolling back is local only');
});

test('discardPending can roll back just a subset of applicants', () => {
  const { service, repo } = makeService([pending(101, 10), pending(102, 33), pending(103, 7)]);

  const result = service.discardPending(45, [102]);

  assert.deepEqual(result, { discarded: 1, skipped: 0 });
  assert.deepEqual(repo.restored, [{ id: 102, statusId: 1 }]);
});

test('discardPending skips a change whose BambooHR stage is unknown', () => {
  const unknownOrigin: PendingStatusPush = { ...pending(104, 9), fromStatusId: null };
  const { service, repo } = makeService([pending(101, 10), unknownOrigin]);

  const result = service.discardPending();

  assert.deepEqual(result, { discarded: 1, skipped: 1 });
  assert.deepEqual(repo.restored, [{ id: 101, statusId: 1 }]);
});
