import { describe, expect, it } from 'vitest';
import {
  computeAutoThreshold,
  evaluateEligibility,
  nameSimilarity,
  normalizeName,
} from '../src/lib/eligibility.ts';
import { analyzeDeterministicScamSignals } from '../src/lib/scamDeterministic.ts';
import {
  decryptSensitive,
  encryptSensitive,
  generateApiKey,
  hashApiKey,
  hashCnic,
  hashPassword,
  maskCnic,
  signQrSlipPayload,
  signSessionToken,
  signWebhookHmac,
  verifyPassword,
  verifyQrSlipPayload,
  verifySessionToken,
} from '../src/lib/crypto.ts';
import { isAllowedWebhookUrl } from '../server/services/mockAdapters.ts';

const BASE_RULE = {
  version: 1,
  maxIncome: 25000,
  minAge: 18,
  costWrong: 10,
  costSlow: 1,
  askBelow: 0.6,
};

const MOCK_REGISTRY = [
  {
    fullName: 'Fatima Bibi',
    cnicMasked: '42201-*******-2',
    cnicHash: hashCnic('42201-7654321-2'),
    age: 47,
    monthlyIncome: 12000,
  },
  {
    fullName: 'Muhammad Aslam',
    cnicMasked: '42101-*******-1',
    cnicHash: hashCnic('42101-1234567-1'),
    age: 54,
    monthlyIncome: 18000,
  },
  {
    fullName: 'Mohammad Aslam',
    cnicMasked: '42101-*******-1',
    cnicHash: hashCnic('42101-1234999-1'),
    age: 61,
    monthlyIncome: 30000,
  },
];

describe('Deterministic Eligibility & Asymmetric Error-Cost Engine', () => {
  it('computes asymmetric threshold from false approval vs delay cost', () => {
    expect(computeAutoThreshold({ costWrong: 10, costSlow: 1 })).toBeCloseTo(0.9091, 3);
  });

  it('normalizes Pakistani spelling variants cleanly', () => {
    expect(normalizeName('Muhammed Aslam')).toBe('muhammad aslam');
    expect(normalizeName('Mohd. Aslam')).toBe('muhammad aslam');
    expect(nameSimilarity('Mohamed Aslam', 'Muhammad Aslam')).toBe(1);
  });

  it('auto-approves a clean eligible match above threshold', () => {
    const res = evaluateEligibility(
      {
        name: 'Fatima Bibi',
        cnicHash: hashCnic('42201-7654321-2'),
        age: 47,
        monthlyIncome: 12000,
      },
      BASE_RULE,
      MOCK_REGISTRY
    );
    expect(res.route).toBe('auto');
    expect(res.deterministicEligible).toBe(true);
    expect(res.confidence).toBeGreaterThanOrEqual(0.909);
  });

  it('requests proof when minor typo reduces confidence between askBelow and autoThreshold', () => {
    const res = evaluateEligibility(
      {
        name: 'Fatma Bbi',
        cnicHash: hashCnic('42201-7654321-2'),
        age: 47,
        monthlyIncome: 12000,
      },
      BASE_RULE,
      MOCK_REGISTRY
    );
    expect(res.route).toBe('docs');
    expect(res.confidence).toBeGreaterThanOrEqual(0.6);
    expect(res.confidence).toBeLessThan(0.9091);
  });

  it('hands off duplicate identity ambiguity without CNIC to human officer', () => {
    const res = evaluateEligibility(
      { name: 'Muhammed Aslam' },
      BASE_RULE,
      MOCK_REGISTRY
    );
    expect(res.duplicateAmbiguity).toBe(true);
    expect(res.route).toBe('human');
  });

  it('never automatically rejects over-income cases; routes to human review', () => {
    const res = evaluateEligibility(
      {
        name: 'Mohammad Aslam',
        cnicHash: hashCnic('42101-1234999-1'),
        age: 61,
        monthlyIncome: 30000,
      },
      BASE_RULE,
      MOCK_REGISTRY
    );
    expect(res.deterministicEligible).toBe(false);
    expect(res.route).toBe('human');
  });
});

describe('Deterministic Scam Signal Analyzer', () => {
  it('flags urgency + OTP + suspicious URL', () => {
    const sig = analyzeDeterministicScamSignals(
      'URGENT: Your relief payment is blocked! Click http://bit.ly/claim and send CNIC and OTP today.'
    );
    expect(sig.urgencyTerms.length).toBeGreaterThan(0);
    expect(sig.otpOrCredentialRequests.length).toBeGreaterThan(0);
    expect(sig.suspiciousUrls.length).toBeGreaterThan(0);
    expect(sig.baselineScore).toBeGreaterThanOrEqual(0.7);
  });

  it('recognizes official 8171 reference without links or OTP requests', () => {
    const sig = analyzeDeterministicScamSignals(
      'Your claim was received. Track it on the official portal 8171.'
    );
    expect(sig.officialMarkers).toContain('8171');
    expect(sig.baselineScore).toBe(0);
  });
});

describe('Security & Cryptographic Helpers', () => {
  it('masks CNICs and encrypts/decrypts sensitive values with AES-256-GCM', () => {
    const raw = '42201-7654321-2';
    expect(maskCnic(raw)).toBe('42201-*******-2');
    const enc = encryptSensitive(raw);
    expect(enc).not.toContain('7654321');
    expect(decryptSensitive(enc)).toBe(raw);
  });

  it('hashes and verifies scrypt passwords safely', () => {
    const hash = hashPassword('MadadDemo2026!');
    expect(verifyPassword('MadadDemo2026!', hash)).toBe(true);
    expect(verifyPassword('WrongPass', hash)).toBe(false);
  });

  it('signs and verifies HMAC session tokens and rejects tampered payloads', () => {
    const token = signSessionToken({ userId: 1, uid: 'u1', email: 'a@b.pk' });
    const parsed = verifySessionToken(token);
    expect(parsed?.userId).toBe(1);
    const tampered = token.slice(0, -2) + 'xx';
    expect(verifySessionToken(tampered)).toBeNull();
  });

  it('generates and hashes API keys deterministically', () => {
    const { rawKey, prefix, hash } = generateApiKey();
    expect(rawKey.startsWith(prefix)).toBe(true);
    expect(hashApiKey(rawKey)).toBe(hash);
  });

  it('signs and verifies QR slip payloads and rejects forged tokens', () => {
    const token = signQrSlipPayload({
      caseCode: 'C-109-DEMO',
      citizenId: 1,
      status: 'approved',
      ruleVersion: 1,
      issuedAt: '2026-11-22T00:00:00.000Z',
    });
    expect(token.startsWith('MADAD-QR:v1:')).toBe(true);
    const ok = verifyQrSlipPayload(token);
    expect(ok.valid).toBe(true);
    expect(ok.payload?.caseCode).toBe('C-109-DEMO');

    const forged = token.slice(0, -3) + 'zzz';
    expect(verifyQrSlipPayload(forged).valid).toBe(false);
    expect(verifyQrSlipPayload('RANDOM-FAKE').valid).toBe(false);
  });

  it('enforces SSRF protection on outbound webhook URLs and signs HMAC payloads', () => {
    expect(isAllowedWebhookUrl('https://hooks.example.org/madad').ok).toBe(true);
    expect(isAllowedWebhookUrl('sandbox://madad-audit-inspector').ok).toBe(true);
    expect(isAllowedWebhookUrl('http://hooks.example.org/madad').ok).toBe(false);
    expect(isAllowedWebhookUrl('https://localhost:3000/hook').ok).toBe(false);
    expect(isAllowedWebhookUrl('https://127.0.0.1/hook').ok).toBe(false);
    expect(isAllowedWebhookUrl('https://169.254.169.254/latest').ok).toBe(false);
    expect(isAllowedWebhookUrl('https://192.168.1.5/hook').ok).toBe(false);

    const sig1 = signWebhookHmac('whsec_test', '{"event":"TEST"}');
    const sig2 = signWebhookHmac('whsec_test', '{"event":"TEST"}');
    expect(sig1).toBe(sig2);
    expect(sig1.length).toBe(64);
  });
});
