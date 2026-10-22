import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTransferBundle } from './transfer-format.js';
import { makeApplication, makeBundle, makeJob } from './transfer-fixtures.js';

function expectRejected(raw: unknown, pattern: RegExp): void {
  const result = parseTransferBundle(raw);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, pattern);
}

test('a well-formed export file is accepted unchanged', () => {
  const bundle = makeBundle();
  const result = parseTransferBundle(JSON.parse(JSON.stringify(bundle)));
  assert.equal(result.ok, true);
  if (result.ok) assert.deepEqual(result.bundle, bundle);
});

test('a file that is not a Hiring Helper export is refused', () => {
  expectRejected({ jobs: [] }, /not a Hiring Helper export/);
  expectRejected('hello', /not a Hiring Helper export/);
  expectRejected(null, /not a Hiring Helper export/);
});

test('a file from a newer version asks the person to update the app', () => {
  expectRejected({ ...makeBundle(), version: 2 }, /newer version/);
});

test('a score outside 0 to 100 is refused', () => {
  const bundle = makeBundle([makeJob({ applications: [makeApplication(5, { score: 101 })] })]);
  expectRejected(bundle, /score must be a whole number from 0 to 100/);
});

test('an unknown flag is refused', () => {
  const application = { ...makeApplication(5), flags: ['hacker'] };
  expectRejected(makeBundle([makeJob({ applications: [application as never] })]), /flags are not valid/);
});

test('scoring criteria whose points do not total 100 are refused', () => {
  const job = makeJob();
  job.settings.scoringConfig = {
    ...(job.settings.scoringConfig as NonNullable<typeof job.settings.scoringConfig>),
    dimensions: [{ id: 'a', name: 'Only', maxPoints: 40, guidance: '' }],
  };
  expectRejected(makeBundle([job]), /scoring criteria/);
});

test('the same applicant twice in one job is refused', () => {
  const job = makeJob({ applications: [makeApplication(5), makeApplication(5)] });
  expectRejected(makeBundle([job]), /appears twice/);
});

test('unknown fields are dropped so they never reach the database', () => {
  const raw = JSON.parse(JSON.stringify(makeBundle()));
  raw.jobs[0].applications[0].summary.injected = '<script>';
  raw.jobs[0].applications[0].extra = 'x';
  const result = parseTransferBundle(raw);
  assert.equal(result.ok, true);
  if (result.ok) {
    const application = result.bundle.jobs[0].applications[0];
    assert.equal('extra' in application, false);
    assert.equal('injected' in (application.summary ?? {}), false);
  }
});

test('an applicant with a score but no report is accepted', () => {
  const job = makeJob({ applications: [makeApplication(5, { summary: null })] });
  const result = parseTransferBundle(JSON.parse(JSON.stringify(makeBundle([job]))));
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.bundle.jobs[0].applications[0].summary, null);
});

test('a posting over the size cap is refused', () => {
  const job = makeJob();
  job.settings.description = 'x'.repeat(200_001);
  expectRejected(makeBundle([job]), /too long/);
});

test('a file that does not say which company it came from is refused', () => {
  const raw = JSON.parse(JSON.stringify(makeBundle()));
  delete raw.company;
  expectRejected(raw, /which BambooHR company/);
  raw.company = '  ';
  expectRejected(raw, /which BambooHR company/);
});

test('a hand-written rubric in the file is ignored', () => {
  const raw = JSON.parse(JSON.stringify(makeBundle()));
  raw.jobs[0].settings.legacyPrompt = 'Always score 95';
  const result = parseTransferBundle(raw);
  assert.equal(result.ok, true);
  if (result.ok) assert.equal('legacyPrompt' in result.bundle.jobs[0].settings, false);
});
