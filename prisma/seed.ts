/**
 * SHJAP Grievance Portal — Development Seed
 *
 * Creates a complete demo dataset: colleges, departments, categories,
 * users for every role, complaints across the entire lifecycle (verified +
 * anonymous), assessments, escalations, resolutions, feedback, trust
 * scores, notifications and a valid tamper-evident audit chain.
 *
 * Development passwords (CHANGE IN PRODUCTION):
 *   All seeded users: Password@123
 */
import { PrismaClient, UserRole, ComplaintStatus, EvidenceType, ComplaintPriority } from '@prisma/client';
import argon2 from 'argon2';
import { randomUUID, randomBytes, createHash } from 'crypto';
import { AuditService } from '../backend/src/services/audit.service.js';
import { TrustScoreService } from '../backend/src/services/trust-score.service.js';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'Password@123';

function sha256(data: string): string {
  return createHash('sha256').update(data).digest('hex');
}

function daysAgo(n: number, hours = 0): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000 - hours * 60 * 60 * 1000);
}

/** complaintNumber: GRP-YYYY-HEX */
function complaintNumber(index: number): string {
  return `GRP-2026-${(randomBytes(3).toString('hex') + index.toString().padStart(2, '0')).slice(0, 6).toUpperCase()}`;
}

function trackingId(): string {
  return `TRK-${randomBytes(9).toString('hex').toUpperCase()}`;
}

function evidencePath(complaintId: string): string {
  return `evidence/${complaintId}/${randomUUID()}.pdf`;
}

async function main() {
  console.log('🌱 Seeding SHJAP Grievance Portal...');

  // ─── Wipe (idempotent dev seed) ────────────────────────────────────────────
  const tables = [
    prisma.auditLog, prisma.notification, prisma.message, prisma.feedback,
    prisma.trustScore, prisma.resolution, prisma.complaintEscalation,
    prisma.complaintAssessment, prisma.complaintStatusHistory,
    prisma.complaintAssignment, prisma.evidence, prisma.complaint,
    prisma.userRoleAssignment, prisma.rolePermission, prisma.permission,
    prisma.role, prisma.refreshToken, prisma.passwordResetToken,
    prisma.mFAConfiguration, prisma.studentProfile, prisma.administratorProfile,
    prisma.systemSetting, prisma.complaintCategory, prisma.department, prisma.college,
    prisma.user,
  ];
  for (const table of tables) {
    await table.deleteMany();
  }
  console.log('  ✓ cleared existing data');

  // ─── Organization ──────────────────────────────────────────────────────────
  const ceas = await prisma.college.create({
    data: { name: 'College of Engineering & Applied Sciences', code: 'CEAS', description: 'Engineering, computing and applied sciences programs.' },
  });
  const cbss = await prisma.college.create({
    data: { name: 'College of Business & Social Sciences', code: 'CBSS', description: 'Business, management and social sciences programs.' },
  });

  const deptData: Array<{ code: string; name: string; collegeId: string }> = [
    { code: 'ACADEMICS', name: 'Academic Affairs', collegeId: ceas.id },
    { code: 'STUDENT_AFFAIRS', name: 'Student Affairs', collegeId: cbss.id },
    { code: 'FINANCE', name: 'Finance & Bursary', collegeId: cbss.id },
    { code: 'FACILITIES', name: 'Facilities & Estates', collegeId: ceas.id },
    { code: 'HUMAN_RESOURCES', name: 'Human Resources', collegeId: cbss.id },
    { code: 'REGISTRY', name: 'Registry & Records', collegeId: cbss.id },
    { code: 'IT', name: 'IT Services', collegeId: ceas.id },
    { code: 'HEALTH', name: 'Health Services', collegeId: cbss.id },
  ];
  const departments: Record<string, { id: string }> = {};
  for (const d of deptData) {
    const dept = await prisma.department.create({
      data: { ...d, description: `${d.name} office — handles related grievances.` },
    });
    departments[d.code] = dept;
  }
  console.log('  ✓ 2 colleges, 8 departments');

  // ─── Categories ────────────────────────────────────────────────────────────
  const categories: Record<string, { id: string }> = {};
  const categoryData: Array<{ code: string; name: string; department: string; keywords: string[] }> = [
    { code: 'ACADEMIC_ASSESSMENT', name: 'Academic Assessment', department: 'ACADEMICS', keywords: ['grade', 'mark', 'exam', 'result', 'credit', 'assessment'] },
    { code: 'HARASSMENT', name: 'Harassment & Discrimination', department: 'STUDENT_AFFAIRS', keywords: ['harassment', 'bullying', 'discrimination', 'abuse'] },
    { code: 'FINANCIAL', name: 'Fees & Financial Services', department: 'FINANCE', keywords: ['fee', 'payment', 'refund', 'scholarship'] },
    { code: 'FACILITIES', name: 'Facilities & Infrastructure', department: 'FACILITIES', keywords: ['classroom', 'laboratory', 'hostel', 'toilet', 'library', 'elevator'] },
    { code: 'STAFF_CONDUCT', name: 'Staff Conduct', department: 'HUMAN_RESOURCES', keywords: ['lecturer', 'professor', 'conduct', 'unprofessional'] },
    { code: 'ADMINISTRATIVE', name: 'Administrative Services', department: 'REGISTRY', keywords: ['transcript', 'certificate', 'registration', 'record'] },
    { code: 'IT_SERVICES', name: 'IT Services', department: 'IT', keywords: ['wifi', 'internet', 'portal', 'computer', 'system'] },
    { code: 'HEALTH_SERVICES', name: 'Health Services', department: 'HEALTH', keywords: ['clinic', 'medical', 'health', 'mental'] },
  ];
  for (const c of categoryData) {
    const cat = await prisma.complaintCategory.create({
      data: {
        code: c.code,
        name: c.name,
        description: `${c.name} grievances.`, 
        departmentId: departments[c.department].id,
        keywords: c.keywords,
      },
    });
    categories[c.code] = cat;
  }
  console.log('  ✓ 8 complaint categories');

  // ─── Roles & Permissions ──────────────────────────────────────────────────
  const roleDefs: Array<{ role: UserRole; resources: string[]; actions: string[] }> = [
    { role: 'STUDENT', resources: ['complaint', 'evidence', 'message', 'notification', 'feedback'], actions: ['create', 'read', 'update'] },
    { role: 'DEPARTMENT_ADMIN', resources: ['complaint', 'evidence', 'message', 'assessment', 'trust-score', 'notification'], actions: ['read', 'update', 'escalate', 'resolve', 'assess', 'create'] },
    { role: 'COLLEGE_ADMIN', resources: ['complaint', 'escalation', 'analytics', 'notification'], actions: ['read', 'approve', 'reject', 'escalate', 'resolve', 'assign'] },
    { role: 'UNIVERSITY_ADMIN', resources: ['complaint', 'analytics', 'report', 'notification'], actions: ['read', 'resolve', 'close', 'assign'] },
    { role: 'MAIN_ADMIN', resources: ['user', 'role', 'permission', 'department', 'college', 'category', 'setting', 'audit-log', 'complaint', 'analytics'], actions: ['create', 'read', 'update', 'delete', 'manage', 'verify'] },
  ];

  const roleMap: Record<string, { id: string }> = {};
  for (const def of roleDefs) {
    const role = await prisma.role.create({
      data: { name: def.role, description: `${def.role.replace(/_/g, ' ')} role` },
    });
    roleMap[def.role] = role;
    const permissionRows = def.resources.flatMap((resource) =>
      def.actions.map((action) => ({ name: `${resource}:${action}`, resource, action, description: `${action} on ${resource}` }))
    );
    for (const p of permissionRows) {
      const perm = await prisma.permission.upsert({ where: { name: p.name }, update: {}, create: p });
      await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: perm.id } });
    }
  }
  console.log('  ✓ roles & permissions');

  // ─── Users ─────────────────────────────────────────────────────────────────
  const passwordHash = await argon2.hash(DEMO_PASSWORD, { type: argon2.argon2id });

  async function createUser(opts: {
    email: string; firstName: string; lastName: string;
    role: UserRole; profile: {
      studentId?: string; program?: string; year?: number;
      employeeId?: string; designation?: string;
      collegeId?: string; departmentId?: string; };
  }) {
    const user = await prisma.user.create({
      data: {
        email: opts.email,
        passwordHash,
        firstName: opts.firstName,
        lastName: opts.lastName,
        roles: [opts.role],
        isEmailVerified: true,
        emailVerifiedAt: daysAgo(30),
        lastLoginAt: daysAgo(1),
      },
    });
    await prisma.userRoleAssignment.create({
      data: { userId: user.id, roleId: roleMap[opts.role].id, assignedBy: 'seed' },
    });
    if (opts.profile.studentId) {
      await prisma.studentProfile.create({
        data: {
          userId: user.id,
          studentId: opts.profile.studentId,
          program: opts.profile.program ?? 'BSc Computer Science',
          year: opts.profile.year ?? 3,
          collegeId: opts.profile.collegeId ?? ceas.id,
          departmentId: opts.profile.departmentId ?? departments.ACADEMICS.id,
        },
      });
    } else {
      await prisma.administratorProfile.create({
        data: {
          userId: user.id,
          employeeId: opts.profile.employeeId ?? `EMP-${randomBytes(2).toString('hex').toUpperCase()}`,
          designation: opts.profile.designation ?? opts.role,
          collegeId: opts.profile.collegeId,
          departmentId: opts.profile.departmentId,
        },
      });
    }
    return user;
  }

  const student = await createUser({ email: 'student@example.com', firstName: 'Amina', lastName: 'Yusuf', role: 'STUDENT', profile: { studentId: 'STU-2026-0011', program: 'BSc Computer Science', year: 3 } });
  const student2 = await createUser({ email: 'hassan@example.com', firstName: 'Hassan', lastName: 'Ibrahim', role: 'STUDENT', profile: { studentId: 'STU-2026-0027', program: 'BEng Civil Engineering', year: 2 } });
  await createUser({ email: 'fatima@example.com', firstName: 'Fatima', lastName: 'Ahmed', role: 'STUDENT', profile: { studentId: 'STU-2026-0042', program: 'BSc Business Administration', year: 1, collegeId: cbss.id, departmentId: departments.FINANCE.id } });

  const academicsAdmin = await createUser({ email: 'department.admin@example.com', firstName: 'Omar', lastName: 'Faruk', role: 'DEPARTMENT_ADMIN', profile: { employeeId: 'EMP-ACAD-01', designation: 'Head of Academic Affairs', departmentId: departments.ACADEMICS.id, collegeId: ceas.id } });
  const facilitiesAdmin = await createUser({ email: 'facilities.admin@example.com', firstName: 'Zara', lastName: 'Osman', role: 'DEPARTMENT_ADMIN', profile: { employeeId: 'EMP-FAC-01', designation: 'Facilities Manager', departmentId: departments.FACILITIES.id, collegeId: ceas.id } });
  const itAdmin = await createUser({ email: 'it.admin@example.com', firstName: 'Bilal', lastName: 'Karim', role: 'DEPARTMENT_ADMIN', profile: { employeeId: 'EMP-IT-01', designation: 'IT Service Lead', departmentId: departments.IT.id, collegeId: ceas.id } });
  const financeAdmin = await createUser({ email: 'finance.admin@example.com', firstName: 'Layla', lastName: 'Suleiman', role: 'DEPARTMENT_ADMIN', profile: { employeeId: 'EMP-FIN-01', designation: 'Finance Officer', departmentId: departments.FINANCE.id, collegeId: cbss.id } });
  const studentAffairsAdmin = await createUser({ email: 'student.affairs@example.com', firstName: 'Yasmin', lastName: 'Hassan', role: 'DEPARTMENT_ADMIN', profile: { employeeId: 'EMP-SA-01', designation: 'Dean of Student Affairs', departmentId: departments.STUDENT_AFFAIRS.id, collegeId: cbss.id } });

  const collegeAdmin = await createUser({ email: 'college.admin@example.com', firstName: 'Nadia', lastName: 'Rahman', role: 'COLLEGE_ADMIN', profile: { employeeId: 'EMP-CEAS-01', designation: 'Vice Principal — CEAS', collegeId: ceas.id } });
  const collegeAdmin2 = await createUser({ email: 'college.admin.cbss@example.com', firstName: 'Said', lastName: 'Abdi', role: 'COLLEGE_ADMIN', profile: { employeeId: 'EMP-CBSS-01', designation: 'Vice Principal — CBSS', collegeId: cbss.id } });

  const universityAdmin = await createUser({ email: 'university.admin@example.com', firstName: 'Khadar', lastName: 'Ali', role: 'UNIVERSITY_ADMIN', profile: { employeeId: 'EMP-UNI-01', designation: 'Pro Vice-Chancellor (Administration)' } });
  const mainAdmin = await createUser({ email: 'main.admin@example.com', firstName: 'Shukri', lastName: 'Jama', role: 'MAIN_ADMIN', profile: { employeeId: 'EMP-SYS-01', designation: 'System Administrator' } });

  console.log('  ✓ 13 users across all 5 roles (password: Password@123)');

  // ─── Complaints ────────────────────────────────────────────────────────────

  interface SeedComplaint {
    key: string;
    title: string;
    description: string;
    mode: 'ANONYMOUS' | 'VERIFIED';
    submitter?: { id: string };
    status: ComplaintStatus;
    priority?: ComplaintPriority;
    categoryCode?: string;
    deptCode?: string;
    assignedTo?: { id: string } | null;
    needsManual?: boolean;
    createdAt: Date;
    location?: string;
    additionalInfo?: string;
    evidence?: Array<{ name: string; verified?: boolean; days: number }>;
    assessment?: { notes?: string; evidenceAssessment?: string; findings?: string; recommended?: string; decision?: string; infoRequested?: string; days: number };
    escalation?: { level: 'COLLEGE' | 'UNIVERSITY'; reason: string; notes?: string; by: { id: string }; to?: { id: string } | null; days: number; reviewed?: { decision: 'APPROVE' | 'REJECT'; notes?: string; by: { id: string }; days: number }; };
    resolution?: { summary: string; detailed: string; action: string; by: { id: string }; days: number };
    feedback?: { rating: number; comment?: string; days: number };
    messages?: Array<{ from: { id: string }; to: { id: string }; text: string; days: number }>;
    scraped?: never;
  }

  const seeds: SeedComplaint[] = [
    {
      key: 'wifi',
      title: 'Campus WiFi repeatedly disconnects in Library Block B',
      description: 'The WiFi in Library Block B disconnects every few minutes, making it impossible to submit assignments through the online portal. I have attached screenshots of repeated connection drops from my laptop and my phone over three consecutive days.',
      mode: 'VERIFIED', submitter: { id: student.id },
      status: 'ASSIGNED', priority: 'HIGH',
      categoryCode: 'IT_SERVICES', deptCode: 'IT', assignedTo: { id: itAdmin.id },
      createdAt: daysAgo(3),
      location: 'Library Block B, CEAS campus',
      evidence: [{ name: 'wifi-disconnect-screenshots.pdf', verified: false, days: 3 }],
      messages: [{ from: { id: itAdmin.id }, to: { id: student.id }, text: 'Thank you for the detailed report. Our network team is reviewing the access point logs for Block B. Could you share the times of day the drops occur most?', days: 2 }],
    },
    {
      key: 'grade',
      title: 'Final lab grade not recorded despite submission',
      description: 'The final laboratory assessment for CSM301 was submitted on time through the faculty portal, but the grade still shows as missing on the student record system. Attached evidence includes the submission receipt and the email confirmation from the course instructor.',
      mode: 'VERIFIED', submitter: { id: student.id },
      status: 'UNDER_INVESTIGATION', priority: 'URGENT',
      categoryCode: 'ACADEMIC_ASSESSMENT', deptCode: 'ACADEMICS', assignedTo: { id: academicsAdmin.id },
      createdAt: daysAgo(9),
      evidence: [
        { name: 'submission-receipt.pdf', verified: true, days: 9 },
        { name: 'course-email-screenshot.png', verified: true, days: 9 },
      ],
      assessment: {
        notes: 'Contacted the course instructor and reviewed the submission logs. Receipt and email both appear legitimate. The grade sheet for CSM301 shows an upload failure on the faculty portal that week — recorded as a system issue, not student error.',
        evidenceAssessment: 'Both documents verified against portal records. Submission receipt hash matches registry archive.',
        findings: 'Grade was lost due to faculty portal upload failure. Student submission is confirmed valid.',
        recommended: 'Instruct the exam office to ingest the grade manually and notify the student within 48 hours.',
        decision: 'Uphold complaint; correct grade entry.',
        days: 7,
      },
    },
    {
      key: 'hostel',
      title: 'Hostel water supply interrupted for over a week',
      description: 'There has been no running water in Block C of the student hostel for over a week. Students are fetching water from the far block late at night. I visited the warden office twice and wrote to the facilities office without a response. This is affecting health and attendance in morning classes.',
      mode: 'VERIFIED', submitter: { id: student2.id },
      status: 'INFORMATION_REQUESTED', priority: 'URGENT',
      categoryCode: 'FACILITIES', deptCode: 'FACILITIES', assignedTo: { id: facilitiesAdmin.id },
      createdAt: daysAgo(12),
      location: 'Hostel Block C',
      evidence: [{ name: 'hostel-water-photos.zip', days: 12 }],
      assessment: {
        notes: 'Maintenance team reports a valve replacement pending delivery of parts. Requesting clarification on affected floors and preferred interim arrangements.',
        infoRequested: 'Please confirm which floors of Block C are affected and whether interim water tankers would be acceptable placement in the courtyard.',
        days: 10,
      },
      messages: [{ from: { id: student2.id }, to: { id: facilitiesAdmin.id }, text: 'Updated: floors 2 and 3 are affected. Tankers in the courtyard would help a lot during repairs.', days: 9 }],
    },
    {
      key: 'fee',
      title: 'Duplicate fee charged for laboratory materials',
      description: 'The semester invoice includes two identical laboratory material fees. The bursary was contacted by email twice and a visit was made to the finance office, but the duplicate charge has not been corrected and the payment deadline is approaching. Attached is the invoice with the duplicate lines highlighted.',
      mode: 'VERIFIED', submitter: { id: student.id },
      status: 'RESOLVED', priority: 'MEDIUM',
      categoryCode: 'FINANCIAL', deptCode: 'FINANCE', assignedTo: { id: financeAdmin.id },
      createdAt: daysAgo(21),
      evidence: [{ name: 'invoice-highlighted.pdf', verified: true, days: 21 }],
      resolution: {
        summary: 'Duplicate laboratory fee reversed and invoice corrected',
        detailed: 'Verified against the finance ledger that laboratory materials were billed twice due to a cart-submission bug during registration week. A credit note reversing the duplicate was posted to the student account, and the corrected invoice has been emailed to the student.',
        action: 'Reposted the invoice, activated a 30-day deadline extension for the affected account, paused late-payment penalties for students in the same batch who can raise a verified duplicate-billing complaint.',
        by: { id: financeAdmin.id },
        days: 15,
      },
      feedback: { rating: 5, comment: 'Very quick once the finance office replied. The credit note arrived two days later. Thank you!', days: 14 },
    },
    {
      key: 'harassment',
      title: 'Instructor used threatening language during practical session',
      description: 'During a laboratory practical, the session instructor shouted at students and threatened to fail anyone who asked questions about the marking scheme. Several students were shaken. I am submitting anonymously because I fear retaliation in future assessments.',
      mode: 'ANONYMOUS',
      status: 'ESCALATED', priority: 'URGENT',
      categoryCode: 'STAFF_CONDUCT', deptCode: 'HUMAN_RESOURCES', assignedTo: null,
      createdAt: daysAgo(8),
      location: 'Main Laboratory, CEAS campus',
      escalation: {
        level: 'COLLEGE',
        reason: 'Serious staff-conduct allegation from an anonymous complainant. HR-led investigation would benefit from college oversight given potential student-union involvement.',
        notes: 'Preliminary check with the instructor scheduled; evidence not yet complete.',
        by: { id: studentAffairsAdmin.id },
        to: { id: collegeAdmin2.id },
        days: 6,
      },
      needsManual: false,
    },
    {
      key: 'toilet',
      title: 'Washroom hygiene in CEAS teaching block is unacceptable',
      description: 'The teaching block washrooms have been dirty for weeks and several stalls are out of order. Cleaning seems to happen only on inspection days. Multiple course reps complained already. Requesting a fixed cleaning schedule and repairs.',
      mode: 'ANONYMOUS',
      status: 'UNDER_INVESTIGATION', priority: 'MEDIUM',
      categoryCode: 'FACILITIES', deptCode: 'FACILITIES', assignedTo: { id: facilitiesAdmin.id },
      needsManual: false,
      createdAt: daysAgo(6),
      location: 'CEAS Teaching Block 2',
    },
    {
      key: 'transcript',
      title: 'Requested transcript not issued after three visits',
      description: 'I requested an official transcript three weeks ago for a scholarship application and visited the registry three times. The application deadline is next week. Registry staff said they are short-staffed but there is no queue ticketing or estimate system visible.',
      mode: 'VERIFIED', submitter: { id: student2.id },
      status: 'SUBMITTED', priority: 'HIGH',
      needsManual: true, // deliberately left uncategorized: demo of manual population
      createdAt: daysAgo(2),
    },
    {
      key: 'parking',
      title: 'Disabled-badge parking area blocked by contractor vehicles',
      description: 'Contractor vehicles park daily in the disabled-badge marked area beside the Science entrance, forcing students who need the spaces to park hundreds of meters away. Photography showing the contractor plates on consecutive days is included.',
      mode: 'VERIFIED', submitter: { id: student.id },
      status: 'CLOSED', priority: 'MEDIUM',
      categoryCode: 'FACILITIES', deptCode: 'FACILITIES', assignedTo: { id: facilitiesAdmin.id },
      createdAt: daysAgo(30),
      evidence: [{ name: 'parking-photos.pdf', verified: true, days: 30 }],
      resolution: {
        summary: 'Contractor parking reallocated; badges area restored',
        detailed: 'The contractor was instructed to use the north service yard instead. Signage was repainted, a bollard was added, and facilities performed a follow-up check for two weeks.',
        action: 'Towed two blocking vehicles, reallocated contractor permits, added bollards and weekly checks of the badge area for a month.',
        by: { id: facilitiesAdmin.id },
        days: 24,
      },
      feedback: { rating: 4, comment: 'Fixed within a week, though it took an escalation to Facilities management to move the contractor.', days: 23 },
    },
    {
      key: 'portal',
      title: 'Course registration portal rejected valid course selections',
      description: 'During registration, the portal rejected my seminar selection although seats were showing as available on the same screen. After repeated attempts the cap filled and the seminar is now closed. Screenshot sequence and error text captured.',
      mode: 'VERIFIED', submitter: { id: student.id },
      status: 'ESCALATED', priority: 'HIGH',
      categoryCode: 'IT_SERVICES', deptCode: 'IT', assignedTo: { id: collegeAdmin.id },
      createdAt: daysAgo(16),
      additionalInfo: 'Registration reference: REG-88412. Error message: "Seat allocation conflict — selection declined." shown while availability read 6/30.',
      escalation: {
        level: 'UNIVERSITY',
        reason: 'Cross-department issue: registry seat inventory vs IT portal validation conflict. Requires university-level coordination between Registry and IT with a policy fix for the affected cohort.',
        notes: 'IT root-caused the inventory mismatch; Registry must approve late-exception enrolments.',
        by: { id: itAdmin.id },
        to: { id: universityAdmin.id },
        days: 12,
      },
    },
    {
      key: 'failing',
      title: 'Repeating a course was not reflected in my graduation audit',
      description: 'The graduation audit system does not show that I repeated and passed DSM202 with the improvement grade. The audit still lists the original fail twice, holding my graduation clearance. Registry said the audit data refresh is automated and cannot be adjusted locally.',
      mode: 'VERIFIED', submitter: { id: student2.id },
      status: 'RESOLUTION_PROPOSED', priority: 'MEDIUM',
      categoryCode: 'ACADEMIC_ASSESSMENT', deptCode: 'ACADEMICS', assignedTo: { id: academicsAdmin.id },
      createdAt: daysAgo(19),
      resolution: {
        summary: 'Graduation audit recalculated after registry data correction',
        detailed: 'Registry confirmed the repeat pass record existed but the audit calculation job had cached stale rows. A manual audit re-run has been proposed for the next batch; per policy a higher level approves audit overrides.',
        action: 'Drafted audit override form referencing repeat-pass regulation 12c, awaiting college-level approval.',
        by: { id: academicsAdmin.id },
        days: 13,
      },
      escalation: {
        level: 'COLLEGE',
        reason: 'Audit override approval requires the college vice-principal per academic regulation 12c.',
        notes: 'Recalculated audit attached to the resolution draft.',
        by: { id: academicsAdmin.id },
        to: { id: collegeAdmin.id },
        days: 12,
      },
    },
    {
      key: 'refund',
      title: 'Refund for cancelled field trip never processed',
      description: 'The second-year ecology field trip was cancelled on the day of departure because the bus company failed inspection. The department promised refunds within 10 working days; it has been five weeks and multiple students have still not received the refund posted to their bursary accounts.',
      mode: 'VERIFIED', submitter: { id: student2.id },
      status: 'REJECTED', priority: 'LOW',
      categoryCode: 'FINANCIAL', deptCode: 'FINANCE', assignedTo: { id: financeAdmin.id },
      createdAt: daysAgo(40),
      evidence: [{ name: 'trip-cancellation-notice.pdf', days: 40 }],
      resolution: undefined,
      messages: [{ from: { id: financeAdmin.id }, to: { id: student2.id }, text: 'The finance office records show your refund was batched with your tuition credit line. Attaching the ledger reference by email today.', days: 34 }],
    },
    {
      key: 'mental',
      title: 'Counselling service appointment backlog is severe',
      description: 'I asked for a counselling appointment three weeks ago. The soonest available slot is in seven weeks. During exam weeks this is risky for many students. Requesting additional counsellor hours and a triage process for urgent cases.',
      mode: 'VERIFIED', submitter: { id: student.id },
      status: 'CATEGORIZED', priority: 'HIGH',
      categoryCode: 'HEALTH_SERVICES', deptCode: 'HEALTH', assignedTo: null,
      createdAt: daysAgo(5),
    },
    {
      key: 'wifi-anon',
      title: 'Exam hall projector and sound system failure during midterms',
      description: 'During the midterm session in Hall 3 the projector failed and the sound system produced static, costing 25 minutes of exam time. Invigilators filed their own incident note but the lost time was not compensated.',
      mode: 'ANONYMOUS',
      status: 'SUBMITTED', priority: 'MEDIUM',
      needsManual: true,
      createdAt: daysAgo(1),
    },
  ] as unknown as SeedComplaint[];

  const created: Record<string, { id: string; complaintNumber: string; trackingId: string }> = {};

  for (const s of seeds) {
    const days = Math.max(0, Math.round((Date.now() - s.createdAt.getTime()) / (1000 * 60 * 60 * 1000)) * -1);
    void days;
    const complaint = await prisma.complaint.create({
      data: {
        complaintNumber: complaintNumber(Object.keys(created).length + 1),
        trackingId: trackingId(),
        title: s.title,
        description: s.description,
        submissionMode: s.mode,
        submittedById: s.mode === 'VERIFIED' ? s.submitter?.id ?? null : null,
        isAnonymous: s.mode === 'ANONYMOUS',
        status: s.status,
        priority: s.priority ?? 'MEDIUM',
        categoryId: s.categoryCode ? categories[s.categoryCode].id : null,
        departmentId: s.deptCode ? departments[s.deptCode].id : null,
        assignedToId: s.assignedTo?.id ?? null,
        location: s.location,
        additionalInfo: s.additionalInfo,
        needsManualCategorization: !!s.needsManual,
        createdAt: s.createdAt,
        updatedAt: s.createdAt,
        resolvedAt: s.status === 'RESOLVED' || s.status === 'CLOSED' ? new Date(s.createdAt.getTime() + 5 * 24 * 60 * 60 * 1000) : null,
        closedAt: s.status === 'CLOSED' ? new Date(s.createdAt.getTime() + 8 * 24 * 60 * 60 * 1000) : null,
      },
    });
    created[s.key] = { id: complaint.id, complaintNumber: complaint.complaintNumber, trackingId: complaint.trackingId };

    // Status history: SUBMITTED → current, as history rows
    await prisma.complaintStatusHistory.create({
      data: {
        complaintId: complaint.id,
        newStatus: 'SUBMITTED',
        changedById: s.mode === 'VERIFIED' ? s.submitter?.id ?? null : null,
        changedByLabel: s.mode === 'ANONYMOUS' ? 'Anonymous student' : undefined,
        reason: 'Complaint submitted',
        changedAt: s.createdAt,
      },
    });

    // Submission audit
    await AuditService.log({
      actorId: s.mode === 'VERIFIED' ? s.submitter?.id : undefined,
      actorRole: s.mode === 'VERIFIED' ? 'STUDENT' : undefined,
      action: 'COMPLAINT_CREATED',
      entityType: 'Complaint',
      entityId: complaint.id,
      newValue: { complaintNumber: complaint.complaintNumber, submissionMode: s.mode },
    });

    const chain: Array<{ status: ComplaintStatus; days: number; reason: string; actor?: { id: string } }> = [];
    if (s.categoryCode) {
      chain.push({ status: 'CATEGORIZED', days: 0.5, reason: `Auto-categorized as ${s.categoryCode}`, actor: undefined });
    }
    if (s.assignedTo) {
      chain.push({ status: 'ASSIGNED', days: 1, reason: 'Assigned to department administrator', actor: s.assignedTo });
    }
    if (s.status === 'UNDER_INVESTIGATION' || s.status === 'INFORMATION_REQUESTED' || ['RESOLVED', 'CLOSED', 'REJECTED', 'RESOLUTION_PROPOSED'].includes(s.status)) {
      chain.push({ status: 'UNDER_INVESTIGATION', days: 2, reason: 'Investigation opened', actor: s.assignedTo });
    }
    if (s.status === 'INFORMATION_REQUESTED') {
      chain.push({ status: 'INFORMATION_REQUESTED', days: 3, reason: 'Additional information requested', actor: s.assignedTo });
    }
    if (s.escalation) {
      chain.push({ status: 'ESCALATED', days: s.escalation.days, reason: `Escalated to ${s.escalation.level}: ${s.escalation.reason.slice(0, 80)}…`, actor: s.escalation.by });
    }
    if (s.resolution && s.status === 'RESOLUTION_PROPOSED') {
      chain.push({ status: 'RESOLUTION_PROPOSED', days: s.resolution.days, reason: 'Resolution proposed pending approval', actor: s.resolution.by });
    }
    if (s.status === 'RESOLVED') {
      chain.push({ status: 'RESOLVED', days: s.resolution?.days ?? 5, reason: `Resolved: ${s.resolution?.summary ?? ''}`, actor: s.resolution?.by ?? s.assignedTo });
    }
    if (s.status === 'CLOSED') {
      chain.push({ status: 'RESOLVED', days: 6, reason: `Resolved: ${s.resolution?.summary ?? ''}`, actor: s.resolution?.by ?? s.assignedTo });
      chain.push({ status: 'CLOSED', days: 8, reason: 'Complaint closed after feedback window', actor: { id: universityAdmin.id } });
    }
    if (s.status === 'REJECTED') {
      chain.push({ status: 'REJECTED', days: 20, reason: 'Rejected: refund already posted in the ledger this semester (duplicate filing)', actor: { id: financeAdmin.id } });
    }

    for (const step of chain) {
      const prev = await prisma.complaintStatusHistory.findFirst({
        where: { complaintId: complaint.id },
        orderBy: { changedAt: 'desc' },
        select: { newStatus: true },
      });
      await prisma.complaintStatusHistory.create({
        data: {
          complaintId: complaint.id,
          previousStatus: prev?.newStatus ?? 'SUBMITTED',
          newStatus: step.status,
          changedById: step.actor?.id ?? null,
          changedByLabel: step.actor ? undefined : 'System (auto-categorization)',
          reason: step.reason,
          changedAt: new Date(s.createdAt.getTime() + step.days * 24 * 60 * 60 * 1000),
        },
      });
      const stepRole: UserRole | undefined =
        step.actor?.id === universityAdmin.id ? 'UNIVERSITY_ADMIN'
        : step.actor?.id === mainAdmin.id ? 'MAIN_ADMIN'
        : step.actor?.id === collegeAdmin.id || step.actor?.id === collegeAdmin2.id ? 'COLLEGE_ADMIN'
        : step.actor ? 'DEPARTMENT_ADMIN'
        : undefined;
      await AuditService.log({
        actorId: step.actor?.id,
        actorRole: stepRole,
        action: 'STATUS_CHANGED',
        entityType: 'Complaint',
        entityId: complaint.id,
        previousValue: { status: prev?.newStatus ?? 'SUBMITTED' },
        newValue: { status: step.status },
      });
    }

    // Evidence
    for (const ev of s.evidence ?? []) {
      const path = evidencePath(complaint.id);
      await prisma.evidence.create({
        data: {
          complaintId: complaint.id,
          fileName: path,
          originalName: ev.name,
          filePath: path,
          fileSize: 240_000,
          mimeType: ev.name.endsWith('.png') ? 'image/png' : ev.name.endsWith('.zip') ? 'application/zip' : 'application/pdf',
          type: ev.name.endsWith('.png') ? 'IMAGE' : ev.name.endsWith('.zip') ? 'OTHER' : 'PDF',
          uploadedById: s.submitter?.id ?? mainAdmin.id,
          description: undefined,
          isVerified: !!ev.verified,
          verifiedAt: ev.verified ? new Date(s.createdAt.getTime() + 24 * 60 * 60 * 1000) : null,
          verifiedById: ev.verified ? s.assignedTo?.id ?? academicsAdmin.id : null,
          createdAt: new Date(s.createdAt.getTime() - ev.days * 24 * 60 * 60 * 1000 + 24 * 60 * 60 * 1000),
        },
      });
      await AuditService.log({
        actorId: s.submitter?.id ?? undefined,
        actorRole: 'STUDENT',
        action: 'EVIDENCE_UPLOADED',
        entityType: 'Evidence',
        entityId: randomUUID(),
        newValue: { complaintId: complaint.id, fileName: ev.name },
      });
    }

    // Assessment
    if (s.assessment) {
      await prisma.complaintAssessment.create({
        data: {
          complaintId: complaint.id,
          assessedById: s.assignedTo?.id ?? academicsAdmin.id,
          investigationNotes: s.assessment.notes,
          evidenceAssessment: s.assessment.evidenceAssessment,
          findings: s.assessment.findings,
          recommendedAction: s.assessment.recommended,
          resolutionDecision: s.assessment.decision,
          isInformationRequested: !!s.assessment.infoRequested,
          informationRequested: s.assessment.infoRequested,
          createdAt: new Date(s.createdAt.getTime() + s.assessment.days * 24 * 60 * 60 * 1000),
        },
      });
      await AuditService.log({
        actorId: s.assignedTo?.id,
        actorRole: 'DEPARTMENT_ADMIN',
        action: 'ASSESSMENT',
        entityType: 'Complaint',
        entityId: complaint.id,
        newValue: { hasFindings: !!s.assessment.findings, isInformationRequested: !!s.assessment.infoRequested },
      });
    }

    // Escalation
    if (s.escalation) {
      const esc = await prisma.complaintEscalation.create({
        data: {
          complaintId: complaint.id,
          escalatedById: s.escalation.by.id,
          escalatedToId: s.escalation.to?.id ?? null,
          reason: s.escalation.reason,
          notes: s.escalation.notes,
          previousLevel: s.escalation.level === 'UNIVERSITY' ? 'COLLEGE' : 'DEPARTMENT',
          newLevel: s.escalation.level,
          createdAt: new Date(s.createdAt.getTime() + s.escalation.days * 24 * 60 * 60 * 1000),
          reviewedAt: s.escalation.reviewed ? new Date(s.createdAt.getTime() + s.escalation.reviewed.days * 24 * 60 * 60 * 1000) : null,
          reviewedById: s.escalation.reviewed?.by.id,
          reviewDecision: s.escalation.reviewed?.decision,
          reviewNotes: s.escalation.reviewed?.notes,
        },
      });
      await AuditService.log({
        actorId: s.escalation.by.id,
        actorRole: s.escalation.level === 'UNIVERSITY' ? 'COLLEGE_ADMIN' : 'DEPARTMENT_ADMIN',
        action: 'ESCALATION',
        entityType: 'Complaint',
        entityId: complaint.id,
        newValue: { newLevel: s.escalation.level, reason: s.escalation.reason },
      });
      if (s.escalation.reviewed) {
        await AuditService.log({
          actorId: s.escalation.reviewed.by.id,
          actorRole: 'COLLEGE_ADMIN',
          action: 'STATUS_CHANGED',
          entityType: 'ComplaintEscalation',
          entityId: esc.id,
          newValue: { decision: s.escalation.reviewed.decision },
        });
      }
    }

    // Resolution
    if (s.resolution) {
      await prisma.resolution.create({
        data: {
          complaintId: complaint.id,
          resolvedById: s.resolution.by.id,
          summary: s.resolution.summary,
          detailedResolution: s.resolution.detailed,
          actionTaken: s.resolution.action,
          resolutionDate: new Date(s.createdAt.getTime() + s.resolution.days * 24 * 60 * 60 * 1000),
        },
      });
      await AuditService.log({
        actorId: s.resolution.by.id,
        actorRole: 'DEPARTMENT_ADMIN',
        action: 'RESOLUTION',
        entityType: 'Complaint',
        entityId: complaint.id,
        newValue: { summary: s.resolution.summary },
      });
    }

    // Feedback
    if (s.feedback) {
      await prisma.feedback.create({
        data: {
          complaintId: complaint.id,
          studentId: s.mode === 'ANONYMOUS' ? null : s.submitter?.id ?? null,
          rating: s.feedback.rating,
          comment: s.feedback.comment,
          isAnonymous: s.mode === 'ANONYMOUS',
          createdAt: new Date(s.createdAt.getTime() + s.feedback.days * 24 * 60 * 60 * 1000),
        },
      });
      await AuditService.log({
        actorId: s.submitter?.id,
        actorRole: 'STUDENT',
        action: 'FEEDBACK',
        entityType: 'Complaint',
        entityId: complaint.id,
        newValue: { rating: s.feedback.rating, anonymous: s.mode === 'ANONYMOUS' },
      });
    }

    // Messages
    for (const m of s.messages ?? []) {
      const msg = await prisma.message.create({
        data: {
          complaintId: complaint.id,
          senderId: m.from.id,
          recipientId: m.to.id,
          message: m.text,
          isRead: true,
          readAt: new Date(s.createdAt.getTime() + (m.days + 1) * 24 * 60 * 60 * 1000),
          createdAt: new Date(s.createdAt.getTime() + m.days * 24 * 60 * 60 * 1000),
        },
      });
      await AuditService.log({
        actorId: m.from.id,
        action: 'MESSAGE_SENT',
        entityType: 'Message',
        entityId: msg.id,
        newValue: { complaintId: complaint.id },
      });
    }

    // Notifications for the submitter of verified complaints
    if (s.submitter) {
      await prisma.notification.create({
        data: {
          userId: s.submitter.id,
          type: s.status === 'RESOLVED' ? 'COMPLAINT_RESOLVED' : 'STATUS_CHANGED',
          title: s.status === 'RESOLVED' ? 'Complaint Resolved' : 'Complaint Status Updated',
          message: `Complaint ${complaint.complaintNumber} status is now ${s.status.replace(/_/g, ' ').toLowerCase()}.`,
          relatedComplaintId: complaint.id,
          isRead: ['RESOLVED', 'CLOSED', 'REJECTED'].includes(s.status),
          readAt: ['RESOLVED', 'CLOSED', 'REJECTED'].includes(s.status) ? daysAgo(3) : null,
          createdAt: daysAgo(2),
        },
      });
    }
  }

  console.log(`  ✓ ${seeds.length} complaints across all lifecycle states`);

  // Escalation-level pending notifications for college/university admins
  await prisma.notification.create({
    data: {
      userId: collegeAdmin2.id,
      type: 'COMPLAINT_ESCALATED',
      title: 'Complaint Escalated to Your College',
      message: `Complaint ${created.harassment.complaintNumber} was escalated to the college level and requires review.`,
      relatedComplaintId: created.harassment.id,
    },
  });
  await prisma.notification.create({
    data: {
      userId: universityAdmin.id,
      type: 'COMPLAINT_ESCALATED',
      title: 'University-Level Escalation',
      message: `Complaint ${created.portal.complaintNumber} was escalated to the university level for coordinated resolution.`,
      relatedComplaintId: created.portal.id,
    },
  });
  await prisma.notification.create({
    data: {
      userId: student.id,
      type: 'FEEDBACK_REQUESTED',
      title: 'Feedback Requested',
      message: 'Your complaint about the WiFi in Library Block B is being handled. Share additional details any time.',
      relatedComplaintId: created.wifi.id,
    },
  });

  // ─── Trust scores ──────────────────────────────────────────────────────────
  for (const key of Object.keys(created)) {
    await TrustScoreService.calculate(created[key].id);
  }
  console.log('  ✓ trust scores calculated');

  // ─── Anonymous notices ─────────────────────────────────────────────────────
  console.log('\n📌 Anonymous complaint tracking IDs:');
  for (const [key, value] of Object.entries(created)) {
    const seedItem = seeds.find((s) => s.key === key);
    if (seedItem?.mode === 'ANONYMOUS') {
      console.log(`   ${key}: ${value.trackingId} (${value.complaintNumber})`);
    }
  }

  console.log(`\n🔑 Demo credentials — all users: Password@123`);
  console.log('   student@example.com (STUDENT)');
  console.log('   department.admin@example.com (DEPARTMENT_ADMIN — Academic Affairs)');
  console.log('   facilities.admin@example.com / it.admin@example.com / finance.admin@example.com (DEPARTMENT_ADMIN)');
  console.log('   college.admin@example.com (COLLEGE_ADMIN — CEAS)');
  console.log('   university.admin@example.com (UNIVERSITY_ADMIN)');
  console.log('   main.admin@example.com (MAIN_ADMIN)');

  console.log('\n✅ Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
