import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  FileUp,
  Info,
  Mic,
  QrCode,
  RefreshCw,
  ScanLine,
  ShieldCheck,
  Square,
  Upload,
  Volume2,
  WifiOff,
} from 'lucide-react';
import { apiFetch } from '../../lib/apiClient.ts';
import { COPY, Lang, ROUTE_LABELS, STATUS_LABELS, t } from '../../lib/i18n.ts';
import {
  clearLocalDraft,
  enqueueOfflineSubmission,
  listQueuedSubmissions,
  listSyncHistory,
  loadLocalDraft,
  OfflineQueuedSubmission,
  recordSyncHistory,
  removeQueuedSubmission,
  saveLocalDraft,
  SyncHistoryEvent,
} from '../../lib/offlineQueue.ts';
import { ConfidenceGauge } from '../ConfidenceGauge.tsx';
import { DecisionRoomModal } from '../DecisionRoomModal.tsx';
import { PolicyRagExplorer } from '../PolicyRagExplorer.tsx';
import { QrSlipModal, QrVerifyModal } from '../QrSlipModal.tsx';

interface CitizenPortalProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  lang: Lang;
  isOnline: boolean;
  simulatedOffline: boolean;
  onSpeakText: (text: string) => void;
  helperTargetCitizen?: { citizenId: number; fullName: string } | null;
}

const DEMO_EXAMPLES = [
  {
    id: 'clean',
    labelEn: 'Clean Match (Fatima)',
    labelUr: 'درست میل (فاطمہ)',
    applicantName: 'Fatima Bibi',
    cnic: '42201-7654321-2',
    age: '47',
    monthlyIncome: '12000',
    district: 'Karachi South',
    householdDetails: 'Widow supporting 3 school-going children.',
  },
  {
    id: 'spelling',
    labelEn: 'Spelling Variation',
    labelUr: 'ہجے مختلف (اسلم)',
    applicantName: 'Mohamed Aslam',
    cnic: '42101-1234567-1',
    age: '54',
    monthlyIncome: '18000',
    district: 'Karachi Central',
    householdDetails: 'Daily-wage construction worker.',
  },
  {
    id: 'duplicate',
    labelEn: 'Two Aslams, No CNIC',
    labelUr: 'دو اسلم، کارڈ نہیں',
    applicantName: 'Muhammed Aslam',
    cnic: '',
    age: '',
    monthlyIncome: '',
    district: 'Lahore',
    householdDetails: 'CNIC misplaced; seeking verification help.',
  },
  {
    id: 'typo',
    labelEn: 'Typo in Name',
    labelUr: 'نام میں غلطی',
    applicantName: 'Fatma Bibi',
    cnic: '42201-7654321-2',
    age: '47',
    monthlyIncome: '12000',
    district: 'Karachi South',
    householdDetails: 'Applied via neighborhood clinic phone.',
  },
  {
    id: 'over',
    labelEn: 'Over Income Limit',
    labelUr: 'آمدن حد سے زیادہ',
    applicantName: 'Mohammad Aslam',
    cnic: '42101-1234999-1',
    age: '61',
    monthlyIncome: '30000',
    district: 'Lahore',
    householdDetails: 'Small shopkeeper with medical expenses.',
  },
];

export const CitizenPortal: React.FC<CitizenPortalProps> = ({
  activeTab,
  onTabChange,
  lang,
  isOnline,
  simulatedOffline,
  onSpeakText,
  helperTargetCitizen,
}) => {
  const effectiveOffline = !isOnline || simulatedOffline;

  // Form state
  const [applicantName, setApplicantName] = useState(helperTargetCitizen?.fullName || '');
  const [cnic, setCnic] = useState('');
  const [age, setAge] = useState('');
  const [monthlyIncome, setMonthlyIncome] = useState('');
  const [district, setDistrict] = useState('Karachi South');
  const [contactPhone, setContactPhone] = useState('0300-5550199');
  const [householdDetails, setHouseholdDetails] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formNotice, setFormNotice] = useState('');
  const [lastResult, setLastResult] = useState<any>(null);

  // Voice-to-Form state
  const [voicePhrase, setVoicePhrase] = useState('');
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceFilling, setVoiceFilling] = useState(false);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceStreamRef = useRef<MediaStream | null>(null);

  // Cases, QR & offline queue state
  const [cases, setCases] = useState<any[]>([]);
  const [casesLoading, setCasesLoading] = useState(false);
  const [queuedItems, setQueuedItems] = useState<OfflineQueuedSubmission[]>([]);
  const [syncHistory, setSyncHistory] = useState<SyncHistoryEvent[]>([]);
  const [syncing, setSyncing] = useState(false);
  const [decisionRoomAppId, setDecisionRoomAppId] = useState<number | null>(null);
  const [qrSlipAppId, setQrSlipAppId] = useState<number | null>(null);
  const [showQrVerify, setShowQrVerify] = useState(false);

  // Scam checker state
  const [scamText, setScamText] = useState('');
  const [scamRegion, setScamRegion] = useState('Karachi');
  const [scamImageBase64, setScamImageBase64] = useState<string | null>(null);
  const [scamImageMime, setScamImageMime] = useState<'image/jpeg' | 'image/png' | 'image/webp' | null>(null);
  const [scamLoading, setScamLoading] = useState(false);
  const [scamResult, setScamResult] = useState<any>(null);
  const [scamHistory, setScamHistory] = useState<any[]>([]);
  const [scamMap, setScamMap] = useState<any[]>([]);
  const [scamError, setScamError] = useState('');

  // Consents state
  const [consents, setConsents] = useState<any[]>([]);
  const [consentHistory, setConsentHistory] = useState<any[]>([]);
  const [consentLoading, setConsentLoading] = useState(false);

  const loadCases = async () => {
    setCasesLoading(true);
    try {
      const res = await apiFetch<{ applications: any[] }>('/api/applications');
      setCases(res.applications || []);
    } catch {
      // keep existing when offline
    } finally {
      setCasesLoading(false);
    }
  };

  const loadOfflineStores = async () => {
    const [q, h, d] = await Promise.all([
      listQueuedSubmissions(),
      listSyncHistory(),
      loadLocalDraft(),
    ]);
    setQueuedItems(q);
    setSyncHistory(h);
    if (d && !applicantName) {
      setApplicantName(d.applicantName);
      setAge(d.age);
      setMonthlyIncome(d.monthlyIncome);
      setHouseholdDetails(d.householdDetails);
      setContactPhone(d.contactPhone);
      setDistrict(d.district);
    }
  };

  const loadScamData = async () => {
    try {
      const res = await apiFetch<{ history: any[]; regionalMap: any[] }>('/api/ai/scam-history');
      setScamHistory(res.history || []);
      setScamMap(res.regionalMap || []);
    } catch {
      // offline
    }
  };

  const loadConsents = async () => {
    setConsentLoading(true);
    try {
      const res = await apiFetch<{ consents: any[]; history: any[] }>('/api/consents');
      setConsents(res.consents || []);
      setConsentHistory(res.history || []);
    } catch {
      // offline
    } finally {
      setConsentLoading(false);
    }
  };

  useEffect(() => {
    loadOfflineStores();
    if (!effectiveOffline) {
      loadCases();
      loadScamData();
      loadConsents();
    }
  }, [activeTab]);

  useEffect(() => {
    if (helperTargetCitizen?.fullName) {
      setApplicantName(helperTargetCitizen.fullName);
    }
  }, [helperTargetCitizen?.citizenId]);

  const syncOfflineQueue = async () => {
    if (effectiveOffline || syncing) return;
    const items = await listQueuedSubmissions();
    if (items.length === 0) return;

    setSyncing(true);
    let syncedCount = 0;
    for (const item of items) {
      try {
        const res = await apiFetch<{ application: any; duplicatePrevented?: boolean }>(
          '/api/applications',
          {
            method: 'POST',
            body: JSON.stringify({
              applicantName: item.applicantName,
              cnic: item.cnic,
              age: item.age,
              monthlyIncome: item.monthlyIncome,
              householdDetails: item.householdDetails,
              contactPhone: item.contactPhone,
              district: item.district,
              targetCitizenId: item.targetCitizenId,
              idempotencyKey: item.idempotencyKey,
              offlineCreatedAt: item.offlineCreatedAt,
            }),
          }
        );
        await removeQueuedSubmission(item.idempotencyKey);
        await recordSyncHistory({
          id: `${item.idempotencyKey}-${Date.now()}`,
          idempotencyKey: item.idempotencyKey,
          caseCode: res.application.caseCode,
          applicantName: item.applicantName,
          syncedAt: new Date().toISOString(),
          outcome: res.duplicatePrevented ? 'duplicate_skipped' : 'synced',
        });
        syncedCount++;
      } catch {
        // leave in outbox for next retry
      }
    }
    await loadOfflineStores();
    await loadCases();
    setSyncing(false);
    if (syncedCount > 0) {
      setFormNotice(
        lang === 'ur'
          ? `${syncedCount} آف لائن درخواستیں سرور پر محفوظ ہو گئیں۔`
          : `Synchronized ${syncedCount} offline application(s) with server confirmation.`
      );
    }
  };

  // Auto-sync when connectivity returns
  useEffect(() => {
    if (!effectiveOffline) {
      syncOfflineQueue();
    }
  }, [effectiveOffline]);

  const handleSaveDraft = async () => {
    setFormError('');
    setFormNotice('');
    if (!applicantName.trim()) {
      setFormError(lang === 'ur' ? 'مسودہ محفوظ کرنے کے لیے نام لکھیں۔' : 'Enter applicant name to save draft.');
      return;
    }

    if (effectiveOffline) {
      await saveLocalDraft({
        id: 'active_citizen_draft',
        applicantName,
        cnicMaskedPreview: cnic ? `${cnic.slice(0, 5)}***` : '',
        age,
        monthlyIncome,
        householdDetails,
        contactPhone,
        district,
        savedAt: new Date().toISOString(),
      });
      setFormNotice(
        lang === 'ur'
          ? 'مسودہ صرف اس ڈیوائس پر محفوظ ہوا ہے (آف لائن)۔'
          : 'Draft saved locally on this device (not yet synced to server).'
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/applications', {
        method: 'POST',
        body: JSON.stringify({
          applicantName,
          cnic,
          age: age ? Number(age) : null,
          monthlyIncome: monthlyIncome ? Number(monthlyIncome) : null,
          householdDetails,
          contactPhone,
          district,
          targetCitizenId: helperTargetCitizen?.citizenId,
          isDraft: true,
        }),
      });
      setFormNotice(
        lang === 'ur'
          ? `مسودہ سرور پر محفوظ ہو گیا (${res.application.caseCode})۔`
          : `Draft saved on server (${res.application.caseCode}).`
      );
      await loadCases();
    } catch (err: any) {
      setFormError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitApplication = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormNotice('');
    setLastResult(null);

    if (applicantName.trim().length < 2) {
      setFormError(lang === 'ur' ? 'براہ کرم پورا نام لکھیں۔' : 'Please enter full name.');
      return;
    }

    const idempotencyKey = `sub-${applicantName.trim().toLowerCase()}-${cnic.trim() || 'nocnic'}-${Date.now().toString(36)}`;

    if (effectiveOffline) {
      await enqueueOfflineSubmission({
        idempotencyKey,
        applicantName: applicantName.trim(),
        cnic: cnic.trim(),
        age: age ? Number(age) : null,
        monthlyIncome: monthlyIncome ? Number(monthlyIncome) : null,
        householdDetails,
        contactPhone,
        district,
        targetCitizenId: helperTargetCitizen?.citizenId,
        offlineCreatedAt: new Date().toISOString(),
        status: 'pending_sync',
      });
      await clearLocalDraft();
      await loadOfflineStores();
      setFormNotice(
        lang === 'ur'
          ? 'انٹرنیٹ بند ہے۔ درخواست اس ڈیوائس کی قطار میں محفوظ ہو گئی ہے اور سگنل آتے ہی خودکار طور پر بھیجی جائے گی۔'
          : 'Offline mode: queued locally in IndexedDB. It has NOT synced to the server yet and will upload automatically when connectivity returns.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const res = await apiFetch('/api/applications', {
        method: 'POST',
        body: JSON.stringify({
          applicantName: applicantName.trim(),
          cnic: cnic.trim(),
          age: age ? Number(age) : null,
          monthlyIncome: monthlyIncome ? Number(monthlyIncome) : null,
          householdDetails,
          contactPhone,
          district,
          targetCitizenId: helperTargetCitizen?.citizenId,
          idempotencyKey,
        }),
      });

      if (selectedFile && res.application?.id) {
        const fd = new FormData();
        fd.append('file', selectedFile);
        await apiFetch(`/api/applications/${res.application.id}/documents`, {
          method: 'POST',
          body: fd,
        });
        setSelectedFile(null);
      }

      await clearLocalDraft();
      setLastResult(res);
      await loadCases();
    } catch (err: any) {
      setFormError(err.message || 'Submission failed.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUploadProofToCase = async (appId: number, file: File) => {
    try {
      const fd = new FormData();
      fd.append('file', file);
      await apiFetch(`/api/applications/${appId}/documents`, {
        method: 'POST',
        body: fd,
      });
      await loadCases();
      setFormNotice(
        lang === 'ur'
          ? 'دستاویز محفوظ طریقے سے اپ لوڈ ہو گئی۔'
          : 'Supporting document uploaded and scanned.'
      );
    } catch (err: any) {
      setFormError(err.message);
    }
  };

  const handleSubmitDraftCase = async (appId: number) => {
    try {
      await apiFetch(`/api/applications/${appId}/submit`, { method: 'POST' });
      await loadCases();
    } catch (err: any) {
      setFormError(err.message);
    }
  };

  const handleScamImagePick = (file: File | undefined) => {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setScamError('Please upload a PNG, JPEG, or WebP screenshot.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const base64 = dataUrl.split(',')[1] || '';
      setScamImageBase64(base64);
      setScamImageMime(file.type as 'image/jpeg' | 'image/png' | 'image/webp');
    };
    reader.readAsDataURL(file);
  };

  const handleRunScamCheck = async () => {
    setScamError('');
    setScamResult(null);
    if (!scamText.trim() && !scamImageBase64) {
      setScamError(
        lang === 'ur'
          ? 'پیغام پیسٹ کریں یا اسکرین شاٹ اپ لوڈ کریں۔'
          : 'Paste a message or upload a screenshot first.'
      );
      return;
    }
    setScamLoading(true);
    try {
      const res = await apiFetch<{ result: any }>('/api/ai/scam-check', {
        method: 'POST',
        body: JSON.stringify({
          message: scamText,
          imageBase64: scamImageBase64 || undefined,
          imageMimeType: scamImageMime || undefined,
          region: scamRegion,
        }),
      });
      setScamResult(res.result);
      await loadScamData();
    } catch (err: any) {
      setScamError(err.message || 'Scam analysis failed.');
    } finally {
      setScamLoading(false);
    }
  };

  const handleToggleConsent = async (scope: string, nextGranted: boolean) => {
    try {
      await apiFetch('/api/consents', {
        method: 'POST',
        body: JSON.stringify({ scope, granted: nextGranted }),
      });
      await loadConsents();
    } catch (err: any) {
      setFormError(err.message);
    }
  };

  const applyExtractedFields = (ext: any) => {
    if (ext.applicantName) setApplicantName(ext.applicantName);
    if (ext.cnic) setCnic(ext.cnic);
    if (ext.age !== null && ext.age !== undefined) setAge(String(ext.age));
    if (ext.monthlyIncome !== null && ext.monthlyIncome !== undefined) {
      setMonthlyIncome(String(ext.monthlyIncome));
    }
    if (ext.district) setDistrict(ext.district);
    if (ext.householdDetails) setHouseholdDetails(ext.householdDetails);
    if (ext.transcript) setVoicePhrase(ext.transcript);

    const msg = lang === 'ur' ? ext.confirmationUr : ext.confirmationEn;
    setFormNotice(msg);
    onSpeakText(msg);
  };

  const handleVoiceTextAutoFill = async (overrideText?: string) => {
    const clean = (overrideText ?? voicePhrase).trim();
    if (!clean) return;
    if (overrideText) setVoicePhrase(overrideText);
    setFormError('');
    setFormNotice('');
    setVoiceFilling(true);
    try {
      const ext = await apiFetch('/api/ai/voice/fill-form', {
        method: 'POST',
        body: JSON.stringify({ text: clean, lang }),
      });
      applyExtractedFields(ext);
    } catch (err: any) {
      setFormError(err.message || 'Voice-to-Form extraction failed.');
    } finally {
      setVoiceFilling(false);
    }
  };

  const toggleVoiceFormMic = async () => {
    if (voiceRecording) {
      try {
        voiceRecorderRef.current?.stop();
      } catch {
        // ignore
      }
      return;
    }

    setFormError('');
    setFormNotice('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceStreamRef.current = stream;
      const recorder = new MediaRecorder(stream);
      voiceRecorderRef.current = recorder;
      const chunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = async () => {
        setVoiceRecording(false);
        voiceStreamRef.current?.getTracks().forEach((t) => t.stop());
        voiceStreamRef.current = null;
        setVoiceFilling(true);
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          const buf = await blob.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let bin = '';
          for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
          const ext = await apiFetch('/api/ai/voice/fill-form', {
            method: 'POST',
            body: JSON.stringify({
              audioBase64: btoa(bin),
              mimeType: blob.type || 'audio/webm',
              lang,
            }),
          });
          applyExtractedFields(ext);
        } catch (err: any) {
          setFormError(err.message || 'Could not process voice audio.');
        } finally {
          setVoiceFilling(false);
        }
      };
      recorder.start();
      setVoiceRecording(true);
    } catch {
      setFormError(
        lang === 'ur'
          ? 'مائیکروفون دستیاب نہیں۔ نیچے بولنے کا جملہ لکھ کر "فارم بھریں" دبائیں۔'
          : 'Microphone unavailable. Type or tap a sample spoken sentence below to auto-fill.'
      );
    }
  };

  // ---------------------------------------------------------------------------
  // TAB 1: APPLY FOR RELIEF
  // ---------------------------------------------------------------------------
  if (activeTab === 'apply') {
    return (
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#CED6CC] pb-6">
          <div className="space-y-1.5 max-w-2xl">
            {helperTargetCitizen && (
              <p className="text-xs font-semibold text-[#B77B50]">
                {lang === 'ur'
                  ? `ہیلپر موڈ: ${helperTargetCitizen.fullName} کے لیے درخواست`
                  : `Applying on behalf of ${helperTargetCitizen.fullName} (Verified Consent)`}
              </p>
            )}
            <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
              {t(COPY.applyForm.heading, lang)}
            </h2>
            <p className="text-sm text-[#4A554E] leading-relaxed">
              {t(COPY.applyForm.sub, lang)}
            </p>
          </div>
          <button
            type="button"
            onClick={() =>
              onSpeakText(
                lang === 'ur'
                  ? 'اپنا پورا نام، شناختی کارڈ نمبر، عمر اور ماہانہ آمدن لکھیں۔ اگر شناختی کارڈ کی تصویر ہے تو ساتھ لگائیں، اور درخواست بھیجیں کا بٹن دبائیں۔'
                  : 'Enter your full name, CNIC number, age, and monthly household income. Attach a supporting document if available, then press Submit Application.'
              )
            }
            className="flex items-center gap-2 rounded-lg bg-[#B77B50] px-4 py-3 text-sm font-semibold text-white hover:bg-[#a06942] shrink-0 min-h-[44px]"
          >
            <Volume2 className="h-5 w-5" />
            <span>{lang === 'ur' ? 'ہدایت سنیں' : 'Listen Guide'}</span>
          </button>
        </div>

        {formError && (
          <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-4 text-sm text-[#A94F40]">
            {formError}
          </div>
        )}
        {formNotice && (
          <div className="rounded-lg border border-[#17372E]/30 bg-[#DCE6DA]/50 p-4 text-sm text-[#17372E]">
            {formNotice}
          </div>
        )}

        {/* Voice-to-Form Auto-Fill Bar */}
        {!effectiveOffline && (
          <div className="rounded-xl border border-[#17372E]/25 bg-[#FAF7F0] p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-[#17372E] flex items-center gap-2">
                  <Mic className="h-4 w-4 text-[#B77B50]" />
                  <span>
                    {lang === 'ur'
                      ? 'بول کر فارم خودکار بھریں (اردو / انگریزی)'
                      : 'Voice-to-Form Auto-Fill (Speak Urdu or English)'}
                  </span>
                </h3>
                <p className="text-xs text-[#5A655D]">
                  {lang === 'ur'
                    ? 'اپنا نام، شناختی کارڈ، عمر، ماہانہ آمدن اور ضلع بولیں — AI خود خانے بھر دے گا۔'
                    : 'Speak your name, CNIC, age, monthly income, and district — Gemini extracts structured fields automatically.'}
                </p>
              </div>
              <button
                type="button"
                onClick={toggleVoiceFormMic}
                disabled={voiceFilling}
                className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-xs font-semibold text-white ${
                  voiceRecording ? 'bg-[#A94F40]' : 'bg-[#17372E] hover:bg-[#1E473C]'
                } disabled:opacity-50`}
              >
                {voiceRecording ? <Square className="h-3.5 w-3.5" /> : <Mic className="h-3.5 w-3.5" />}
                <span>
                  {voiceRecording
                    ? lang === 'ur'
                      ? 'ریکارڈنگ روکیں'
                      : 'Stop & Fill Form'
                    : voiceFilling
                      ? lang === 'ur'
                        ? 'فارم بھرا جا رہا ہے...'
                        : 'Extracting Fields...'
                      : lang === 'ur'
                        ? 'مائیک سے بولیں'
                        : 'Speak to Fill'}
                </span>
              </button>
            </div>

            <div className="flex flex-wrap gap-2">
              <input
                type="text"
                value={voicePhrase}
                onChange={(e) => setVoicePhrase(e.target.value)}
                placeholder={
                  lang === 'ur'
                    ? 'یا یہاں جملہ لکھیں: میرا نام فاطمہ بی بی ہے، عمر 47 سال، آمدن 12000 روپے، ضلع کراچی ساؤتھ'
                    : 'Or paste/speak e.g. "My name is Fatima Bibi, CNIC 42201-7654321-2, age 47, income 12000 in Karachi South"'
                }
                className="flex-1 min-w-[220px] rounded-lg border border-[#CED6CC] bg-white px-3 py-2 text-xs"
              />
              <button
                type="button"
                disabled={voiceFilling || !voicePhrase.trim()}
                onClick={() => handleVoiceTextAutoFill()}
                className="rounded-lg bg-[#B77B50] px-4 py-2 text-xs font-semibold text-white hover:bg-[#a06942] disabled:opacity-50"
              >
                {lang === 'ur' ? 'فارم بھریں' : 'Auto-Fill'}
              </button>
              <button
                type="button"
                disabled={voiceFilling}
                onClick={() =>
                  handleVoiceTextAutoFill(
                    lang === 'ur'
                      ? 'میرا نام فاطمہ بی بی ہے، شناختی کارڈ 4220176543212، عمر 47 سال، ماہانہ آمدن 12 ہزار روپے، ضلع کراچی ساؤتھ، تین بچے اسکول جاتے ہیں۔'
                      : 'My name is Fatima Bibi, CNIC 42201-7654321-2, age 47, monthly income 12000 rupees in Karachi South, widow supporting 3 children.'
                  )
                }
                className="rounded-lg border border-[#CED6CC] bg-white px-3 py-2 text-xs font-medium text-[#17372E] hover:border-[#17372E]"
              >
                {lang === 'ur' ? 'اردو بولنے کا نمونہ آزمائیں' : 'Try Spoken Sample'}
              </button>
            </div>
          </div>
        )}

        <form
          onSubmit={handleSubmitApplication}
          className="rounded-xl border border-[#CED6CC] bg-white p-6 sm:p-8 space-y-6"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="block text-sm font-semibold text-[#17372E] mb-1.5">
                {t(COPY.applyForm.fullName, lang)} *
              </label>
              <input
                type="text"
                required
                value={applicantName}
                onChange={(e) => setApplicantName(e.target.value)}
                placeholder="Fatima Bibi"
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-4 py-3 text-base focus:outline-none focus:border-[#17372E]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#17372E] mb-1.5">
                {t(COPY.applyForm.cnic, lang)}
              </label>
              <input
                type="text"
                value={cnic}
                onChange={(e) => setCnic(e.target.value)}
                placeholder="42201-7654321-2"
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-4 py-3 text-base font-mono-tabular focus:outline-none focus:border-[#17372E]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#17372E] mb-1.5">
                {t(COPY.applyForm.age, lang)}
              </label>
              <input
                type="number"
                min={0}
                max={120}
                value={age}
                onChange={(e) => setAge(e.target.value)}
                placeholder="47"
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-4 py-3 text-base tabular-nums focus:outline-none focus:border-[#17372E]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#17372E] mb-1.5">
                {t(COPY.applyForm.income, lang)}
              </label>
              <input
                type="number"
                min={0}
                value={monthlyIncome}
                onChange={(e) => setMonthlyIncome(e.target.value)}
                placeholder="12000"
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-4 py-3 text-base tabular-nums focus:outline-none focus:border-[#17372E]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#17372E] mb-1.5">
                {t(COPY.applyForm.district, lang)}
              </label>
              <input
                type="text"
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-4 py-3 text-base focus:outline-none focus:border-[#17372E]"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-[#17372E] mb-1.5">
                {t(COPY.applyForm.phone, lang)}
              </label>
              <input
                type="text"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-4 py-3 text-base font-mono-tabular focus:outline-none focus:border-[#17372E]"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-[#17372E] mb-1.5">
              {t(COPY.applyForm.household, lang)}
            </label>
            <textarea
              rows={2}
              value={householdDetails}
              onChange={(e) => setHouseholdDetails(e.target.value)}
              placeholder={
                lang === 'ur'
                  ? 'خاندان کے افراد یا صورتحال لکھیں...'
                  : 'Household dependents or special circumstances...'
              }
              className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-4 py-3 text-base focus:outline-none focus:border-[#17372E]"
            />
          </div>

          <div className="border-t border-[#CED6CC] pt-4">
            <label className="block text-sm font-semibold text-[#17372E] mb-2">
              {t(COPY.applyForm.uploadDoc, lang)}
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex items-center gap-2 cursor-pointer rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-4 py-2.5 text-sm font-medium text-[#17372E] hover:bg-[#DCE6DA]/50">
                <FileUp className="h-4 w-4" />
                <span>{selectedFile ? selectedFile.name : 'Choose JPEG, PNG, or PDF (max 5 MB)'}</span>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,application/pdf"
                  onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                  className="hidden"
                />
              </label>
              {selectedFile && (
                <button
                  type="button"
                  onClick={() => setSelectedFile(null)}
                  className="text-xs text-[#A94F40] hover:underline"
                >
                  Remove
                </button>
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3 pt-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-[#17372E] px-6 py-3.5 text-base font-semibold text-white hover:bg-[#1E473C] transition-colors disabled:opacity-50 min-h-[48px]"
            >
              {submitting
                ? lang === 'ur'
                  ? 'جائزہ ہو رہا ہے...'
                  : 'Processing...'
                : effectiveOffline
                  ? t(COPY.applyForm.queueOffline, lang)
                  : t(COPY.applyForm.submit, lang)}
            </button>

            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={submitting}
              className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-5 py-3.5 text-sm font-semibold text-[#17372E] hover:bg-[#DCE6DA]/50 min-h-[48px]"
            >
              {t(COPY.applyForm.saveDraft, lang)}
            </button>
          </div>

          <div className="border-t border-[#CED6CC] pt-4 space-y-2">
            <p className="text-xs font-medium text-[#5A655D]">
              {lang === 'ur' ? 'فوری ڈیمو مثالیں (فرضی ڈیٹا):' : 'Try a synthetic test scenario:'}
            </p>
            <div className="flex flex-wrap gap-2">
              {DEMO_EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  type="button"
                  onClick={() => {
                    setApplicantName(ex.applicantName);
                    setCnic(ex.cnic);
                    setAge(ex.age);
                    setMonthlyIncome(ex.monthlyIncome);
                    setDistrict(ex.district);
                    setHouseholdDetails(ex.householdDetails);
                  }}
                  className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-1.5 text-xs font-medium text-[#202923] hover:border-[#17372E]"
                >
                  {lang === 'ur' ? ex.labelUr : ex.labelEn}
                </button>
              ))}
            </div>
          </div>
        </form>

        {/* Decision Slip after submission */}
        {lastResult?.application && lastResult?.decision && (
          <div className="rounded-xl border border-[#17372E]/35 bg-[#FAF7F0] p-6 sm:p-8 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#CED6CC] pb-4">
              <div>
                <p className="font-mono-tabular text-xs text-[#5A655D]">
                  {lastResult.application.caseCode} · Rule v{lastResult.application.ruleVersion}
                </p>
                <h3 className="font-editorial text-2xl font-semibold text-[#17372E] mt-0.5">
                  {STATUS_LABELS[lastResult.application.status]?.[lang] || lastResult.application.status}
                </h3>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() =>
                    onSpeakText(
                      lang === 'ur' ? lastResult.decision.whyUr : lastResult.decision.whyEn
                    )
                  }
                  className="flex items-center gap-2 rounded-lg bg-[#B77B50] px-4 py-2.5 text-sm font-semibold text-white"
                >
                  <Volume2 className="h-4 w-4" />
                  <span>{lang === 'ur' ? 'سنیں' : 'Read Aloud'}</span>
                </button>
                <button
                  onClick={() => setQrSlipAppId(lastResult.application.id)}
                  className="flex items-center gap-2 rounded-lg border border-[#CED6CC] bg-white px-4 py-2.5 text-sm font-semibold text-[#17372E] hover:border-[#17372E]"
                >
                  <QrCode className="h-4 w-4" />
                  <span>{lang === 'ur' ? 'کیو آر سلپ' : 'QR Slip'}</span>
                </button>
                <button
                  onClick={() => setDecisionRoomAppId(lastResult.application.id)}
                  className="flex items-center gap-2 rounded-lg border border-[#17372E] px-4 py-2.5 text-sm font-semibold text-[#17372E]"
                >
                  <Eye className="h-4 w-4" />
                  <span>{lang === 'ur' ? 'مکمل تفصیل' : 'Decision Room'}</span>
                </button>
              </div>
            </div>

            <p className="text-base leading-relaxed text-[#202923]">
              {lang === 'ur' ? lastResult.decision.aiSummaryUr || lastResult.decision.whyUr : lastResult.decision.aiSummaryEn || lastResult.decision.whyEn}
            </p>

            <ConfidenceGauge
              confidence={lastResult.decision.confidence}
              askBelow={0.6}
              autoThreshold={0.909}
              lang={lang}
            />
          </div>
        )}

        {decisionRoomAppId && (
          <DecisionRoomModal
            applicationId={decisionRoomAppId}
            lang={lang}
            onClose={() => setDecisionRoomAppId(null)}
          />
        )}

        {qrSlipAppId && (
          <QrSlipModal
            applicationId={qrSlipAppId}
            lang={lang}
            onClose={() => setQrSlipAppId(null)}
          />
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TAB 2: MY CASES & OFFLINE SYNC QUEUE
  // ---------------------------------------------------------------------------
  if (activeTab === 'cases') {
    const submittedCount = cases.filter((c) => !c.isDraft).length;
    const approvedCount = cases.filter((c) => c.status.includes('approved')).length;

    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#CED6CC] pb-5">
          <div>
            <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
              {t(COPY.nav.cases, lang)}
            </h2>
            <p className="text-sm text-[#4A554E] mt-1">
              {submittedCount} {lang === 'ur' ? 'جمع شدہ درخواستیں' : 'submitted'} · {approvedCount}{' '}
              {lang === 'ur' ? 'منظور' : 'approved'} · {queuedItems.length}{' '}
              {lang === 'ur' ? 'آف لائن قطار میں' : 'queued on device'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setShowQrVerify(true)}
              className="flex items-center gap-2 rounded-lg border border-[#17372E] bg-white px-4 py-2.5 text-xs font-semibold text-[#17372E] hover:bg-[#DCE6DA]/50"
            >
              <ScanLine className="h-4 w-4 text-[#B77B50]" />
              <span>{lang === 'ur' ? 'کیو آر سلپ تصدیق' : 'Verify QR Slip'}</span>
            </button>
            {queuedItems.length > 0 && !effectiveOffline && (
              <button
                onClick={syncOfflineQueue}
                disabled={syncing}
                className="flex items-center gap-2 rounded-lg bg-[#17372E] px-4 py-2.5 text-sm font-semibold text-white"
              >
                <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
                <span>{lang === 'ur' ? 'ابھی سنک کریں' : 'Sync Queued Items'}</span>
              </button>
            )}
          </div>
        </div>

        {queuedItems.length > 0 && (
          <div className="rounded-xl border border-[#B77B50]/50 bg-[#FAF7F0] p-5 space-y-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-[#B77B50]">
              <WifiOff className="h-4 w-4" />
              <span>
                {lang === 'ur'
                  ? 'اس ڈیوائس پر محفوظ (ابھی سرور پر نہیں بھیجا گیا)'
                  : 'Pending Device Outbox (Local Only — Not Yet Server-Synchronized)'}
              </span>
            </div>
            <div className="space-y-2">
              {queuedItems.map((q) => (
                <div
                  key={q.idempotencyKey}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[#CED6CC] bg-white px-4 py-3 text-sm"
                >
                  <div>
                    <span className="font-semibold text-[#17372E]">{q.applicantName}</span>
                    <span className="text-xs text-[#5A655D] ms-2">
                      Queued {new Date(q.offlineCreatedAt).toLocaleString()}
                    </span>
                  </div>
                  <span className="text-xs font-mono-tabular text-[#B77B50]">
                    Idempotency: {q.idempotencyKey.slice(0, 14)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="rounded-xl border border-[#CED6CC] bg-white overflow-hidden">
          {casesLoading ? (
            <div className="p-8 text-sm text-[#5A655D]">Loading applications from PostgreSQL...</div>
          ) : cases.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <p className="text-sm text-[#5A655D]">
                {lang === 'ur' ? 'ابھی کوئی درخواست موجود نہیں۔' : 'No applications found yet.'}
              </p>
              <button
                onClick={() => onTabChange('apply')}
                className="rounded-lg bg-[#17372E] px-5 py-2.5 text-sm font-semibold text-white"
              >
                {t(COPY.nav.apply, lang)}
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-start text-sm">
                <thead className="border-b border-[#CED6CC] bg-[#FAF7F0] text-xs text-[#5A655D]">
                  <tr>
                    <th className="px-4 py-3 text-start font-semibold">Case ID</th>
                    <th className="px-4 py-3 text-start font-semibold">Applicant</th>
                    <th className="px-4 py-3 text-start font-semibold">Status & Route</th>
                    <th className="px-4 py-3 text-start font-semibold">Confidence</th>
                    <th className="px-4 py-3 text-start font-semibold">Policy</th>
                    <th className="px-4 py-3 text-end font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#CED6CC]">
                  {cases.map((c) => (
                    <tr key={c.id} className="hover:bg-[#FAF7F0]/70">
                      <td className="px-4 py-3.5 font-mono-tabular font-semibold text-[#17372E]">
                        {c.caseCode}
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="font-medium text-[#202923]">{c.applicantName}</div>
                        <div className="text-xs font-mono-tabular text-[#5A655D]">
                          {c.cnicMasked} · {c.district}
                        </div>
                      </td>
                      <td className="px-4 py-3.5">
                        <div className="flex items-center gap-1.5 font-semibold text-[#17372E]">
                          {c.status.includes('approved') ? (
                            <CheckCircle2 className="h-4 w-4 text-[#17372E]" />
                          ) : c.status === 'rejected' ? (
                            <AlertTriangle className="h-4 w-4 text-[#A94F40]" />
                          ) : (
                            <Clock className="h-4 w-4 text-[#B77B50]" />
                          )}
                          <span>{STATUS_LABELS[c.status]?.[lang] || c.status}</span>
                        </div>
                        <div className="text-xs text-[#5A655D]">
                          {ROUTE_LABELS[c.route]?.[lang] || c.route}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 font-mono-tabular">
                        {(c.confidence * 100).toFixed(0)}%
                      </td>
                      <td className="px-4 py-3.5 font-mono-tabular text-[#5A655D]">
                        v{c.ruleVersion}
                      </td>
                      <td className="px-4 py-3.5 text-end">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() =>
                              onSpeakText(
                                lang === 'ur'
                                  ? `کیس ${c.caseCode} برائے ${c.applicantName} کی حالت ${STATUS_LABELS[c.status]?.ur || c.status} ہے۔`
                                  : `Case ${c.caseCode} for ${c.applicantName} is currently ${STATUS_LABELS[c.status]?.en || c.status}.`
                              )
                            }
                            className="rounded border border-[#CED6CC] p-1.5 text-[#B77B50] hover:border-[#B77B50]"
                            title={lang === 'ur' ? 'حالت سنیں' : 'Read status aloud'}
                          >
                            <Volume2 className="h-3.5 w-3.5" />
                          </button>

                          {!c.isDraft && (
                            <button
                              type="button"
                              onClick={() => setQrSlipAppId(c.id)}
                              className="rounded border border-[#CED6CC] p-1.5 text-[#17372E] hover:border-[#17372E]"
                              title={lang === 'ur' ? 'کیو آر سلپ' : 'View signed QR slip'}
                            >
                              <QrCode className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {c.isDraft ? (
                            <button
                              onClick={() => handleSubmitDraftCase(c.id)}
                              className="rounded border border-[#17372E] px-3 py-1.5 text-xs font-semibold text-[#17372E]"
                            >
                              Submit Draft
                            </button>
                          ) : (
                            <button
                              onClick={() => setDecisionRoomAppId(c.id)}
                              className="rounded border border-[#CED6CC] px-3 py-1.5 text-xs font-medium text-[#17372E] hover:border-[#17372E]"
                            >
                              {lang === 'ur' ? 'تفصیل دیکھیں' : 'Decision Room'}
                            </button>
                          )}

                          {c.status === 'needs_proof' && (
                            <label className="cursor-pointer rounded bg-[#B77B50] px-3 py-1.5 text-xs font-semibold text-white">
                              <span>{lang === 'ur' ? 'ثبوت بھیجیں' : 'Upload Proof'}</span>
                              <input
                                type="file"
                                accept="image/jpeg,image/png,image/webp,application/pdf"
                                className="hidden"
                                onChange={(e) => {
                                  const f = e.target.files?.[0];
                                  if (f) handleUploadProofToCase(c.id, f);
                                }}
                              />
                            </label>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {syncHistory.length > 0 && (
          <div className="rounded-xl border border-[#CED6CC] bg-[#FAF7F0] p-5 space-y-2">
            <h3 className="text-sm font-semibold text-[#17372E]">Confirmed Offline Sync History</h3>
            <ul className="space-y-1 text-xs text-[#4A554E] font-mono-tabular">
              {syncHistory.slice(0, 6).map((s) => (
                <li key={s.id}>
                  {new Date(s.syncedAt).toLocaleTimeString()} · {s.caseCode} ({s.applicantName}) —{' '}
                  {s.outcome === 'duplicate_skipped' ? 'Duplicate prevented' : 'Synced to PostgreSQL'}
                </li>
              ))}
            </ul>
          </div>
        )}

        {decisionRoomAppId && (
          <DecisionRoomModal
            applicationId={decisionRoomAppId}
            lang={lang}
            onClose={() => setDecisionRoomAppId(null)}
          />
        )}

        {qrSlipAppId && (
          <QrSlipModal
            applicationId={qrSlipAppId}
            lang={lang}
            onClose={() => setQrSlipAppId(null)}
          />
        )}

        {showQrVerify && (
          <QrVerifyModal lang={lang} onClose={() => setShowQrVerify(false)} />
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TAB 3: SCAM MESSAGE CHECKER + LIVE REGIONAL PATTERNS
  // ---------------------------------------------------------------------------
  if (activeTab === 'scam') {
    return (
      <div className="max-w-5xl mx-auto space-y-8">
        <div className="border-b border-[#CED6CC] pb-5">
          <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
            {t(COPY.scam.heading, lang)}
          </h2>
          <p className="text-sm text-[#4A554E] mt-1 max-w-3xl">
            {t(COPY.scam.sub, lang)}
          </p>
        </div>

        {scamError && (
          <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-4 text-sm text-[#A94F40]">
            {scamError}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          <div className="lg:col-span-7 rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
            <div>
              <label className="block text-sm font-semibold text-[#17372E] mb-1.5">
                {lang === 'ur' ? 'پیغام یہاں پیسٹ کریں' : 'Message text'}
              </label>
              <textarea
                rows={4}
                value={scamText}
                onChange={(e) => setScamText(e.target.value)}
                placeholder="Paste SMS, WhatsApp forward, or suspicious link..."
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] p-3.5 text-sm focus:outline-none focus:border-[#17372E]"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#5A655D] mb-1">
                  {lang === 'ur' ? 'علاقہ (اسکیم میپ کے لیے)' : 'City / District (for Scam Map)'}
                </label>
                <select
                  value={scamRegion}
                  onChange={(e) => setScamRegion(e.target.value)}
                  className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
                >
                  <option value="Karachi">Karachi</option>
                  <option value="Lahore">Lahore</option>
                  <option value="Multan">Multan</option>
                  <option value="Hyderabad">Hyderabad</option>
                  <option value="Peshawar">Peshawar</option>
                  <option value="Quetta">Quetta</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#5A655D] mb-1">
                  {lang === 'ur' ? 'اسکرین شاٹ اپ لوڈ (اختیاری)' : 'Screenshot Upload (Optional)'}
                </label>
                <label className="flex items-center gap-2 cursor-pointer rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-xs font-medium text-[#17372E]">
                  <Upload className="h-4 w-4" />
                  <span>{scamImageBase64 ? 'Screenshot attached' : 'Attach screenshot'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    onChange={(e) => handleScamImagePick(e.target.files?.[0])}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 pt-2">
              <button
                onClick={handleRunScamCheck}
                disabled={scamLoading}
                className="rounded-lg bg-[#17372E] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1E473C] disabled:opacity-50"
              >
                {scamLoading
                  ? lang === 'ur'
                    ? 'اے آئی جانچ رہا ہے...'
                    : 'Analyzing with AI...'
                  : t(COPY.scam.analyze, lang)}
              </button>
              <button
                type="button"
                onClick={() =>
                  setScamText(
                    'URGENT: Your Rs 25,000 relief payment is waiting! Click http://bit.ly/claim-now and reply with your CNIC and OTP today.'
                  )
                }
                className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3.5 py-2.5 text-xs font-medium"
              >
                {t(COPY.scam.sampleScam, lang)}
              </button>
              <button
                type="button"
                onClick={() =>
                  setScamText(
                    'Dear citizen, your application C-097 was received. Track your status on the official 8171 portal.'
                  )
                }
                className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3.5 py-2.5 text-xs font-medium"
              >
                {t(COPY.scam.sampleOfficial, lang)}
              </button>
            </div>

            {scamResult && (
              <div className="mt-4 rounded-xl border border-[#CED6CC] bg-[#FAF7F0] p-5 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <AlertTriangle
                      className={`h-5 w-5 ${
                        scamResult.risk_level === 'high'
                          ? 'text-[#A94F40]'
                          : scamResult.risk_level === 'medium' || scamResult.risk_level === 'uncertain'
                            ? 'text-[#B77B50]'
                            : 'text-[#17372E]'
                      }`}
                    />
                    <span className="text-base font-bold uppercase tracking-wide text-[#17372E]">
                      Risk: {scamResult.risk_level}
                    </span>
                  </div>
                  <button
                    onClick={() =>
                      onSpeakText(
                        lang === 'ur' ? scamResult.explanation_ur : scamResult.explanation_en
                      )
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-[#B77B50] px-3 py-1.5 text-xs font-semibold text-white"
                  >
                    <Volume2 className="h-3.5 w-3.5" />
                    <span>{lang === 'ur' ? 'سنیں' : 'Listen'}</span>
                  </button>
                </div>

                <p className="text-sm text-[#202923] leading-relaxed">
                  {lang === 'ur' ? scamResult.explanation_ur : scamResult.explanation_en}
                </p>

                {scamResult.indicators?.length > 0 && (
                  <div className="text-xs text-[#4A554E]">
                    <strong>Indicators:</strong> {scamResult.indicators.join(' · ')}
                  </div>
                )}

                {scamResult.recommended_actions?.length > 0 && (
                  <ul className="list-disc ps-5 text-xs text-[#202923] space-y-1">
                    {scamResult.recommended_actions.map((act: string, i: number) => (
                      <li key={i}>{act}</li>
                    ))}
                  </ul>
                )}

                <p className="text-[11px] text-[#5A655D] font-mono-tabular pt-1">
                  Model: {scamResult.model} · Confidence: {(scamResult.confidence * 100).toFixed(0)}% ·{' '}
                  {scamResult.human_review_required
                    ? 'Flagged for human verification'
                    : 'Automated pattern + AI check (never click unknown links)'}
                </p>
              </div>
            )}
          </div>

          {/* Regional Scam Pattern Map */}
          <div className="lg:col-span-5 space-y-4">
            <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
              <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
                {lang === 'ur' ? 'علاقائی دھوکہ دہی کا نقشہ' : 'Regional Scam Activity (DB-Derived)'}
              </h3>
              <p className="text-xs text-[#5A655D]">
                Aggregated from verified message checks stored in PostgreSQL.
              </p>
              <div className="space-y-3">
                {scamMap.map((row) => (
                  <div key={row.region} className="space-y-1 text-xs">
                    <div className="flex justify-between font-medium">
                      <span>{row.region}</span>
                      <span className="font-mono-tabular text-[#5A655D]">
                        {row.high} high · {row.medium + row.uncertain} review · {row.low} low
                      </span>
                    </div>
                    <div className="h-2 w-full rounded bg-[#FAF7F0] border border-[#CED6CC] flex overflow-hidden">
                      <div style={{ width: `${row.high * 25}%` }} className="bg-[#A94F40]" />
                      <div
                        style={{ width: `${(row.medium + row.uncertain) * 25}%` }}
                        className="bg-[#B77B50]"
                      />
                      <div style={{ width: `${row.low * 25}%` }} className="bg-[#17372E]/50" />
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-[#CED6CC] bg-[#FAF7F0] p-5 space-y-2">
              <h4 className="text-sm font-semibold text-[#17372E]">Recent Checks</h4>
              <div className="space-y-2 max-h-60 overflow-y-auto">
                {scamHistory.slice(0, 6).map((h) => (
                  <div key={h.id} className="border-b border-[#CED6CC]/70 pb-2 text-xs">
                    <div className="flex justify-between font-mono-tabular text-[#5A655D]">
                      <span className="uppercase font-semibold text-[#17372E]">{h.riskLevel}</span>
                      <span>{h.region}</span>
                    </div>
                    <p className="truncate text-[#202923] mt-0.5">{h.messagePreview}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TAB 3.5: POLICY HANDBOOK & SEMANTIC RAG
  // ---------------------------------------------------------------------------
  if (activeTab === 'policy') {
    return <PolicyRagExplorer lang={lang} onSpeakText={onSpeakText} />;
  }

  // ---------------------------------------------------------------------------
  // TAB 4: MY DATA & CONSENT CENTER
  // ---------------------------------------------------------------------------
  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="border-b border-[#CED6CC] pb-5">
        <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
          {t(COPY.consent.heading, lang)}
        </h2>
        <p className="text-sm text-[#4A554E] mt-1">{t(COPY.consent.sub, lang)}</p>
      </div>

      <div className="rounded-lg border border-[#CED6CC] bg-[#DCE6DA]/40 p-4 flex items-start gap-3 text-xs text-[#17372E]">
        <Info className="h-4 w-4 shrink-0 mt-0.5" />
        <p>{t(COPY.consent.retention, lang)}</p>
      </div>

      <div className="rounded-xl border border-[#CED6CC] bg-white overflow-hidden">
        {consentLoading ? (
          <div className="p-6 text-sm text-[#5A655D]">Loading privacy permissions...</div>
        ) : (
          <table className="w-full text-start text-sm">
            <thead className="border-b border-[#CED6CC] bg-[#FAF7F0] text-xs text-[#5A655D]">
              <tr>
                <th className="px-5 py-3 text-start font-semibold">Recipient / Scope</th>
                <th className="px-5 py-3 text-start font-semibold">Status</th>
                <th className="px-5 py-3 text-start font-semibold">Last Updated</th>
                <th className="px-5 py-3 text-end font-semibold">Control</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#CED6CC]">
              {consents.map((c) => (
                <tr key={c.id}>
                  <td className="px-5 py-4">
                    <div className="font-semibold text-[#17372E]">{c.granteeLabel}</div>
                    <div className="text-xs font-mono-tabular text-[#5A655D]">{c.scope}</div>
                  </td>
                  <td className="px-5 py-4">
                    <span
                      className={`inline-flex items-center gap-1.5 font-semibold ${
                        c.granted ? 'text-[#17372E]' : 'text-[#A94F40]'
                      }`}
                    >
                      <ShieldCheck className="h-4 w-4" />
                      {c.granted
                        ? lang === 'ur'
                          ? 'شیئر ہو رہا ہے'
                          : 'Sharing Active'
                        : lang === 'ur'
                          ? 'بند کر دیا گیا'
                          : 'Stopped'}
                    </span>
                  </td>
                  <td className="px-5 py-4 text-xs font-mono-tabular text-[#5A655D]">
                    {new Date(c.updatedAt).toLocaleString()}
                  </td>
                  <td className="px-5 py-4 text-end">
                    <button
                      onClick={() => handleToggleConsent(c.scope, !c.granted)}
                      className={`rounded-lg px-4 py-2 text-xs font-semibold transition-colors ${
                        c.granted
                          ? 'border border-[#A94F40] text-[#A94F40] hover:bg-[#A94F40]/10'
                          : 'bg-[#17372E] text-white hover:bg-[#1E473C]'
                      }`}
                    >
                      {c.granted
                        ? lang === 'ur'
                          ? 'شیئرنگ بند کریں'
                          : 'Withdraw Consent'
                        : lang === 'ur'
                          ? 'اجازت دیں'
                          : 'Grant Consent'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {consentHistory.length > 0 && (
        <div className="rounded-xl border border-[#CED6CC] bg-[#FAF7F0] p-5 space-y-2">
          <h3 className="text-sm font-semibold text-[#17372E]">Consent Change Log</h3>
          <ul className="space-y-1.5 text-xs text-[#4A554E]">
            {consentHistory.slice(0, 10).map((h) => (
              <li key={h.id} className="font-mono-tabular">
                {new Date(h.createdAt).toLocaleString()} · {h.scope} ·{' '}
                <strong className={h.action === 'withdrawn' ? 'text-[#A94F40]' : 'text-[#17372E]'}>
                  {h.action}
                </strong>{' '}
                — {h.note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
