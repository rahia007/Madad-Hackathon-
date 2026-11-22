export interface DeterministicScamSignals {
  urgencyTerms: string[];
  otpOrCredentialRequests: string[];
  paymentOrFeeRequests: string[];
  suspiciousUrls: string[];
  officialMarkers: string[];
  cnicRequests: boolean;
  baselineScore: number;
}

const URGENCY_PATTERNS = ['urgent', 'immediately', 'today', 'blocked', 'suspended', 'expire', 'last chance', 'فوری', 'آج ہی', 'بند'];
const OTP_PATTERNS = ['otp', 'pin', 'password', 'passcode', 'cvv', 'mpin', 'code', 'کوڈ', 'او ٹی پی', 'پن'];
const PAYMENT_PATTERNS = ['fee', 'charges', 'send rs', 'transfer', 'easypaisa', 'jazzcash', 'prize', 'claim now', 'فیس', 'انعام', 'بھیجیں'];
const URL_REGEX = /(https?:\/\/[^\s]+|(?:bit\.ly|tinyurl\.com|t\.co|rb\.gy)[^\s]*|[a-z0-9-]+\.(?:xyz|top|click|tk|ml|info)[^\s]*)/gi;
const OFFICIAL_PATTERNS = ['8171', 'official portal', 'nadra.gov.pk', 'bisp.gov.pk', 'pass.gov.pk'];

export function analyzeDeterministicScamSignals(message: string): DeterministicScamSignals {
  const lower = String(message || '').toLowerCase();
  const urgencyTerms = URGENCY_PATTERNS.filter((p) => lower.includes(p));
  const otpOrCredentialRequests = OTP_PATTERNS.filter((p) => lower.includes(p));
  const paymentOrFeeRequests = PAYMENT_PATTERNS.filter((p) => lower.includes(p));
  const suspiciousUrls = Array.from(new Set(lower.match(URL_REGEX) || []));
  const officialMarkers = OFFICIAL_PATTERNS.filter((p) => lower.includes(p));
  const cnicRequests = /\b(cnic|id card|شناختی کارڈ|شناختی نمبر)\b/i.test(lower);

  let score = 0;
  if (urgencyTerms.length > 0) score += 0.2;
  if (otpOrCredentialRequests.length > 0) score += 0.35;
  if (paymentOrFeeRequests.length > 0) score += 0.25;
  if (suspiciousUrls.length > 0) score += 0.3;
  if (cnicRequests && (suspiciousUrls.length > 0 || urgencyTerms.length > 0)) score += 0.15;
  if (officialMarkers.length > 0 && suspiciousUrls.length === 0 && otpOrCredentialRequests.length === 0) {
    score -= 0.25;
  }

  return {
    urgencyTerms,
    otpOrCredentialRequests,
    paymentOrFeeRequests,
    suspiciousUrls,
    officialMarkers,
    cnicRequests,
    baselineScore: Math.max(0, Math.min(1, Number(score.toFixed(2)))),
  };
}
