import { prisma } from '../config/database.js';
import { sha256 } from '../utils/crypto.js';
import { AuditAction, UserRole } from '@prisma/client';
import { logger } from '../utils/logger.js';

const auditLogger = logger.child({ service: 'audit' });

interface AuditEventParams {
  actorId?: string;
  actorRole?: UserRole;
  action: AuditAction;
  entityType: string;
  entityId: string;
  previousValue?: object;
  newValue?: object;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Tamper-evident, append-only audit logging.
 *
 *   payload = canonical JSON string of the event data (frozen at write time,
 *             NOT re-serialized from jsonb on read — see payload column)
 *   hash    = SHA256(previousHash + payload)
 *
 * The chain is ordered by an auto-incrementing sequence so parallel writers
 * cannot break the link discovered by verification. Rows are never updated
 * or deleted by the application (no update/delete code paths exist).
 */
export class AuditService {
  /**
   * In-process serialization for chain writes: each log must read the latest
   * hash AFTER the previous write commits, or concurrent writers would both
   * link to the same parent and break verification ordering. (For a
   * multi-instance deployment this would need a DB-level advisory lock; the
   * single-container deployment target makes the queue sufficient here.)
   */
  private static queue: Promise<void> = Promise.resolve();

  static log(params: AuditEventParams): Promise<void> {
    const task = this.queue
      .then(() => this.writeEvent(params))
      .catch((error) => {
        // Audit logging must never crash the application
        auditLogger.error({ err: error }, 'Audit log write failed');
      });
    this.queue = task;
    return task;
  }

  private static async writeEvent(params: AuditEventParams): Promise<void> {
    const latest = await prisma.auditLog.findFirst({
      orderBy: { sequence: 'desc' },
      select: { hash: true },
    });

    const previousHash = latest?.hash ?? null;

    const payload = JSON.stringify({
      actorId: params.actorId ?? null,
      actorRole: params.actorRole ?? null,
      action: params.action,
      entityType: params.entityType,
      entityId: params.entityId,
      previousValue: params.previousValue ?? null,
      newValue: params.newValue ?? null,
      timestamp: new Date().toISOString(),
    });

    const hash = sha256((previousHash ?? '') + payload);

    await prisma.auditLog.create({
      data: {
        actorId: params.actorId,
        actorRole: params.actorRole,
        action: params.action,
        entityType: params.entityType,
        entityId: params.entityId,
        previousValue: params.previousValue,
        newValue: params.newValue,
        payload,
        ipAddress: params.ipAddress,
        userAgent: params.userAgent,
        hash,
        previousHash,
      },
    });
  }

  /** Verify the hash chain; reports the first broken link, if any */
  static async verifyChain(): Promise<{ valid: boolean; totalEntries: number; tamperedAtSequence?: number }> {
    const logs = await prisma.auditLog.findMany({
      orderBy: { sequence: 'asc' },
      select: { sequence: true, hash: true, previousHash: true, payload: true },
    });

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const previousHash = i === 0 ? null : logs[i - 1].hash;

      // Byte-exact recomputation from the stored canonical payload
      const expectedHash = sha256((previousHash ?? '') + log.payload);

      if (expectedHash !== log.hash) {
        return { valid: false, totalEntries: logs.length, tamperedAtSequence: Number(log.sequence) };
      }
      if (i > 0 && log.previousHash !== logs[i - 1].hash) {
        return { valid: false, totalEntries: logs.length, tamperedAtSequence: Number(log.sequence) };
      }
      if (i === 0 && log.previousHash !== null) {
        return { valid: false, totalEntries: logs.length, tamperedAtSequence: Number(log.sequence) };
      }
    }

    return { valid: true, totalEntries: logs.length };
  }
}
