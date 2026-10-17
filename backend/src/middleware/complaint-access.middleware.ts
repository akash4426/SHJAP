import { FastifyRequest } from 'fastify';
import { prisma } from '../config/database.js';
import { getAuthUser } from './auth.middleware.js';
import { AccessControlService } from '../services/access-control.service.js';
import { NotFoundError } from '../utils/errors.js';
import type { Complaint } from '@prisma/client';

interface LoadedComplaint extends Complaint {
  department: { name: string; code: string; collegeId: string } | null;
  category: { name: string; code: string } | null;
}

const complaintStore = new WeakMap<object, LoadedComplaint>();

/**
 * preHandler: loads the complaint by :id and enforces role-based access
 * through AccessControlService. Attaches the complaint for the handler.
 */
export async function requireComplaintAccess(request: FastifyRequest, errReply?: unknown): Promise<LoadedComplaint> {
  const user = getAuthUser(request);
  const { id } = request.params as { id: string };

  const complaint = (await prisma.complaint.findUnique({
    where: { id },
    include: {
      department: { select: { name: true, code: true, collegeId: true } },
      category: { select: { name: true, code: true } },
    },
  })) as LoadedComplaint | null;

  if (!complaint || complaint.deletedAt) {
    throw new NotFoundError('Complaint');
  }

  await AccessControlService.assertComplaintAccess(user, complaint);

  complaintStore.set(request, complaint);
  return complaint;
}

/** Retrieve the complaint attached by requireComplaintAccess */
export function getComplaint(request: FastifyRequest): LoadedComplaint {
  const complaint = complaintStore.get(request);
  if (!complaint) throw new NotFoundError('Complaint');
  return complaint;
}

export type { LoadedComplaint };
