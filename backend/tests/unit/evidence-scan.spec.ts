import { describe, it, expect } from 'vitest';
import { scanFileContent } from '../../src/services/storage.js';

/** Build a minimal valid 1x1 PNG buffer. */
function makePng(): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(1, 0);
  ihdr.writeUInt32BE(1, 4);
  ihdr.writeUInt8(8, 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from('IHDR_chunk_padding'),
    ihdr,
  ]);
}

describe('scanFileContent (unit) — magic-byte validation', () => {
  it('accepts real PNG bytes declared as image/png', async () => {
    const scan = await scanFileContent(makePng(), 'image/png');
    expect(scan.safe).toBe(true);
  });

  it('accepts real JPEG bytes declared as image/jpeg', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
    const scan = await scanFileContent(jpeg, 'image/jpeg');
    expect(scan.safe).toBe(true);
  });

  it('accepts real PDF bytes declared as application/pdf', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake content in a pdf file');
    const scan = await scanFileContent(pdf, 'application/pdf');
    expect(scan.safe).toBe(true);
  });

  it('rejects MZ executables regardless of declared type', async () => {
    const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00]);
    const scan = await scanFileContent(mz, 'image/png');
    expect(scan.safe).toBe(false);
    expect(scan.reason).toMatch(/executable/i);
  });

  it('rejects ELF binaries', async () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00]);
    const scan = await scanFileContent(elf, 'image/png');
    expect(scan.safe).toBe(false);
  });

  it('rejects content whose magic bytes contradict the declared type', async () => {
    const text = Buffer.from('this is definitely not a png file 1234567890');
    const scan = await scanFileContent(text, 'image/png');
    expect(scan.safe).toBe(false);
  });

  it('rejects files that are too small to sniff', async () => {
    const scan = await scanFileContent(Buffer.from('tiny'), 'image/png');
    expect(scan.safe).toBe(false);
  });

  it('rejects arbitrary unrecognized content', async () => {
    const scan = await scanFileContent(Buffer.from('zzzzzzzzzzzz-random-binaries-here'), 'image/png');
    expect(scan.safe).toBe(false);
    expect(scan.reason).toBeTruthy();
  });
});
