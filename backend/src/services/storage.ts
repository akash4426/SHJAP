import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
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

// ─── Storage drivers (local private directory | S3-compatible | Supabase) ────

export interface UploadResult {
  filePath: string;
  fileName: string;
  url?: string;
}

export type StorageDriver = 'local' | 's3' | 'supabase';

/**
 * Resolve the active storage driver.
 * - `supabase` requires SUPABASE_URL + a secret key (SUPABASE_SECRET_KEY or
 *   legacy SUPABASE_SERVICE_ROLE_KEY)
 * - `s3`       requires (at least) S3_BUCKET
 * - anything else falls back to the private local directory
 */
export function getStorageDriver(): StorageDriver {
  const { driver } = config.upload;
  if (driver === 'supabase' && config.supabase.url && config.supabase.secretKey) {
    return 'supabase';
  }
  if (driver === 's3' && !!config.s3.bucket) return 's3';
  return 'local';
}

/** True when files live off-server (presigned URL downloads instead of streaming) */
export function usesRemoteStorage(): boolean {
  return getStorageDriver() !== 'local';
}

let s3Client: S3Client | null = null;
let supabaseClient: SupabaseClient | null = null;
let supabaseBucketChecked = false;

function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({
      region: config.s3.region,
      endpoint: config.s3.endpoint || undefined,
      credentials: {
        accessKeyId: config.s3.accessKey,
        secretAccessKey: config.s3.secretKey,
      },
      forcePathStyle: true, // MinIO, Supabase Storage and other S3-compatible services
    });
  }
  return s3Client;
}

function getSupabaseClient(): SupabaseClient {
  if (!supabaseClient) {
    supabaseClient = createClient(config.supabase.url, config.supabase.secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return supabaseClient;
}

/** Create the evidence bucket on first use (private); cached afterwards. */
async function ensureSupabaseBucket(): Promise<void> {
  if (supabaseBucketChecked) return;
  const client = getSupabaseClient();
  const bucket = config.supabase.storageBucket;
  const { error: getError } = await client.storage.getBucket(bucket);
  if (getError) {
    const { error } = await client.storage.createBucket(bucket, { public: false });
    if (error && !/already exists/i.test(error.message)) {
      throw new Error(`Supabase Storage: cannot create bucket "${bucket}": ${error.message}`);
    }
    storageLogger.info({ bucket }, 'Supabase Storage bucket created');
  }
  supabaseBucketChecked = true;
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

/** Upload a file to the configured private storage */
export async function uploadFile(
  file: Buffer,
  fileName: string,
  mimeType: string,
  complaintId: string
): Promise<UploadResult> {
  const filePath = generateEvidencePath(complaintId, fileName);
  const driver = getStorageDriver();

  if (driver === 'supabase') {
    await ensureSupabaseBucket();
    const client = getSupabaseClient();
    const bucket = config.supabase.storageBucket;
    const { error } = await client.storage
      .from(bucket)
      .upload(filePath, file, { contentType: mimeType, upsert: false });
    if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
    storageLogger.info({ filePath, complaintId, bucket }, 'Evidence uploaded to Supabase Storage');
    return { filePath, fileName };
  }

  if (driver === 's3') {
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
 * Download a file buffer. Remote drivers also support presigned URLs via
 * `getDownloadUrl`; only the authenticated evidence endpoint calls this —
 * files are never publicly reachable.
 */
export async function downloadFile(filePath: string): Promise<Buffer> {
  const driver = getStorageDriver();

  if (driver === 'supabase') {
    const client = getSupabaseClient();
    const { data, error } = await client.storage.from(config.supabase.storageBucket).download(filePath);
    if (error || !data) {
      throw new Error(`Supabase Storage download failed: ${error?.message ?? 'file unavailable'}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  if (driver === 's3') {
    const client = getS3Client();
    const response = await client.send(new GetObjectCommand({ Bucket: config.s3.bucket, Key: filePath }));
    const bytes = await response.Body?.transformToByteArray();
    return Buffer.from(bytes ?? []);
  }

  return fs.readFile(localPathFor(filePath));
}

/** Presigned/signed URL for remote drivers; null for local (caller streams bytes) */
export async function getDownloadUrl(filePath: string, expiresIn: number = 900): Promise<string | null> {
  const driver = getStorageDriver();

  if (driver === 'supabase') {
    const client = getSupabaseClient();
    const { data, error } = await client.storage
      .from(config.supabase.storageBucket)
      .createSignedUrl(filePath, expiresIn);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  }

  if (driver !== 's3') return null;

  const client = getS3Client();
  const command = new GetObjectCommand({ Bucket: config.s3.bucket, Key: filePath });
  return getSignedUrl(client, command, { expiresIn });
}

export async function deleteFile(filePath: string): Promise<void> {
  const driver = getStorageDriver();

  if (driver === 'supabase') {
    const client = getSupabaseClient();
    await client.storage.from(config.supabase.storageBucket).remove([filePath]);
    return;
  }

  if (driver === 's3') {
    const client = getS3Client();
    await client.send(new DeleteObjectCommand({ Bucket: config.s3.bucket, Key: filePath }));
    return;
  }

  await fs.unlink(localPathFor(filePath)).catch(() => undefined);
}

export async function fileExists(filePath: string): Promise<boolean> {
  const driver = getStorageDriver();

  if (driver === 'supabase') {
    const client = getSupabaseClient();
    const dir = path.posix.dirname(filePath);
    const base = path.posix.basename(filePath);
    const { data, error } = await client.storage
      .from(config.supabase.storageBucket)
      .list(dir, { search: base, limit: 100 });
    return !error && (data ?? []).some((file) => file.name === base);
  }

  if (driver === 's3') {
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
