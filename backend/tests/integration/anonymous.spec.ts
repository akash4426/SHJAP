import { describe, it, expect, beforeAll } from 'vitest';
import { login, req, prisma, waitForCategorized } from './helpers.js';

describe('anonymous complaints (integration)', () => {
  let mainToken: string;
  let univToken: string;
  let trackingId: string;
  let complaintId: string;

  const submitAnonymous = async (title: string, description: string) => {
    return req('POST', '/api/anonymous/complaints', {
      payload: { title, description, submissionMode: 'ANONYMOUS' },
    });
  };

  beforeAll(async () => {
    mainToken = await login('main.admin@example.com');
    univToken = await login('university.admin@example.com');
  });

  it('submits without authentication and returns only a tracking id', async () => {
    const { status, body } = await submitAnonymous(
      'Broken toilet door lock in dorm wing C',
      'The toilet door in dormitory wing C floor 2 does not lock and privacy cannot be maintained. Reported to janitor twice with no repair ticket issued so this needs facilities maintenance attention.'
    );
    expect(status).toBe(201);
    expect(body.data.trackingId).toMatch(/^TRK-/);
    expect(body.data.id).toBeUndefined();
    trackingId = body.data.trackingId;
  });

  it('auto-categorizes and assigns facilities staff without storing identity', async () => {
    const db = await prisma.complaint.findUnique({ where: { trackingId } });
    complaintId = db!.id;
    await waitForCategorized(complaintId);

    const withDept = await prisma.complaint.findUnique({
      where: { trackingId },
      include: { department: true, submittedBy: true },
    });
    expect(withDept?.department?.code).toBe('FACILITIES');
    expect(withDept?.isAnonymous).toBe(true);
    expect(withDept?.submittedById).toBeNull();
    expect(withDept?.submittedBy ?? null).toBeNull();
  });

  it('public tracking lookup reveals status history but never identity', async () => {
    const { status, body } = await req('GET', `/api/anonymous/complaints/${trackingId}`);
    expect(status).toBe(200);
    expect(body.data.statusHistory.length).toBeGreaterThanOrEqual(1);
    expect(body.data.submittedBy).toBeUndefined();
    trackingSideCheck(body.data);
  });

  function trackingSideCheck(data: any) {
    // Hard guarantees: anonymous payloads must not leak identity fields
    expect(data.submittedBy).toBeUndefined();
    expect(JsonHas(data, 'email')).toBe(false);
    expect(JsonHas(data, 'user')).toBe(false);
  }

  function JsonHas(value: unknown, key: string): boolean {
    return JSON.stringify(value ?? {}).toLowerCase().includes(`"${key.toLowerCase()}"`);
  }

  it('auto-categorizes and assigns facilities staff without storing identity', async () => {
    const db = await prisma.complaint.findUnique({
      where: { trackingId },
      include: { department: true, submittedBy: true },
    });
    expect(db?.department?.code).toBe('FACILITIES');
    expect(db?.isAnonymous).toBe(true);
    expect(db?.submittedById).toBeNull();
    expect(db?.submittedBy ?? null).toBeNull();
    complaintId = db!.id;
  });

  it('messaging and evidence-add are disabled for anonymous complaints', async () => {
    const { status: msgStatus } = await req('POST', `/api/complaints/${complaintId}/messages`, {
      payload: { message: 'Hello anonymous reporter' },
      token: mainToken,
    });
    expect(msgStatus).toBe(400);

    const { status: evStatus } = await req_multipart(
      `/api/complaints/${complaintId}/evidence`,
      'file', 'proof.png', PNG, 'image/png',
      mainToken
    );
    expect(evStatus).toBe(400);
  });

  it('tracking lookup for a bogus tracking id is 404', async () => {
    const { status } = await req('GET', '/api/anonymous/complaints/TRK-000000000000000000');
    expect(status).toBe(404);
  });

  it('anonymous submission rejects when fields are invalid', async () => {
    const { status } = await submitAnonymous('abc', 'way too short');
    expect(status).toBe(400);
  });

  it('admins can view anonymous complaints through scoped listing without identity', async () => {
    // MAIN admin has portal-wide scope; university admins are scoped to escalated/assigned work
    const { status, body } = await req('GET', '/api/complaints?submissionMode=ANONYMOUS&limit=10', { token: mainToken });
    expect(status).toBe(200);
    const target = body.data.find((c: any) => c.trackingId === trackingId);
    expect(target).toBeTruthy();
    expect(target.isAnonymous).toBe(true);
    // anonymous rows never carry identity, even for global admins
    expect(target.submittedBy).toBeNull();
    expect(target.submittedById).toBeNull();
  });
});

const PNG = buildPng();
function buildPng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ihdr,
  ]);
}

async function req_multipart(
  path: string,
  fileField: string,
  filename: string,
  content: Buffer,
  mime: string,
  token: string
): Promise<{ status: number; body: any }> {
  const { getApp } = await import('./helpers.js');
  const app = await getApp();
  const boundary = '----shjap-test';
  const res = await app.inject({
    method: 'POST',
    url: path,
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    payload: Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${fileField}"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
      ),
      content,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]),
  });
  let body: any;
  try { body = JSON.parse(res.body); } catch { body = res.body; }
  return { status: res.statusCode, body };
}
