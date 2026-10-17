import { FastifyInstance, FastifyReply } from 'fastify';
import { prisma } from '../config/database.js';
import { authenticate, getAuthUser, requireRole } from '../middleware/auth.middleware.js';
import { requireComplaintAccess, getComplaint } from '../middleware/complaint-access.middleware.js';
import { uploadFile, downloadFile, getDownloadUrl, deleteFile, scanFileContent, isS3Enabled } from '../services/storage.js';
import { AuditService } from '../services/audit.service.js';
import { TrustScoreService } from '../services/trust-score.service.js';
import { successResponse } from '../utils/response.js';
import { ValidationError, NotFoundError } from '../utils/errors.js';
import { sanitizeFilename } from '../utils/crypto.js';
import { config } from '../config/index.js';
import { EvidenceType, UserRole } from '@prisma/client';
import path from 'node:path';

const ADMIN_ROLES: UserRole[] = ['DEPARTMENT_ADMIN', 'COLLEGE_ADMIN', 'UNIVERSITY_ADMIN', 'MAIN_ADMIN'];

// Only files with one of these extensions may be uploaded; the declared
// content type must also match the extension family (defense in depth on
// top of content sniffing).
const EXTENSION_MIME_MAP: Record<string, string[]> = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.pdf': ['application/pdf'],
  '.doc': ['application/msword'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
};

function evidenceKindOf(mimeType: string): EvidenceType {
  if (mimeType.startsWith('image/')) return 'IMAGE';
  if (mimeType === 'application/pdf') return 'PDF';
  if (mimeType.startsWith('application/msword') || mimeType.includes('officedocument')) return 'DOCUMENT';
  return 'OTHER';
}

async function streamFile(reply: FastifyReply, buffer: Buffer, mimetype: string, fileName: string) {
  reply.header('Content-Type', mimetype);
  reply.header('Content-Disposition', `attachment; filename="${fileName.replace(/"/g, '')}"`);
  reply.header('Cache-Control', 'private, no-store');
  return reply.send(buffer);
}

export async function evidenceRoutes(app: FastifyInstance) {
  // POST /api/complaints/:id/evidence — multipart upload (student owner or admins)
  app.post('/:id/evidence', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const user = getAuthUser(request);

    if (complaint.isAnonymous) {
      throw new ValidationError('Evidence cannot be added to anonymous complaints after submission (identity would be exposed)');
    }

    const existingCount = await prisma.evidence.count({ where: { complaintId: complaint.id } });
    if (existingCount >= config.upload.maxFilesPerComplaint) {
      throw new ValidationError(`Maximum of ${config.upload.maxFilesPerComplaint} evidence files per complaint`);
    }

    const parts = request.parts();
    let fileBuf: Buffer | null = null;
    let mimetype = '';
    let filename = '';
    let description = '';

    for await (const part of parts) {
      if (part.type === 'file') {
        const chunks: Buffer[] = [];
        let totalSize = 0;
        for await (const chunk of part.file) {
          totalSize += chunk.length;
          if (totalSize > config.upload.maxFileSize) {
            throw new ValidationError(`File size exceeds the ${config.upload.maxFileSize / (1024 * 1024)}MB limit`);
          }
          chunks.push(chunk);
        }
        fileBuf = Buffer.concat(chunks);
        mimetype = part.mimetype;
        filename = part.filename;
      } else if (part.fieldname === 'description' && typeof part.value === 'string') {
        description = part.value.slice(0, 500);
      }
    }

    if (!fileBuf) throw new ValidationError('No file provided');

    // Extension whitelist: reject dangerous/commonly-blocked extensions outright
    const rawExt = path.extname(filename || '').toLowerCase();
    if (!EXTENSION_MIME_MAP[rawExt]) {
      throw new ValidationError(`File extension "${rawExt || 'unknown'}" is not allowed. Allowed extensions: ${Object.keys(EXTENSION_MIME_MAP).join(', ')}`);
    }

    if (!config.upload.allowedMimeTypes.includes(mimetype)) {
      throw new ValidationError(`File type not allowed. Allowed types: ${config.upload.allowedMimeTypes.join(', ')}`);
    }

    // Content validation / malware hook (magic bytes + optional external scanner)
    const scan = await scanFileContent(fileBuf, mimetype);
    if (!scan.safe) {
      throw new ValidationError(`File rejected: ${scan.reason ?? 'content validation failed'}`);
    }

    const safeFileName = sanitizeFilename(filename || 'evidence');

    // Extension whitelist + extension/declared-type agreement
    const ext = path.extname(safeFileName).toLowerCase();
    const extTypes = EXTENSION_MIME_MAP[ext];
    if (!extTypes) {
      throw new ValidationError(`File extension "${ext || 'unknown'}" is not allowed. Allowed extensions: ${Object.keys(EXTENSION_MIME_MAP).join(', ')}`);
    }
    if (!extTypes.includes(mimetype)) {
      throw new ValidationError(`Extension ${ext} does not match the declared content type "${mimetype}"`);
    }

    const upload = await uploadFile(fileBuf, safeFileName, mimetype, complaint.id);

    const evidence = await prisma.evidence.create({
      data: {
        complaintId: complaint.id,
        fileName: upload.filePath,
        originalName: safeFileName,
        filePath: upload.filePath,
        fileSize: fileBuf.length,
        mimeType: mimetype,
        type: evidenceKindOf(mimetype),
        description: description || undefined,
        uploadedById: user.id,
      },
    });

    await AuditService.log({
      actorId: user.id,
      actorRole: user.roles[0],
      action: 'EVIDENCE_UPLOADED',
      entityType: 'Evidence',
      entityId: evidence.id,
      newValue: { complaintId: complaint.id, fileName: safeFileName, fileSize: fileBuf.length },
      ipAddress: request.ip,
    });

    TrustScoreService.calculate(complaint.id);

    return reply.status(201).send(
      successResponse(
        {
          id: evidence.id,
          fileName: evidence.originalName,
          filePath: undefined,
          fileSize: evidence.fileSize,
          mimeType: evidence.mimeType,
          type: evidence.type,
          description: evidence.description,
          createdAt: evidence.createdAt,
        },
        'Evidence uploaded successfully'
      )
    );
  });

  // GET /api/complaints/:id/evidence — list evidence (no file contents, no server paths)
  app.get('/:id/evidence', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const evidence = await prisma.evidence.findMany({
      where: { complaintId: complaint.id },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true, originalName: true, fileSize: true,
        mimeType: true, type: true, description: true, isVerified: true,
        uploadedById: true, createdAt: true,
      },
    });
    return reply.send(successResponse(evidence));
  });

  // GET /api/complaints/:id/evidence/:evidenceId/download — authorized download
  app.get('/:id/evidence/:evidenceId/download', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const user = getAuthUser(request);
    const { evidenceId } = request.params as { evidenceId: string };

    const evidence = await prisma.evidence.findUnique({
      where: { id: evidenceId, complaintId: complaint.id },
    });
    if (!evidence) throw new NotFoundError('Evidence');

    // Additional hard gate: uploader, assigned admin, or higher roles
    const elevated = ADMIN_ROLES.includes(user.roles[0]) || user.roles.some((r) => ADMIN_ROLES.includes(r));
    const canAccess = evidence.uploadedById === user.id || elevated || complaint.assignedToId === user.id;
    if (!canAccess) {
      throw new ValidationError('Access denied to this evidence');
    }

    await AuditService.log({
      actorId: user.id,
      actorRole: user.roles[0],
      action: 'EVIDENCE_ACCESSED',
      entityType: 'Evidence',
      entityId: evidence.id,
      newValue: { complaintId: complaint.id },
      ipAddress: request.ip,
    });

    if (isS3Enabled()) {
      const url = await getDownloadUrl(evidence.filePath, 900);
      if (!url) throw new NotFoundError('File unavailable');
      return reply.send(successResponse({ downloadUrl: url, expiresIn: 900 }));
    }

    const buffer = await downloadFile(evidence.filePath);
    return streamFile(reply, buffer, evidence.mimeType, evidence.originalName);
  });

  // POST /api/complaints/:id/evidence/:evidenceId/verify — admins mark evidence verified
  app.post('/:id/evidence/:evidenceId/verify', { preHandler: [authenticate, requireRole(...ADMIN_ROLES), requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const user = getAuthUser(request);
    const { evidenceId } = request.params as { evidenceId: string };

    const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId, complaintId: complaint.id } });
    if (!evidence) throw new NotFoundError('Evidence');

    const updated = await prisma.evidence.update({
      where: { id: evidence.id },
      data: { isVerified: true, verifiedAt: new Date(), verifiedById: user.id },
    });

    await AuditService.log({
      actorId: user.id,
      actorRole: user.roles[0],
      action: 'ASSESSMENT',
      entityType: 'Evidence',
      entityId: evidence.id,
      newValue: { isVerified: true },
      ipAddress: request.ip,
    });

    TrustScoreService.calculate(complaint.id);

    return reply.send(successResponse({ id: updated.id, isVerified: updated.isVerified }, 'Evidence verified'));
  });

  // DELETE /api/complaints/:id/evidence/:evidenceId — uploader or MAIN_ADMIN
  app.delete('/:id/evidence/:evidenceId', { preHandler: [authenticate, requireComplaintAccess] }, async (request, reply) => {
    const complaint = getComplaint(request);
    const user = getAuthUser(request);
    const { evidenceId } = request.params as { evidenceId: string };

    const evidence = await prisma.evidence.findUnique({ where: { id: evidenceId, complaintId: complaint.id } });
    if (!evidence) throw new NotFoundError('Evidence');

    const canDelete = evidence.uploadedById === user.id || user.roles[0] === 'MAIN_ADMIN';
    if (!canDelete) throw new ValidationError('You cannot delete this evidence');

    await deleteFile(evidence.filePath).catch(() => undefined);
    await prisma.evidence.delete({ where: { id: evidence.id } });

    await AuditService.log({
      actorId: user.id,
      actorRole: user.roles[0],
      action: 'EVIDENCE_DELETED',
      entityType: 'Evidence',
      entityId: evidence.id,
      previousValue: { fileName: evidence.originalName },
      newValue: { deleted: true },
      ipAddress: request.ip,
    });

    TrustScoreService.calculate(complaint.id);
    return reply.send(successResponse(null, 'Evidence deleted'));
  });
}
