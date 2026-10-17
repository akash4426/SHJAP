import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { promises as fs } from 'fs';
import path from 'path';
import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { generateEvidencePath } from '../utils/crypto.js';
import { ValidationError } from '../utils/errors.js';

const storageLogger = logger.child({ service: 'storage' });

// ─── Security: content sniffing / malware validation hook ────────────────────

export interface ContentScanResult {
  safe: boolean;
  detectedMime?: string;
  reason?: string;
}

/**
 * Malware/content validation hook.
 *
 * Verifies the file's magic bytes against the claimed MIME type and rejects
 * executable formats outright. Designed to be extended with a ClamAV (or
 * similar) invocation — set MALWARE_SCAN_URL to POST the buffer to an
 * external scanner service when available.
 */
export async function scanFileContent(buffer: Buffer, claimedMime: string): Promise<ContentScanResult> {
  if (buffer.length < 8) {
    return { safe: false, reason: 'File too small to be valid' };
  }

  const sig = buffer.subarray(0, 12);

  const isJpeg = sig[0] === 0xff && sig[1] === 0xd8 && sig[2] === 0xff;
  const isPng = sig.subarray(0, 4).toString('hex') === '89504e47';
  const isGif = sig.subarray(0, 3).toString('ascii') === 'GIF';
  const isPdf = sig.subarray(0, 4).toString('ascii') === '%PDF';
  const isWebp = sig.subarray(0, 4).toString('ascii') === 'RIFF' && sig.subarray(8, 12).toString('ascii') === 'WEBP';
  const isDocx = sig.subarray(0, 2).toString('hex') === '504b'; // ZIP container (docx/xlsx)
  const isOldWord = sig.subarray(0, 8).toString('hex') === 'd0cf11e0a1b11ae1'; // CFB (msword)
  const isPE = sig[0] === 0x4d && sig[1] === 0x5a; // MZ executable
  const isElf = sig[0] === 0x7f && sig[1] === 0x45 && sig[2] === 0x4c && sig[3] === 0x46;
  const isMachO = (sig[0] === 0xcf || sig[0] === 0xca || sig[0] === 0xfe) && (sig[1] === 0xfa || sig[1] === 0xed || sig[1] === 0xba) && sig[2] === 0xfe;

  if (isPE || isElf || isMachO) {
    return { safe: false, reason: 'Executable content is not allowed' };
  }

  let detectedMime: string | undefined;
  if (isJpeg) detectedMime = 'image/jpeg';
  else if (isPng) detectedMime = 'image/png';
  else if (isGif) detectedMime = 'image/gif';
  else if (isWebp) detectedMime = 'image/webp';
  else if (isPdf) detectedMime = 'application/pdf';
  else if (isDocx) detectedMime = 'application/zip';
  else if (isOldWord) detectedMime = 'application/msword';

  const allowedFamily = (m: string): boolean =>
    claimedMime === m ||
    (claimedMime.startsWith('image/') && detectedMime?.startsWith('image/')) ||
    (claimedMime.startsWith('application/vnd.word') && detectedMime === 'application/zip') ||
    (claimedMime === 'application/msword' && detectedMime === 'application/msword');

  if (detectedMime && !allowedFamily(claimedMime)) {
    return { safe: false, detectedMime, reason: 'Actual file content does not match declared type' };
  }

  if (!detectedMime) {
    return { safe: false, reason: 'Unrecognized file content' };
  }

  // External malware scanner hook (optional)
  if (config.upload.malwareScanUrl) {
    try {
      const response = await fetch(config.upload.malwareScanUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(buffer),
        signal: AbortSignal.timeout(10_000),
      });
      const result = (await response.json()) as { clean?: boolean; infected?: boolean };
      if (result.clean === false || result.infected === true) {
        return { safe: false, reason: 'Malware signature detected' };
      }
    } catch (error) {
      storageLogger.warn({ err: error }, 'External malware scanner unavailable; continuing with content checks');
    }
  }

  return { safe: true, detectedMime };
}

// ─── Storage drivers (local private directory | S3-compatible) ───────────────

export interface UploadResult {
  filePath: string;
  fileName: string;
  url?: string;
}

let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint || undefined,
      credentials: {
        accessKeyId: config.s3.accessKey,
        secretAccessKey: config.s3.secretKey,
      },
      forcePathStyle: true, // MinIO and other S3-compatible services
    });
  }
  return s3Client;
}

/** Resolve the absolute local path guarding against path traversal */
function localPathFor(filePath: string): string {
  const base = path.resolve(config.upload.localStorageDir);
  const full = path.resolve(base, filePath);
  if (!full.startsWith(base + path.sep)) {
    throw new ValidationError('Invalid storage path');
  }
  return full;
}

export function isS3Enabled(): boolean {
  return config.upload.driver === 's3' && !!config.s3.bucket;
}

/** Upload a file to the configured private storage */
export async function uploadFile(
  file: Buffer,
  fileName: string,
  mimeType: string,
  complaintId: string
): Promise<UploadResult> {
  const filePath = generateEvidencePath(complaintId, fileName);

  if (isS3Enabled()) {
    const client = getS3Client();
    await client.send(new PutObjectCommand({
      Bucket: config.s3.bucket,
      Key: filePath,
      Body: file,
      ContentType: mimeType,
      Metadata: { originalName: fileName },
    }));
    storageLogger.info({ filePath, complaintId }, 'Evidence uploaded to S3');
    return { filePath, fileName };
  }

  const full = localPathFor(filePath);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, file);
  storageLogger.info({ filePath, complaintId }, 'Evidence uploaded to private storage');
  return { filePath, fileName };
}

/**
 * Download a file buffer (local driver). For S3, use getDownloadUrl instead.
 * Only the authenticated evidence endpoint calls this — files are never publicly reachable.
 */
export async function downloadFile(filePath: string): Promise<Buffer> {
  if (isS3Enabled()) {
    const client = getS3Client();
    const response = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: filePath }));
    const bytes = await response.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
  }
  return fs.readFile(localPathFor(filePath));
}

/** Presigned URL for S3 driver; for local driver the caller streams bytes instead */
export async function getDownloadUrl(filePath: string, expiresIn: number = 900): Promise<string | null> {
  if (!isS3Enabled()) return null;
  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: filePath });
  return getSignedUrl(client, command, { expiresIn });
}

export async function deleteFile(filePath: string): Promise<void> {
  if (isS3Enabled()) {
    const client = getS3Client();
    await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: filePath }));
    return;
  }
  await fs.unlink(localPathFor(filePath)).catch(() => undefined);
}

export async function fileExists(filePath: string): Promise<boolean> {
  if (isS3Enabled()) {
    try {
      const client = getS3Client();
      await client.send(new HeadObjectCommand({ Bucket: config.s3.bucket, Key: filePath }));
      return true;
    } catch {
      return false;
    }
  }
  try {
    await fs.access(localPathFor(filePath));
    return true;
  } catch {
    return false;
  }
}
