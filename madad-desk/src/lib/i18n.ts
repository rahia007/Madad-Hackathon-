export type Lang = 'en' | 'ur';

export const STATUS_LABELS: Record<string, { en: string; ur: string }> = {
  draft: { en: 'Draft', ur: 'مسودہ' },
  approved: { en: 'Approved', ur: 'منظور' },
  approved_by_officer: { en: 'Approved by officer', ur: 'افسر نے منظور کیا' },
  rejected: { en: 'Rejected', ur: 'مسترد' },
  in_review: { en: 'Officer review', ur: 'افسر کے جائزے میں' },
  needs_proof: { en: 'Proof requested', ur: 'ثبوت درکار ہے' },
  escalated: { en: 'Escalated', ur: 'اعلیٰ جائزہ' },
};

export const ROUTE_LABELS: Record<string, { en: string; ur: string }> = {
  auto: { en: 'Auto-approved', ur: 'خودکار منظوری' },
  docs: { en: 'Needs proof', ur: 'مزید دستاویز درکار' },
  human: { en: 'Human review', ur: 'انسانی جائزہ' },
};

export const COPY = {
  brand: { en: 'Madad Desk', ur: 'مدد ڈیسک' },
  tagline: {
    en: 'Technology that understands people',
    ur: 'ٹیکنالوجی جو انسانوں کو سمجھتی ہے',
  },
  prototypeNotice: {
    en: 'Prototype demonstration using synthetic Pakistani records and clearly labeled mock adapters. Not an official government portal.',
    ur: 'یہ ایک ڈیمو پروٹوٹائپ ہے جس میں فرضی پاکستانی ریکارڈ اور واضح طور پر لیبل شدہ ماک سروسز استعمال کی گئی ہیں۔ یہ سرکاری پورٹل نہیں ہے۔',
  },
  nav: {
    apply: { en: 'Apply', ur: 'درخواست دیں' },
    cases: { en: 'My Cases', ur: 'میرے کیس' },
    scam: { en: 'Scam Check', ur: 'پیغام جانچیں' },
    data: { en: 'My Data', ur: 'میرا ڈیٹا' },
    families: { en: 'Families', ur: 'میرے خاندان' },
    queue: { en: 'Review Queue', ur: 'جائزہ قطار' },
    analytics: { en: 'Analytics', ur: 'تجزیات' },
    evaluation: { en: 'AI Eval', ur: 'اے آئی جانچ' },
    rules: { en: 'Rules & Twin', ur: 'اصول اور آزمائش' },
    policy: { en: 'Policy RAG', ur: 'پالیسی رہنما' },
    services: { en: 'API & Mocks', ur: 'سروسز اور API' },
    audit: { en: 'Audit Ledger', ur: 'آڈٹ ریکارڈ' },
  },
  applyForm: {
    heading: { en: 'Apply for Relief Assistance', ur: 'امدادی گرانٹ کے لیے درخواست' },
    sub: {
      en: 'Enter your details below or tap the speaker to hear step-by-step guidance.',
      ur: 'نیچے اپنی معلومات درج کریں یا مرحلہ وار رہنمائی سننے کے لیے اسپیکر بٹن دبائیں۔',
    },
    fullName: { en: 'Full name', ur: 'پورا نام' },
    cnic: { en: 'CNIC number', ur: 'شناختی کارڈ نمبر' },
    age: { en: 'Age', ur: 'عمر' },
    income: { en: 'Monthly household income (Rs)', ur: 'ماہانہ گھریلو آمدن (روپے)' },
    district: { en: 'District', ur: 'ضلع' },
    phone: { en: 'Contact number', ur: 'رابطہ نمبر' },
    household: { en: 'Household details', ur: 'گھرانے کی تفصیلات' },
    submit: { en: 'Submit Application', ur: 'درخواست بھیجیں' },
    saveDraft: { en: 'Save Draft', ur: 'مسودہ محفوظ کریں' },
    queueOffline: { en: 'Save Offline to Sync Later', ur: 'آف لائن محفوظ کریں' },
    uploadDoc: { en: 'Upload Supporting Document (CNIC / Income Slip)', ur: 'ثبوت کی دستاویز اپ لوڈ کریں (شناختی کارڈ / آمدن)' },
  },
  scam: {
    heading: { en: 'Check a Suspicious Message', ur: 'مشکوک پیغام جانچیں' },
    sub: {
      en: 'Paste an SMS or WhatsApp message, or upload a screenshot. We combine rule checks with AI analysis and flag uncertain cases for human review.',
      ur: 'ایس ایم ایس یا واٹس ایپ پیغام پیسٹ کریں یا اسکرین شاٹ اپ لوڈ کریں۔ ہم اصولوں اور اے آئی کی مدد سے دھوکے کی جانچ کرتے ہیں۔',
    },
    analyze: { en: 'Analyze Message', ur: 'پیغام چیک کریں' },
    sampleScam: { en: 'Try Scam Sample', ur: 'دھوکے کا نمونہ' },
    sampleOfficial: { en: 'Try Official Notice', ur: 'سرکاری پیغام نمونہ' },
  },
  consent: {
    heading: { en: 'My Data & Consent Center', ur: 'میرا ڈیٹا اور رضامندی مرکز' },
    sub: {
      en: 'You control who sees your records. Withdrawing consent stops all future access immediately on the server.',
      ur: 'آپ طے کرتے ہیں کہ آپ کا ریکارڈ کون دیکھے۔ اجازت واپس لینے پر سرور فوراً رسائی بند کر دیتا ہے۔',
    },
    retention: {
      en: 'Legal retention notice: Withdrawing stops future sharing immediately, while finalized audit trails remain archived for accountability.',
      ur: 'قانونی نوٹس: اجازت بند کرنے سے آئندہ رسائی فوراً رک جاتی ہے، تاہم مکمل شدہ آڈٹ ریکارڈ شفافیت کے لیے محفوظ رہتا ہے۔',
    },
  },
};

export function t(obj: { en: string; ur: string }, lang: Lang): string {
  return lang === 'ur' ? obj.ur : obj.en;
}
