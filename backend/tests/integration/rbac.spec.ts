import { describe, it, expect, beforeAll } from 'vitest';
import { getApp, login, req, freshStudent, prisma, waitForCategorized } from './helpers.js';

describe('RBAC & complaint access control (integration)', () => {
  let studentA: { email: string; password: string; token: string };
  let studentB: { email: string; password: string; token: string };
  let deptToken: string;   // Academic Affairs admin
  let itToken: string;     // IT Services admin
  let collegeToken: string; // CEAS college admin
  let univToken: string;
  let mainToken: string;

  beforeAll(async () => {
    studentA = await freshStudent();
    studentB = await freshStudent();
    deptToken = await login('department.admin@example.com');
    itToken = await login('it.admin@example.com');
    collegeToken = await login('college.admin@example.com');
    univToken = await login('university.admin@example.com');
    mainToken = await login('main.admin@example.com');
  });

  /** Submit an IT-flavoured complaint as studentA (auto-categorized to IT). */
  async function submitItComplaint(): Promise<string> {
    const { status, body } = await req('POST', '/api/complaints', {
      payload: {
        title: `Wifi portal rejects valid password ${Date.now()}`,
        description:
          'When trying to login to the course registration portal from campus wifi my valid password is repeatedly rejected and support says the account is fine. Screenshots available on request for the investigation team.',
        submissionMode: 'VERIFIED',
        priority: 'HIGH',
      },
      token: studentA.token,
    });
    expect(status).toBe(201);
    const id = body.data.id as string;
    await waitForCategorized(id);
    return id;
  }

  it('students cannot access admin management endpoints', async () => {
    const { status } = await req('GET', '/api/admin/users', { token: studentA.token });
    expect(status).toBe(403);

    const { status: createStatus } = await req('POST', '/api/admin/users', {
      payload: { email: 'x@y.com', password: 'Password@123', firstName: 'X', lastName: 'Y', roles: ['STUDENT'] },
      token: studentA.token,
    });
    expect(createStatus).toBe(403);
  });

  it('department admins cannot open complaints outside their department', async () => {
    const id = await submitItComplaint();
    const { status } = await req('GET', `/api/complaints/${id}`, { token: deptToken });
    expect(status).toBe(403);
  });

  it('the assigned department admin can open the complaint', async () => {
    const id = await submitItComplaint();
    const { status, body } = await req('GET', `/api/complaints/${id}`, { token: itToken });
    expect(status).toBe(200);
    expect(body.data.department?.code ?? body.data.department).toBeTruthy();
  });

  it('students cannot open other students’ complaints', async () => {
    const id = await submitItComplaint();
    const { status } = await req('GET', `/api/complaints/${id}`, { token: studentB.token });
    expect(status).toBe(403);
  });

  it('the submitting student can open their own complaint', async () => {
    const id = await submitItComplaint();
    const { status } = await req('GET', `/api/complaints/${id}`, { token: studentA.token });
    expect(status).toBe(200);
  });

  it('department admins cannot assign complaints (reserved to higher roles)', async () => {
    const id = await submitItComplaint();
    const admin = await prisma.user.findFirst({ where: { email: 'it.admin@example.com' } });
    const { status } = await req('POST', `/api/complaints/${id}/assign`, {
      payload: { assignedToId: admin!.id },
      token: deptToken,
    });
    expect(status).toBe(403);
  });

  it('college and main admins can open complaints above their scope; university sees escalated work', async () => {
    const id = await submitItComplaint();

    // College and main admins have broad visibility
    for (const token of [collegeToken, mainToken]) {
      const { status } = await req('GET', `/api/complaints/${id}`, { token });
      expect(status).toBe(200);
    }

    // University admin is scoped to escalated/assigned-level work: fresh
    // department-level complaints are out of view until escalation
    const { status: fresh } = await req('GET', `/api/complaints/${id}`, { token: univToken });
    expect(fresh).toBe(403);

    // After escalation the university admin gains access (management by exception)
    const { status: esc } = await req('POST', `/api/complaints/${id}/escalate`, {
      payload: {
        reason: 'Recurring systemic outage across hostels requires university-level coordination.',
        notes: 'Pattern observed in multiple complaint reports.',
      },
      token: itToken,
    });
    expect(esc).toBe(200);
    const { status: afterEscalation } = await req('GET', `/api/complaints/${id}`, { token: univToken });
    expect(afterEscalation).toBe(200);
  });

  it('rejected/unknown complaint ids do not leak contents', async () => {
    const fakeId = '00000000-0000-4000-8000-000000000000';
    for (const token of [studentA.token, itToken]) {
      const { status } = await req('GET', `/api/complaints/${fakeId}`, { token });
      expect(status).toBe(404);
    }
  });

  it('POST /api/complaints rejects anonymous mode and points to the public channel', async () => {
    const { status, body } = await req('POST', '/api/complaints', {
      payload: {
        title: 'Trying anonymous through student endpoint',
        description:
          'This is a long enough description of the anonymous attempt through the authenticated complaint endpoint.',
        submissionMode: 'ANONYMOUS',
      },
      token: studentA.token,
    });
    expect(status).toBe(400);
    expect(String(body?.error?.message)).toMatch(/anonymous/i);
  });

  it('non-students cannot submit complaints through the student endpoint', async () => {
    const { status } = await req('POST', '/api/complaints', {
      payload: {
        title: 'Admin cannot ignore the student-only endpoint',
        description:
          'A department administrator should not be allowed to submit complaints through the student-only endpoint of the portal.',
        submissionMode: 'VERIFIED',
      },
      token: itToken,
    });
    expect(status).toBe(400);
  });

  it('list endpoints are role-scoped: students see only their own complaints', async () => {
    const id = await submitItComplaint();
    const { status, body } = await req('GET', '/api/complaints?limit=100', { token: studentB.token });
    expect(status).toBe(200);
    for (const c of body.data) {
      expect(c.id).not.toBe(id);
    }
  });
});
