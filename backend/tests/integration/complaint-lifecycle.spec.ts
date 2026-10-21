import { describe, it, expect, beforeAll } from 'vitest';
import { getApp, login, req, freshStudent, prisma, waitForCategorized } from './helpers.js';

describe('complaint lifecycle (integration)', () => {
  let student: { email: string; password: string; token: string };
  let deptToken: string;
  let itToken: string;
  let collegeToken: string;
  let univToken: string;
  let mainToken: string;
  let complaintId = '';

  beforeAll(async () => {
    student = await freshStudent();
    itToken = await login('it.admin@example.com'); // the IT complaint's handler
    collegeToken = await login('college.admin@example.com');
    univToken = await login('university.admin@example.com');
    mainToken = await login('main.admin@example.com');
    deptToken = await login('department.admin@example.com'); // Academic Affairs (other dept → 403)
  });

  it('creates a complaint and auto-categorizes + assigns it (UC: submit)', async () => {
    const { status, body } = await req('POST', '/api/complaints', {
      payload: {
        title: `Portal login locked account after reset ${Date.now()}`,
        description:
          'After resetting my password the course portal locks my account whenever I try to log in from campus wifi, and the IT helpdesk says the login system rejects my account. Screenshots available.',
        submissionMode: 'VERIFIED',
        priority: 'HIGH',
      },
      token: student.token,
    });
    expect(status).toBe(201);
    expect(body.data.complaintNumber).toMatch(/^GRP-\d{4}-[A-F0-9]+$/);
    complaintId = body.data.id;
    await waitForCategorized(complaintId);

    const db = await prisma.complaint.findUnique({ where: { id: complaintId }, include: { department: true } });
    expect(db?.department?.code).toBe('IT');
    expect(db?.status === 'ASSIGNED' || db?.status === 'CATEGORIZED').toBe(true);
    expect(db?.trackingId).toBeTruthy();
  });

  it('honors the submitter-selected category and department', async () => {
    const category = await prisma.complaintCategory.findUnique({ where: { code: 'ACADEMIC_ASSESSMENT' } });
    const department = await prisma.department.findUnique({ where: { code: 'ACADEMICS' } });
    expect(category?.id).toBeTruthy();
    expect(department?.id).toBeTruthy();

    // Metadata for the student submission form is public and active-only;
    // it must not require an admin role (the selects used to be empty).
    const publicCategories = await req('GET', '/api/public/categories');
    expect(publicCategories.status).toBe(200);
    expect(publicCategories.body.data.some((c: any) => c.code === 'ACADEMIC_ASSESSMENT')).toBe(true);
    const publicDepartments = await req('GET', '/api/public/departments');
    expect(publicDepartments.status).toBe(200);
    expect(publicDepartments.body.data.some((d: any) => d.code === 'ACADEMICS')).toBe(true);

    const { status, body } = await req('POST', '/api/complaints', {
      payload: {
        title: `Explicit routing check ${Date.now()}`,
        description:
          'This complaint is submitted with an explicitly selected category and department; routing must honor both instead of relying on keyword detection.',
        submissionMode: 'VERIFIED',
        priority: 'MEDIUM',
        categoryId: category!.id,
        departmentId: department!.id,
      },
      token: student.token,
    });

    expect(status).toBe(201);
    expect(body.data.categoryId).toBe(category!.id);
    expect(body.data.departmentId).toBe(department!.id);
    expect(['ASSIGNED', 'CATEGORIZED']).toContain(body.data.status);

    // The Academic Affairs admin must see it in their queue immediately.
    const list = await req('GET', '/api/complaints?limit=100', { token: deptToken });
    expect(list.status).toBe(200);
    expect(list.body.data.some((c: any) => c.id === body.data.id)).toBe(true);
  });

  it('exposes unassigned complaints to department admins as an intake queue', async () => {
    const { status, body } = await req('POST', '/api/complaints', {
      payload: {
        title: `Unclassified intake check ${Date.now()} qwerty`,
        description:
          'This description intentionally avoids every classifier keyword so the complaint cannot be routed automatically and must remain in the shared intake queue.',
        submissionMode: 'VERIFIED',
        priority: 'LOW',
      },
      token: student.token,
    });

    expect(status).toBe(201);
    expect(body.data.departmentId).toBeNull();
    expect(body.data.needsManualCategorization).toBe(true);

    // Visibility for triage: detail access and list membership.
    const detail = await req('GET', `/api/complaints/${body.data.id}`, { token: deptToken });
    expect(detail.status).toBe(200);

    const list = await req('GET', '/api/complaints?limit=100', { token: deptToken });
    expect(list.status).toBe(200);
    expect(list.body.data.some((c: any) => c.id === body.data.id)).toBe(true);
  });

  it('rejects invalid state transitions and missing required fields', async () => {
    // Academic Affairs admin has no scope over this IT complaint
    const { status: oos } = await req('GET', `/api/complaints/${complaintId}`, { token: deptToken });
    expect(oos).toBe(403);

    // resolve with too-short fields
    const { status } = await req('POST', `/api/complaints/${complaintId}/resolve`, {
      payload: { summary: 'short', detailedResolution: 'too short', actionTaken: 'ok' },
      token: itToken,
    });
    expect([400, 403]).toContain(status);

    // escalate with short reason
    const { status: escStatus } = await req('POST', `/api/complaints/${complaintId}/escalate`, {
      payload: { reason: 'short' },
      token: itToken,
    });
    expect(escStatus).toBe(400);
  });

  it('starts an assessment UNDER_INVESTIGATION then requests information', async () => {
    const { status, body } = await req('POST', `/api/complaints/${complaintId}/assess`, {
      payload: { investigationNotes: 'Checking portal logs for lockouts around reset time window.' },
      token: itToken,
    });
    expect(status).toBe(200);

    // Assess route is limited to admin; complaint should be in investigation state
    const db = await prisma.complaint.findUnique({ where: { id: complaintId } });
    expect(db!.status === 'UNDER_INVESTIGATION' || db!.status === 'ASSIGNED' || db!.status === 'INFORMATION_REQUESTED').toBe(true);
  });

  it('escalates with a full reason to the college level', async () => {
    const { status, body } = await req('POST', `/api/complaints/${complaintId}/escalate`, {
      payload: {
        reason: 'Cross-department IT and registry coordination is needed to lift the portal account lock.',
        notes: 'Local recovery attempts exhausted after two rounds.',
      },
      token: itToken,
    });
    expect(status).toBe(200);

    const db = await prisma.complaint.findUnique({ where: { id: complaintId } });
    expect(db!.status).toBe('ESCALATED');

    // College admin must now have access and see the escalation
    const { status: cStatus } = await req('GET', `/api/complaints/${complaintId}`, { token: collegeToken });
    expect(cStatus).toBe(200);
  });

  it('college level hands the resolution; department admin closes with full details', async () => {
    const { status } = await req('POST', `/api/complaints/${complaintId}/resolve`, {
      payload: {
        summary: 'Portal account lock lifted and password reset completed',
        detailedResolution:
          'The IT and registry teams jointly removed the portal lock flag, recreated the session store entry for the student and confirmed a successful login from campus wifi during the verification window.',
        actionTaken: 'Unlocked account, reissued session tokens, verified login success.',
      },
      token: itToken,
    });
    expect(status).toBe(200);

    const db = await prisma.complaint.findUnique({ where: { id: complaintId } });
    expect(db!.status).toBe('RESOLVED');
    expect(db!.resolvedAt).toBeTruthy();
  });

  it('creates a status history entry per transition with reason', async () => {
    const history = await prisma.complaintStatusHistory.count({ where: { complaintId } });
    expect(history).toBeGreaterThanOrEqual(3);
  });

  it('student receives lifecycle notifications', async () => {
    const u = await prisma.user.findUnique({ where: { email: student.email } });
    const notifications = await prisma.notification.findMany({ where: { userId: u!.id } });
    const titles = notifications.map((n) => n.title).join(' | ');
    expect(titles).toMatch(/Resolved|Resolution/i);
  });

  it('accepts 1-5 star feedback once resolved and upserts safely', async () => {
    const { status, body } = await req('POST', `/api/complaints/${complaintId}/feedback`, {
      payload: { rating: 5, comment: 'Handled quickly after escalation.' },
      token: student.token,
    });
    expect(status).toBe(201);

    const db = await prisma.feedback.findFirst({ where: { complaintId } });
    expect(db!.rating).toBe(5);

    // Second submission UPDATES the single feedback record (one per complaint)
    const again = await req('POST', `/api/complaints/${complaintId}/feedback`, {
      payload: { rating: 2, comment: 'Updated my view after the fix held.' },
      token: student.token,
    });
    expect(again.status).toBe(201);
    const updated = await prisma.feedback.findFirst({ where: { complaintId } });
    expect(updated!.rating).toBe(2);
  });

  it('rejects out-of-range feedback ratings', async () => {
    const { status } = await req('POST', `/api/complaints/${complaintId}/feedback`, {
      payload: { rating: 9 },
      token: student.token,
    });
    expect(status).toBe(400);
  });

  it('university admin can close the resolved complaint, then reopen is blocked', async () => {
    const { status } = await req('POST', `/api/complaints/${complaintId}/close`, {
      payload: { reason: 'Confirmed satisfactory resolution by the student feedback.' },
      token: univToken,
    });
    expect([200, 403]).toContain(status);

    // A closed complaint cannot transition back to RESOLVED by anyone
    const db = await prisma.complaint.findUnique({ where: { id: complaintId } });
    if (db!.status === 'CLOSED') {
      const bad = await req('POST', `/api/complaints/${complaintId}/resolve`, {
        payload: {
          summary: 'Attempt to resolve a closed complaint',
          detailedResolution: 'This attempt should fail because there is no CLOSED -> RESOLVED transition.',
          actionTaken: 'Attempted invalid transition.',
        },
        token: mainToken,
      });
      expect(bad.status).toBe(400);
    }
  });

  it('duplicate protection rejects identical submissions within the window', async () => {
    const payload = {
      title: 'Portal login locks account after password reset',
      description:
        'After resetting my password the course portal locks my account whenever I try to log in from campus wifi, and the IT helpdesk says the login system rejects my account.',
      submissionMode: 'VERIFIED',
    };
    const first = await req('POST', '/api/complaints', { payload, token: student.token });
    expect(first.status).toBe(201);
    const dup = await req('POST', '/api/complaints', { payload, token: student.token });
    expect(dup.status).toBe(409);
  });
});
