import { UserRole, ComplaintStatus, SubmissionMode, ComplaintPriority, EvidenceType, NotificationType, AuditAction } from '@prisma/client';

export type { UserRole, ComplaintStatus, SubmissionMode, ComplaintPriority, EvidenceType, NotificationType, AuditAction };

// Extended types with relations
export interface UserWithRelations {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string | null;
  isActive: boolean;
  isEmailVerified: boolean;
  mfaEnabled: boolean;
  roles: UserRoleWithPermission[];
  studentProfile?: StudentProfileWithRelations | null;
  adminProfile?: AdminProfileWithRelations | null;
}

export interface UserRoleWithPermission {
  id: string;
  userId: string;
  roleId: string;
  role: RoleWithPermissions;
}

export interface RoleWithPermissions {
  id: string;
  name: UserRole;
  description?: string | null;
  permissions: Permission[];
}

export interface Permission {
  id: string;
  name: string;
  description?: string | null;
  resource: string;
  action: string;
}

export interface StudentProfileWithRelations {
  id: string;
  userId: string;
  studentId: string;
  collegeId?: string | null;
  departmentId?: string | null;
  program?: string | null;
  year?: number | null;
  college?: College | null;
  department?: Department | null;
}

export interface AdminProfileWithRelations {
  id: string;
  userId: string;
  employeeId: string;
  collegeId?: string | null;
  departmentId?: string | null;
  designation?: string | null;
  college?: College | null;
  department?: Department | null;
}

export interface College {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  isActive: boolean;
}

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  collegeId: string;
  isActive: boolean;
  college?: College;
}

export interface ComplaintCategory {
  id: string;
  name: string;
  code: string;
  description?: string | null;
  departmentId: string;
  keywords: string[];
  isActive: boolean;
  department?: Department;
}

export interface ComplaintWithRelations {
  id: string;
  complaintNumber: string;
  trackingId: string;
  title: string;
  description: string;
  submissionMode: SubmissionMode;
  categoryId?: string | null;
  departmentId?: string | null;
  submittedById?: string | null;
  status: ComplaintStatus;
  priority: ComplaintPriority;
  assignedToId?: string | null;
  location?: string | null;
  additionalInfo?: string | null;
  isAnonymous: boolean;
  createdAt: Date;
  updatedAt: Date;
  resolvedAt?: Date | null;
  closedAt?: Date | null;
  category?: ComplaintCategory | null;
  department?: Department | null;
  submittedBy?: UserWithRelations | null;
  assignedTo?: UserWithRelations | null;
  statusHistory?: ComplaintStatusHistory[];
  assignments?: ComplaintAssignment[];
  assessments?: ComplaintAssessment[];
  escalations?: ComplaintEscalation[];
  resolution?: Resolution | null;
  evidence?: Evidence[];
  messages?: Message[];
  feedback?: Feedback | null;
  trustScore?: TrustScore | null;
}

export interface ComplaintStatusHistory {
  id: string;
  complaintId: string;
  previousStatus?: ComplaintStatus | null;
  newStatus: ComplaintStatus;
  changedById: string;
  reason?: string | null;
  changedAt: Date;
  changedBy?: UserWithRelations;
}

export interface ComplaintAssignment {
  id: string;
  complaintId: string;
  assignedById: string;
  assignedToId: string;
  assignedAt: Date;
  notes?: string | null;
  assignedBy?: UserWithRelations;
  assignedTo?: UserWithRelations;
}

export interface ComplaintAssessment {
  id: string;
  complaintId: string;
  assessedById: string;
  investigationNotes?: string | null;
  evidenceAssessment?: string | null;
  findings?: string | null;
  recommendedAction?: string | null;
  resolutionDecision?: string | null;
  isInformationRequested: boolean;
  informationRequested?: string | null;
  createdAt: Date;
  updatedAt: Date;
  assessedBy?: UserWithRelations;
}

export interface ComplaintEscalation {
  id: string;
  complaintId: string;
  escalatedById: string;
  escalatedToId?: string | null;
  reason: string;
  notes?: string | null;
  previousLevel: string;
  newLevel: string;
  createdAt: Date;
  reviewedAt?: Date | null;
  reviewedById?: string | null;
  reviewDecision?: string | null;
  reviewNotes?: string | null;
  escalatedBy?: UserWithRelations;
  escalatedTo?: UserWithRelations | null;
  reviewedBy?: UserWithRelations | null;
}

export interface Resolution {
  id: string;
  complaintId: string;
  resolvedById: string;
  summary: string;
  detailedResolution: string;
  actionTaken: string;
  resolutionDate: Date;
  supportingDocuments: string[];
  createdAt: Date;
  updatedAt: Date;
  resolvedBy?: UserWithRelations;
}

export interface Evidence {
  id: string;
  complaintId: string;
  fileName: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  type: EvidenceType;
  uploadedById: string;
  description?: string | null;
  isVerified: boolean;
  verifiedAt?: Date | null;
  verifiedById?: string | null;
  createdAt: Date;
  updatedAt: Date;
  uploadedBy?: UserWithRelations;
  verifiedBy?: UserWithRelations | null;
}

export interface Message {
  id: string;
  complaintId: string;
  senderId: string;
  recipientId: string;
  message: string;
  isRead: boolean;
  readAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  sender?: UserWithRelations;
  recipient?: UserWithRelations;
}

export interface Notification {
  id: string;
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  relatedComplaintId?: string | null;
  isRead: boolean;
  readAt?: Date | null;
  createdAt: Date;
  complaint?: ComplaintWithRelations | null;
}

export interface Feedback {
  id: string;
  complaintId: string;
  studentId?: string | null;
  rating: number;
  comment?: string | null;
  isAnonymous: boolean;
  createdAt: Date;
  updatedAt: Date;
  student?: UserWithRelations | null;
}

export interface TrustScore {
  id: string;
  complaintId: string;
  score?: number | null;
  status: string;
  evidenceIntegrity?: number | null;
  evidenceCompleteness?: number | null;
  historyConsistency?: number | null;
  processTransparency?: number | null;
  factors: Record<string, unknown>;
  calculatedAt: Date;
  updatedAt: Date;
}

export interface AuditLog {
  id: string;
  actorId?: string | null;
  actorRole?: UserRole | null;
  action: AuditAction;
  entityType: string;
  entityId: string;
  previousValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  hash: string;
  previousHash?: string | null;
  createdAt: Date;
  actor?: UserWithRelations | null;
}

// API Response types
export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: ApiError;
  meta?: ResponseMeta;
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ResponseMeta {
  page?: number;
  limit?: number;
  total?: number;
  totalPages?: number;
}

// Pagination
export interface PaginationParams {
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

// Auth types
export interface JwtPayload {
  sub: string;
  email: string;
  roles: UserRole[];
  permissions: string[];
  iat?: number;
  exp?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenId: string;
  iat?: number;
  exp?: number;
}

export interface LoginCredentials {
  email: string;
  password: string;
  mfaCode?: string;
}

export interface RegisterData {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  phone?: string;
  studentId?: string;
  collegeId?: string;
  departmentId?: string;
  program?: string;
  year?: number;
}

export interface MfaSetupResponse {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

// Complaint types
export interface CreateComplaintData {
  title: string;
  description: string;
  categoryId?: string;
  departmentId?: string;
  priority?: ComplaintPriority;
  location?: string;
  additionalInfo?: string;
  submissionMode: SubmissionMode;
  evidence?: CreateEvidenceData[];
}

export interface CreateEvidenceData {
  fileName: string;
  originalName: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  type: EvidenceType;
  description?: string;
}

export interface UpdateComplaintData {
  title?: string;
  description?: string;
  categoryId?: string;
  departmentId?: string;
  priority?: ComplaintPriority;
  location?: string;
  additionalInfo?: string;
}

export interface AssignComplaintData {
  assignedToId: string;
  notes?: string;
}

export interface AssessComplaintData {
  investigationNotes?: string;
  evidenceAssessment?: string;
  findings?: string;
  recommendedAction?: string;
  resolutionDecision?: string;
  isInformationRequested?: boolean;
  informationRequested?: string;
}

export interface EscalateComplaintData {
  reason: string;
  notes?: string;
  escalatedToId?: string;
}

export interface ResolveComplaintData {
  summary: string;
  detailedResolution: string;
  actionTaken: string;
  supportingDocuments?: string[];
}

export interface CreateMessageData {
  recipientId: string;
  message: string;
}

export interface CreateFeedbackData {
  rating: number;
  comment?: string;
  isAnonymous?: boolean;
}

export interface TrustScoreFactors {
  evidenceIntegrity: number;
  evidenceCompleteness: number;
  historyConsistency: number;
  processTransparency: number;
  [key: string]: number;
}

// Query types
export interface ComplaintQueryParams extends PaginationParams {
  status?: ComplaintStatus[];
  categoryId?: string;
  departmentId?: string;
  priority?: ComplaintPriority[];
  submissionMode?: SubmissionMode;
  assignedToId?: string;
  submittedById?: string;
  dateFrom?: Date;
  dateTo?: Date;
  search?: string;
}

export interface NotificationQueryParams extends PaginationParams {
  isRead?: boolean;
  type?: NotificationType;
}

export interface AuditLogQueryParams extends PaginationParams {
  actorId?: string;
  action?: AuditAction;
  entityType?: string;
  entityId?: string;
  dateFrom?: Date;
  dateTo?: Date;
}

// Analytics types
export interface DashboardStats {
  totalComplaints: number;
  activeComplaints: number;
  resolvedComplaints: number;
  pendingComplaints: number;
  overdueComplaints: number;
  byStatus: Record<ComplaintStatus, number>;
  byCategory: Record<string, number>;
  byDepartment: Record<string, number>;
  byPriority: Record<ComplaintPriority, number>;
  averageResolutionTime?: number;
  resolutionRate?: number;
  escalationRate?: number;
  trustScoreStats?: {
    average: number;
    distribution: Record<string, number>;
  };
}

export interface TimeSeriesData {
  date: string;
  count: number;
}

export interface CategoryDistribution {
  category: string;
  count: number;
  percentage: number;
}

export interface DepartmentPerformance {
  departmentId: string;
  departmentName: string;
  totalComplaints: number;
  resolvedComplaints: number;
  averageResolutionTime: number;
  resolutionRate: number;
  escalationRate: number;
  trustScoreAverage: number;
}