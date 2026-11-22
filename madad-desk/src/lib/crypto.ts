import crypto from 'crypto';

// Ephemeral in-memory fallback if SESSION_SECRET is not set in environment.
const FALLBACK_SESSION_SECRET = crypto.randomBytes(32);

function getSessionSecret(): Buffer {
  const envSecret = process.env.SESSION_SECRET;
  if (envSecret && envSecret.length >= 16) {
    return crypto.createHash('sha256').update(envSecret).digest();
  }
  return FALLBACK_SESSION_SECRET;
}

function getEncryptionKey(): Buffer {
  const envKey = process.env.DATA_ENCRYPTION_KEY || process.env.SESSION_SECRET;
  if (envKey && envKey.length >= 16) {
    return crypto.createHash('sha256').update(envKey).digest();
  }
  // Stable key derived from project config when preview env lacks custom encryption key
  return crypto
    .createHash('sha256')
    .update(`madad-desk-dev-${process.env.SQL_DB_NAME || 'local'}`)
    .digest();
}

export function normalizeCnicDigits(cnic: string): string {
  return String(cnic || '').replace(/[^0-9]/g, '');
}

export function maskCnic(cnic: string): string {
  const digits = normalizeCnicDigits(cnic);
  if (digits.length < 6) {
    return digits ? `${digits.slice(0, 2)}***` : 'Not provided';
  }
  const first5 = digits.slice(0, 5);
  const last1 = digits.slice(-1);
  return `${first5}-*******-${last1}`;
}

export function hashCnic(cnic: string): string {
  const digits = normalizeCnicDigits(cnic);
  if (!digits) return '';
  return crypto.createHash('sha256').update(`cnic:${digits}`).digest('hex');
}

export function encryptSensitive(plainText: string): string {
  if (!plainText) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

export function decryptSensitive(cipherText: string): string {
  if (!cipherText || !cipherText.includes(':')) return '';
  const [ivHex, tagHex, dataHex] = cipherText.split(':');
  const decipher = crypto.createDecipheriv(
    'aes-256-gcm',
    getEncryptionKey(),
    Buffer.from(ivHex, 'hex')
  );
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataHex, 'hex')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, keyHex] = storedHash.split(':');
  const derived = crypto.scryptSync(password, salt, 64);
  const keyBuf = Buffer.from(keyHex, 'hex');
  if (derived.length !== keyBuf.length) return false;
  return crypto.timingSafeEqual(derived, keyBuf);
}

export interface SessionPayload {
  userId: number;
  uid: string;
  email: string;
  exp: number;
}

export function signSessionToken(payload: Omit<SessionPayload, 'exp'>): string {
  const fullPayload: SessionPayload = {
    ...payload,
    exp: Date.now() + 24 * 60 * 60 * 1000,
  };
  const encoded = Buffer.from(JSON.stringify(fullPayload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `md_${encoded}.${sig}`;
}

export function verifySessionToken(token: string): SessionPayload | null {
  if (!token.startsWith('md_')) return null;
  const body = token.slice(3);
  const parts = body.split('.');
  if (parts.length !== 2) return null;
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return null;
  if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as SessionPayload;
    if (!parsed.exp || parsed.exp < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function hashApiKey(rawKey: string): string {
  return crypto.createHash('sha256').update(rawKey).digest('hex');
}

export function generateApiKey(): { rawKey: string; prefix: string; hash: string } {
  const random = crypto.randomBytes(24).toString('base64url');
  const rawKey = `mdk_${random}`;
  return {
    rawKey,
    prefix: rawKey.slice(0, 10),
    hash: hashApiKey(rawKey),
  };
}

export interface QrSlipPayload {
  caseCode: string;
  citizenId: number;
  status: string;
  ruleVersion: number;
  issuedAt: string;
}

export function signQrSlipPayload(payload: QrSlipPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const sig = crypto
    .createHmac('sha256', getEncryptionKey())
    .update(`qr:${encoded}`)
    .digest('base64url')
    .slice(0, 22);
  return `MADAD-QR:v1:${encoded}.${sig}`;
}

export function verifyQrSlipPayload(rawToken: string): { valid: boolean; payload: QrSlipPayload | null; reason?: string } {
  const trimmed = String(rawToken || '').trim();
  if (!trimmed.startsWith('MADAD-QR:v1:')) {
    return { valid: false, payload: null, reason: 'Unrecognized QR slip format (must start with MADAD-QR:v1:).' };
  }
  const rest = trimmed.slice('MADAD-QR:v1:'.length);
  const parts = rest.split('.');
  if (parts.length !== 2) {
    return { valid: false, payload: null, reason: 'Malformed QR slip signature structure.' };
  }
  const [encoded, sig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', getEncryptionKey())
    .update(`qr:${encoded}`)
    .digest('base64url')
    .slice(0, 22);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { valid: false, payload: null, reason: 'Cryptographic signature mismatch — slip may be forged or altered.' };
  }
  try {
    const parsed = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8')) as QrSlipPayload;
    if (!parsed.caseCode || typeof parsed.citizenId !== 'number') {
      return { valid: false, payload: null, reason: 'Incomplete QR slip payload.' };
    }
    return { valid: true, payload: parsed };
  } catch {
    return { valid: false, payload: null, reason: 'Unable to decode QR slip JSON payload.' };
  }
}

export function signWebhookHmac(secret: string, bodyString: string): string {
  return crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
}
