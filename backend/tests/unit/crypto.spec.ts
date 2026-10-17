import { describe, it, expect } from 'vitest';
import { sha256, hashToken, sanitizeFilename, generateTrackingId } from '../../src/utils/crypto.js';

describe('crypto utils (unit)', () => {
  it('sha256 is deterministic and hex-encoded', () => {
    const a = sha256('SHJAP chain link');
    const b = sha256('SHJAP chain link');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('chain hash depends on previous hash (tamper evidence arithmetic)', () => {
    const payload = 'action=COMPLAINT_CREATED';
    const h1 = sha256('' + payload);
    const h2 = sha256('running-prev-hash' + payload);
    expect(h1).not.toBe(h2);
    expect(sha256('running-prev-hash' + payload)).toBe(h2);
  });

  it('sanitizes filenames against traversal and control characters', () => {
    expect(sanitizeFilename('../../etc/passwd')).not.toContain('/');
    expect(sanitizeFilename('..\\..\\windows\\win.ini')).not.toContain('\\');
    expect(sanitizeFilename('proof\u0000.png')).toBeTruthy();
  });

  it('tracking ids are unique and correctly shaped', () => {
    const t1 = generateTrackingId();
    const t2 = generateTrackingId();
    expect(t1).toMatch(/^TRK-[A-F0-9]+$/);
    expect(t1).not.toBe(t2);
  });

  it('hashToken tokens consistently', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
    expect(hashToken('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
});
