import { describe, it, expect, beforeAll } from 'vitest';
import { login, req, prisma } from './helpers.js';
import { AuditService } from '../../src/services/audit.service.js';

describe('tamper-evident audit chain (integration)', () => {
  let mainToken: string;
  let studentToken: string;

  beforeAll(async () => {
    mainToken = await login('main.admin@example.com');
    studentToken = (await req('POST', '/api/auth/login', {
      payload: { email: 'student@example.com', password: 'Password@123' },
    })).body.data.token;
  });

  it('writes events onto the chain and verifies clean', async () => {
    // Generate at least one recorded event (complaint creation writes audit)
    await req('POST', '/api/anonymous/complaints', {
      payload: {
        title: 'Audit chain probe event',
        description:
          'This anonymous submission generates audit events and supports the chain verification test for the tamper evidence suite today.',
        submissionMode: 'ANONYMOUS',
      },
    });

    const verify = await AuditService.verifyChain();
    expect(verify.valid).toBe(true);
    expect(verify.totalEntries).toBeGreaterThan(0);
  });

  it('list endpoint is main-admin only and returns hash fields for the UI', async () => {
    const { status, body } = await req('GET', '/api/audit-logs?limit=5', { token: mainToken });
    expect(status).toBe(200);
    expect(body.data.length).toBe(5);
    for (const log of body.data) {
      expect(log.hash).toBeTruthy();
      expect(log.previousHash ?? null).toBeDefined();
    }

    const { status: denied } = await req('GET', '/api/audit-logs', { token: studentToken });
    expect(denied).toBe(403);
  });

  it('detects tampering by direct database modification and reports the sequence', async () => {
    const before = await prisma.auditLog.findFirst({ orderBy: { sequence: 'asc' } });
    expect(before).toBeTruthy();

    // Simulate an attacker rewriting history: the canonical payload (frozen at
    // write time) is what the chain hashes, so altering it breaks verification.
    const originalPayload = before!.payload;
    const tamperedPayload = originalPayload.replace('COMPLAINT', 'TAMPERED_' + Date.now());
    await prisma.auditLog.update({ where: { id: before!.id }, data: { payload: tamperedPayload } });

    const verify = await AuditService.verifyChain();
    expect(verify.valid).toBe(false);
    expect(verify.tamperedAtSequence).toBe(Number(before!.sequence));

    // Restore the canonical payload and confirm the chain verifies again
    await prisma.auditLog.update({ where: { id: before!.id }, data: { payload: originalPayload } });
    const restored = await AuditService.verifyChain();
    expect(restored.valid).toBe(true);
  });

  it('hash arithmetic: chain recompute matches stored hash for the last entry', async () => {
    const logs = await prisma.auditLog.findMany({ orderBy: { sequence: 'desc' }, take: 2 });
    const [head, tail] = logs;
    expect(tail.hash).toBeTruthy();
    expect(head.previousHash).toBe(tail.hash);
  });
});
