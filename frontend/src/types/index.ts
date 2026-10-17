// Core domain types for SHJAP Grievance Portal

export type UserRole = 'STUDENT' | 'DEPARTMENT_ADMIN' | 'COLLEGE_ADMIN' | 'UNIVERSITY_ADMIN' | 'MAIN_ADMIN';

export type ComplaintStatus =
  | 'SUBMITTED'
  | 'CATEGORIZED'
  | 'ASSIGNED'
  | 'UNDER_INVESTIGATION'
  | 'INFORMATION_REQUESTED'
  | 'ESCALATED'
  | 'RESOLUTION_PROPOSED'
  | 'RESOLVED'
  | 'CLOSED'
  | 'REJECTED';

export type ComplaintPriority = 'LOW' | 'MEDIUM' | 'HIGH' | 'URGENT';
export type SubmissionMode = 'ANONYMOUS' | 'VERIFIED';
export type EvidenceType = 'IMAGE' | 'PDF' | 'DOCUMENT' | 'OTHER';
export type NotificationType =
  | 'COMPLAINT_SUBMITTED'
  | 'COMPLAINT_ASSIGNED'
  | 'STATUS_CHANGED'
  | 'INFO_REQUESTED'
  | 'ADMIN_MESSAGE'
  | 'COMPLAINT_ESCALATED'
  | 'COMPLAINT_RESOLVED'
  | 'FEEDBACK_REQUESTED';

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  roles: UserRole[];
  mfaEnabled: boolean;
  isActive: boolean;
  lastLoginAt?: string;
  createdAt: string;
  studentProfile?: StudentProfile;
  adminProfile?: AdministratorProfile;
}

export interface StudentProfile {
  id: string;
  studentId: string;
  program?: string;
  year?: number;
  collegeId?: string;
  departmentId?: string;
}

export interface AdministratorProfile {
  id: string;
  employeeId: string;
  designation?: string;
  collegeId?: string;
  departmentId?: string;
  department?: Department;
  college?: College;
}

export interface College {
  id: string;
  name: string;
  code: string;
  description?: string;
  isActive: boolean;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  collegeId: string;
  college?: College;
  isActive: boolean;
}

export interface ComplaintCategory {
  id: string;
  name: string;
  code: string;
  description?: string;
  departmentId: string;
  department?: Department;
}

export interface Complaint {
  id: string;
  complaintNumber: string;
  trackingId: string;
  title: string;
  description: string;
  submissionMode: SubmissionMode;
  status: ComplaintStatus;
  priority: ComplaintPriority;
  isAnonymous: boolean;
  location?: string;
  additionalInfo?: string;
  category?: ComplaintCategory;
  department?: Department;
  submittedBy?: Partial<User>;
  assignedTo?: Partial<User>;
  statusHistory?: StatusHistory[];
  evidence?: Evidence[];
  assessments?: Assessment[];
  escalations?: Escalation[];
  resolution?: Resolution;
  trustScore?: TrustScore;
  feedback?: Feedback;
  messages?: Message[];
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
  closedAt?: string;
  _count?: { evidence: number; messages: number };
}

export interface StatusHistory {
  id: string;
  previousStatus?: ComplaintStatus;
  newStatus: ComplaintStatus;
  changedBy?: Partial<User>;
  reason?: string;
  changedAt: string;
}

export interface Evidence {
  id: string;
  fileName: string;
  originalName: string;
  fileSize: number;
  mimeType: string;
  type: EvidenceType;
  description?: string;
  isVerified: boolean;
  uploadedBy?: Partial<User>;
  createdAt: string;
}

export interface Assessment {
  id: string;
  investigationNotes?: string;
  evidenceAssessment?: string;
  findings?: string;
  recommendedAction?: string;
  resolutionDecision?: string;
  isInformationRequested: boolean;
  informationRequested?: string;
  assessedBy?: Partial<User>;
  createdAt: string;
  updatedAt: string;
}

export interface Escalation {
  id: string;
  reason: string;
  notes?: string;
  previousLevel: string;
  newLevel: string;
  escalatedBy?: Partial<User>;
  escalatedTo?: Partial<User>;
  reviewDecision?: string;
  reviewNotes?: string;
  reviewedAt?: string;
  createdAt: string;
}

export interface Resolution {
  id: string;
  summary: string;
  detailedResolution: string;
  actionTaken: string;
  resolutionDate: string;
  resolvedBy?: Partial<User>;
  createdAt: string;
}

export interface TrustScore {
  id: string;
  score?: number;
  status: 'PENDING' | 'LOW' | 'MEDIUM' | 'HIGH';
  evidenceIntegrity?: number;
  evidenceCompleteness?: number;
  historyConsistency?: number;
  processTransparency?: number;
  calculatedAt: string;
}

export interface Feedback {
  id: string;
  rating: number;
  comment?: string;
  isAnonymous: boolean;
  createdAt: string;
}

export interface Message {
  id: string;
  message: string;
  senderId: string;
  recipientId: string;
  sender?: Partial<User>;
  recipient?: Partial<User>;
  isRead: boolean;
  createdAt: string;
}

export interface Notification {
  id: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedComplaintId?: string;
  isRead: boolean;
  createdAt: string;
}

export interface AuditLog {
  id: string;
  actorId?: string;
  actorRole?: UserRole;
  action: string;
  entityType: string;
  entityId: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
  userAgent?: string;
  hash: string;
  previousHash?: string;
  createdAt: string;
  actor?: Partial<User>;
}

export interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination: {
    total: number;
    page: number;
    limit: number;
    totalPages: number;
    hasNext: boolean;
    hasPrev: boolean;
  };
}

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string;
}

export interface AnalyticsOverview {
  total: number;
  resolved: number;
  escalated: number;
  pending: number;
  resolutionRate: number;
  escalationRate: number;
  byStatus: Record<string, number>;
  byPriority: Record<string, number>;
}
