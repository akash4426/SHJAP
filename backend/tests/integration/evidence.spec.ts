import { describe, it, expect, beforeAll } from 'vitest';
import { getApp, login, req, freshStudent, prisma, waitForCategorized } from './helpers.js';
import type { FastifyInstance } from 'fastify';

describe('evidence (integration)', () => {
  let student: { email: string; password: string; token: string };
  let itToken: string;
  let mainToken: string;
  let otherToken: string;
  let compliantId = '';

  function makePng(): Buffer {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ihdr,
    ]);
  }

  beforeAll(async () => {
    student = await freshStudent();
    itToken = await login('it.admin@example.com');
    mainToken = await login('main.admin@example.com');
    otherToken = await login('department.admin@example.com');

    const { status, body } = await req('POST', '/api/complaints', {
      payload: {
        title: `Wifi drops in exam hall library wing ${Date.now()}`,
        description:
          'The wifi access point drops connections to laptops in the exam hall library wing during tests, blocking online portals. Signal system traces attached in screenshots on proof of the interruption to the internet network.',
        submissionMode: 'VERIFIED',
      },
      token: student.token,
    });
    expect(status).toBe(201);
    compliantId = body.data.id;
    await waitForCategorized(compliantId);
  });

  async function upload(
    id: string,
    filename: string,
    content: Buffer,
    mime: string,
    token: string
  ): Promise<{ status: number; body: any }> {
    const app = await getApp();
    const boundary = '----shjap-test';
    const res = await app.inject({
      method: 'POST',
      url: `/api/complaints/${id}/evidence`,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': `multipart/form-data; boundary=${boundary}`,
      },
      payload: Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mime}\r\n\r\n`
        ),
        content,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]),
    });
    let body: any;
    try { body = JSON.parse(res.body); } catch { body = res.body; }
    return { status: res.statusCode, body };
  }

  it('accepts a valid PNG upload by the student', async () => {
    const { status, body } = await upload(compliantId, 'proof.png', makePng(), 'image/png', student.token);
    expect(status).toBe(201);
    const db = await prisma.evidence.findUnique({ where: { id: body.data.id } });
    expect(db!.type).toBe('IMAGE');
    expect(db!.isVerified).toBe(false);
  });

  it('rejects an executable extension outright', async () => {
    const { status } = await upload(compliantId, 'payload.exe', makePng(), 'image/png', student.token);
    expect(status).toBe(400);
  });

  it('rejects content that contradicts the declared MIME type', async () => {
    const { status } = await upload(compliantId, 'fake.png', Buffer.from('plain text, not a png'), 'image/png', student.token);
    expect(status).toBe(400);
  });

  it('rejects an extension/MIME mismatch', async () => {
    const { status } = await upload(compliantId, 'photo.jpeg', makePng(), 'image/png', student.token);
    expect(status).toBe(400);
  });

  it('lists evidence with metadata but never file content or server paths', async () => {
    const { status, body } = await req('GET', `/api/complaints/${compliantId}/evidence`, { token: student.token });
    expect(status).toBe(200);
    expect(body.data.length).toBe(1);
    for (const ev of body.data) {
      expect(ev.filePath).toBeUndefined();
      expect(ev.fileName).toBeUndefined();
      expect(ev.originalName).toBe('proof.png');
    }
  });

  it('admins verify evidence and trust score sees it', async () => {
    const ev = await prisma.evidence.findFirst({ where: { complaintId: compliantId } });
    const { status } = await req('POST', `/api/complaints/${compliantId}/evidence/${ev!.id}/verify`, { payload: {}, token: itToken });
    expect(status).toBe(200);

    const after = await prisma.evidence.findUnique({ where: { id: ev!.id } });
    expect(after!.isVerified).toBe(true);
  });

  it('the uploader can download their evidence as raw bytes', async () => {
    const ev = await prisma.evidence.findFirst({ where: { complaintId: compliantId } });
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/complaints/${compliantId}/evidence/${ev!.id}/download`,
      headers: { authorization: `Bearer ${student.token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload?.subarray(0, 4).equals(makePng().subarray(0, 4))).toBe(true);
  });

  it('other students cannot touch someone else’s evidence', async () => {
    const ev = await prisma.evidence.findFirst({ where: { complaintId: compliantId } });
    const other = await freshStudent();
    const app = await getApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/complaints/${compliantId}/evidence/${ev!.id}/download`,
      headers: { authorization: `Bearer ${other.token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('non-uploader admins cannot delete evidence; main admin can', async () => {
    const ev = await prisma.evidence.findFirst({ where: { complaintId: compliantId } });
    const forbidden = await req('DELETE', `/api/complaints/${compliantId}/evidence/${ev!.id}`, { token: itToken });
    expect(forbidden.status).toBe(400);

    const allowed = await req('DELETE', `/api/complaints/${compliantId}/evidence/${ev!.id}`, { token: student.token });
    expect(allowed.status).toBe(200);
  });

  it('deleting evidence triggers a trust score recalculation', async () => {
    const { status, body } = await upload(compliantId, 'second.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]), 'image/jpeg', student.token);
    expect(status).toBe(201);
    const trustBefore = await prisma.trustScore.findUnique({ where: { complaintId: compliantId } });
    expect(trustBefore).toBeTruthy();
  });
});
