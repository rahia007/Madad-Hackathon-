import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import jsQR from 'jsqr';
import {
  CheckCircle2,
  Download,
  Printer,
  QrCode,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  Upload,
  X,
} from 'lucide-react';
import { apiFetch } from '../lib/apiClient.ts';
import { Lang, STATUS_LABELS } from '../lib/i18n.ts';

interface QrSlipModalProps {
  applicationId: number;
  lang: Lang;
  onClose: () => void;
}

export const QrSlipModal: React.FC<QrSlipModalProps> = ({
  applicationId,
  lang,
  onClose,
}) => {
  const [slip, setSlip] = useState<any>(null);
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    apiFetch<any>(`/api/applications/${applicationId}/slip-qr`)
      .then(async (res) => {
        if (!active) return;
        setSlip(res);
        const url = await QRCode.toDataURL(res.qrToken, {
          width: 260,
          margin: 2,
          color: { dark: '#17372E', light: '#FFFFFF' },
        });
        if (active) setQrDataUrl(url);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Unable to generate QR slip.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applicationId]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#202923]/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Cryptographic QR Case Slip"
    >
      <div className="w-full max-w-md rounded-xl border border-[#CED6CC] bg-[#FAF7F0] text-[#202923] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#CED6CC] bg-[#17372E] px-5 py-3.5 text-[#F4EFE5]">
          <div className="flex items-center gap-2">
            <QrCode className="h-4 w-4 text-[#B77B50]" />
            <span className="text-sm font-semibold">
              {lang === 'ur' ? 'تصدیق شدہ کیو آر کیس سلپ' : 'Signed QR Verification Slip'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {loading && <p className="text-sm text-[#5A655D]">Signing QR verification token...</p>}
          {error && (
            <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-3 text-sm text-[#A94F40]">
              {error}
            </div>
          )}

          {slip && qrDataUrl && (
            <>
              <div className="rounded-xl border border-[#CED6CC] bg-white p-5 flex flex-col items-center text-center space-y-3">
                <img
                  src={qrDataUrl}
                  alt={`QR Slip for ${slip.caseCode}`}
                  className="w-52 h-52 rounded-lg border border-[#CED6CC]"
                />
                <div>
                  <p className="font-mono-tabular text-sm font-bold text-[#17372E]">
                    {slip.caseCode}
                  </p>
                  <p className="text-sm font-semibold text-[#202923]">{slip.applicantName}</p>
                  <p className="text-xs text-[#5A655D]">
                    {STATUS_LABELS[slip.status]?.[lang] || slip.status} · {slip.district}
                  </p>
                </div>
                <div className="w-full rounded bg-[#FAF7F0] border border-[#CED6CC] p-2 text-[10px] font-mono-tabular text-[#4A554E] break-all">
                  {slip.qrToken}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <a
                  href={qrDataUrl}
                  download={`madad-slip-${slip.caseCode}.png`}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-[#17372E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1E473C]"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>{lang === 'ur' ? 'کیو آر محفوظ کریں' : 'Download PNG'}</span>
                </a>
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-[#CED6CC] bg-white px-4 py-2.5 text-xs font-semibold text-[#17372E]"
                >
                  <Printer className="h-3.5 w-3.5" />
                  <span>{lang === 'ur' ? 'پرنٹ' : 'Print'}</span>
                </button>
                <button
                  type="button"
                  onClick={() => navigator.clipboard?.writeText(slip.qrToken)}
                  className="inline-flex items-center justify-center rounded-lg border border-[#CED6CC] bg-white px-3 py-2.5 text-xs font-medium text-[#4A554E]"
                >
                  {lang === 'ur' ? 'ٹوکن کاپی' : 'Copy Token'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

interface QrVerifyModalProps {
  lang: Lang;
  onClose: () => void;
  initialToken?: string;
}

export const QrVerifyModal: React.FC<QrVerifyModalProps> = ({
  lang,
  onClose,
  initialToken = '',
}) => {
  const [qrInput, setQrInput] = useState(initialToken);
  const [verifying, setVerifying] = useState(false);
  const [scanMsg, setScanMsg] = useState('');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  const runVerify = async (tokenToVerify: string) => {
    const clean = tokenToVerify.trim();
    if (!clean) return;
    setVerifying(true);
    setError('');
    setResult(null);
    try {
      const res = await apiFetch('/api/applications/verify-qr', {
        method: 'POST',
        body: JSON.stringify({ qrToken: clean }),
      });
      setResult(res);
    } catch (err: any) {
      setError(err.message || 'Verification failed.');
    } finally {
      setVerifying(false);
    }
  };

  const handleImageUpload = (file: File | undefined) => {
    if (!file) return;
    setScanMsg('');
    setError('');
    const img = new Image();
    const objUrl = URL.createObjectURL(file);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas context unavailable');
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const decoded = jsQR(imageData.data, canvas.width, canvas.height);
        URL.revokeObjectURL(objUrl);
        if (decoded?.data) {
          setQrInput(decoded.data);
          setScanMsg(
            lang === 'ur'
              ? 'تصویر سے کیو آر کوڈ کامیابی سے پڑھ لیا گیا۔ تصدیق ہو رہی ہے...'
              : 'QR decoded from slip image. Verifying HMAC signature...'
          );
          void runVerify(decoded.data);
        } else {
          setError(
            lang === 'ur'
              ? 'اس تصویر میں واضح کیو آر کوڈ نہیں ملا۔ براہ کرم صاف تصویر اپ لوڈ کریں۔'
              : 'No readable QR code found in that image.'
          );
        }
      } catch (e: any) {
        URL.revokeObjectURL(objUrl);
        setError(e?.message || 'Could not decode QR image.');
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      setError('Invalid image file.');
    };
    img.src = objUrl;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#202923]/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="QR Slip Verifier"
    >
      <div className="w-full max-w-lg rounded-xl border border-[#CED6CC] bg-[#FAF7F0] text-[#202923] shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between border-b border-[#CED6CC] bg-[#17372E] px-5 py-3.5 text-[#F4EFE5]">
          <div className="flex items-center gap-2">
            <ScanLine className="h-4 w-4 text-[#B77B50]" />
            <span className="text-sm font-semibold">
              {lang === 'ur' ? 'کیو آر سلپ کی تصدیق' : 'Verify QR Relief Slip'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 hover:bg-white/10"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-xs text-[#4A554E]">
            {lang === 'ur'
              ? 'کیو آر سلپ کی تصویر اپ لوڈ کریں یا ٹوکن پیسٹ کر کے HMAC-SHA256 دستخط اور لائیو ڈیٹا بیس حالت چیک کریں۔'
              : 'Upload a downloaded QR slip PNG/JPEG or paste a MADAD-QR token to verify cryptographic HMAC authenticity against PostgreSQL.'}
          </p>

          <div className="flex flex-wrap gap-2">
            <label className="flex-1 inline-flex items-center justify-center gap-2 cursor-pointer rounded-lg border border-dashed border-[#17372E] bg-white px-4 py-3 text-xs font-semibold text-[#17372E] hover:bg-[#DCE6DA]/30">
              <Upload className="h-4 w-4 text-[#B77B50]" />
              <span>{lang === 'ur' ? 'کیو آر تصویر اسکین کریں' : 'Scan QR Slip Image (PNG/JPG)'}</span>
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => handleImageUpload(e.target.files?.[0])}
                className="hidden"
              />
            </label>

            <button
              type="button"
              onClick={() => {
                const fake = 'MADAD-QR:v1:eyJjYXNlQ29kZSI6IkMtRkFLRSJ9.forgedsignature12345';
                setQrInput(fake);
                void runVerify(fake);
              }}
              className="rounded-lg border border-[#A94F40]/50 bg-white px-3 py-2 text-xs font-medium text-[#A94F40] hover:bg-[#A94F40]/5"
            >
              {lang === 'ur' ? 'جعلی سلپ ٹیسٹ' : 'Test Tampered Slip'}
            </button>
          </div>

          {scanMsg && <p className="text-xs text-[#17372E] font-medium">{scanMsg}</p>}
          {error && (
            <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-3 text-xs text-[#A94F40]">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-semibold text-[#5A655D]">
              {lang === 'ur' ? 'کیو آر ٹوکن' : 'QR Token Payload'}
            </label>
            <textarea
              rows={2}
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              placeholder="MADAD-QR:v1:..."
              className="w-full rounded-lg border border-[#CED6CC] bg-white p-2.5 text-xs font-mono-tabular focus:outline-none focus:border-[#17372E]"
            />
            <button
              type="button"
              disabled={verifying || !qrInput.trim()}
              onClick={() => runVerify(qrInput)}
              className="w-full rounded-lg bg-[#17372E] py-2.5 text-sm font-semibold text-white hover:bg-[#1E473C] disabled:opacity-50"
            >
              {verifying
                ? lang === 'ur'
                  ? 'تصدیق ہو رہی ہے...'
                  : 'Verifying Signature...'
                : lang === 'ur'
                  ? 'تصدیق کریں'
                  : 'Verify Signature & Live Status'}
            </button>
          </div>

          {result && (
            <div
              className={`rounded-xl border p-4 space-y-2 text-xs ${
                result.verified && result.signatureValid
                  ? 'border-[#17372E]/40 bg-[#DCE6DA]/50'
                  : 'border-[#A94F40]/50 bg-[#A94F40]/10'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                {result.verified && result.signatureValid ? (
                  <>
                    <ShieldCheck className="h-5 w-5 text-[#17372E]" />
                    <span className="text-[#17372E]">
                      {lang === 'ur'
                        ? 'مستند سرکاری ڈیمو سلپ — HMAC دستخط درست ہے'
                        : 'Authentic Slip Verified — HMAC-SHA256 Valid'}
                    </span>
                  </>
                ) : (
                  <>
                    <ShieldAlert className="h-5 w-5 text-[#A94F40]" />
                    <span className="text-[#A94F40]">
                      {lang === 'ur' ? 'خبردار: جعلی یا تبدیل شدہ سلپ' : 'Verification Failed / Forged Slip'}
                    </span>
                  </>
                )}
              </div>

              {result.reason && <p className="text-[#A94F40]">{result.reason}</p>}

              {result.liveApplication && (
                <div className="rounded-lg border border-[#CED6CC] bg-white p-3 space-y-1 text-[#202923]">
                  <div className="flex items-center justify-between font-mono-tabular">
                    <span className="font-bold text-[#17372E]">{result.liveApplication.caseCode}</span>
                    <span className="inline-flex items-center gap-1 font-semibold text-[#17372E]">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      {STATUS_LABELS[result.liveApplication.status]?.[lang] || result.liveApplication.status}
                    </span>
                  </div>
                  <p>
                    Applicant: <strong>{result.liveApplication.applicantName}</strong> ({result.liveApplication.cnicMasked})
                  </p>
                  <p className="text-[#5A655D]">
                    District: {result.liveApplication.district} · Confidence:{' '}
                    {(result.liveApplication.confidence * 100).toFixed(0)}% · Rule v{result.liveApplication.ruleVersion}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
