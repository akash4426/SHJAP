import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Storage driver resolution tests.
 *
 * The storage service picks its driver from configuration at call time:
 *   supabase  → STORAGE_DRIVER=supabase + SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 *   s3        → STORAGE_DRIVER=s3
 *   local     → everything else (default, and graceful fallback when a
 *               Supabase driver is requested without credentials)
 */

const ENV_KEYS = [
  'STORAGE_DRIVER',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY',
  'S3_BUCKET',
] as const;

const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

async function loadStorage(env: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  Object.assign(process.env, env);
  vi.resetModules();
  return import('../../src/services/storage.js');
}

describe('storage driver resolution', () => {
  it('defaults to the private local directory', async () => {
    const { getStorageDriver, usesRemoteStorage } = await loadStorage({});
    expect(getStorageDriver()).toBe('local');
    expect(usesRemoteStorage()).toBe(false);
  });

  it('selects supabase when URL + service-role key are present', async () => {
    const { getStorageDriver, usesRemoteStorage } = await loadStorage({
      STORAGE_DRIVER: 'supabase',
      SUPABASE_URL: 'https://example.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'service-role-test-key',
    });
    expect(getStorageDriver()).toBe('supabase');
    expect(usesRemoteStorage()).toBe(true);
  });

  it('falls back to local when supabase is requested without credentials', async () => {
    const { getStorageDriver, usesRemoteStorage } = await loadStorage({
      STORAGE_DRIVER: 'supabase',
      SUPABASE_URL: 'https://example.supabase.co',
    });
    expect(getStorageDriver()).toBe('local');
    expect(usesRemoteStorage()).toBe(false);
  });

  it('selects s3 when configured', async () => {
    const { getStorageDriver, usesRemoteStorage } = await loadStorage({
      STORAGE_DRIVER: 's3',
      S3_BUCKET: 'shjap-evidence',
    });
    expect(getStorageDriver()).toBe('s3');
    expect(usesRemoteStorage()).toBe(true);
  });
});
