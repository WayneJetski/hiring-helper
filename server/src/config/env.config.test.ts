import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readCredential } from './env.config.js';

describe('readCredential', () => {
  it('treats the .env.example placeholders as not configured', () => {
    assert.equal(readCredential('your_company_subdomain'), '');
    assert.equal(readCredential('your_api_key_here'), '');
  });

  it('treats missing and blank values as not configured', () => {
    assert.equal(readCredential(undefined), '');
    assert.equal(readCredential('   '), '');
  });

  it('keeps a real value, trimmed', () => {
    assert.equal(readCredential(' acme '), 'acme');
  });
});
