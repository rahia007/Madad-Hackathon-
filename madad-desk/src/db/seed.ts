import { count, eq } from 'drizzle-orm';
import { db } from './index.ts';
import {
  aiTelemetry,
  applications,
  applicationDecisions,
  applicationStatusHistory,
  auditLogs,
  citizens,
  consentHistory,
  consents,
  eligibilityRules,
  helperAssignments,
  mockRegistryRecords,
  mockServiceLogs,
  notificationPreferences,
  notifications,
  policyDocuments,
  scamChecks,
  userRoles,
  users,
  webhooks,
} from './schema.ts';
import { encryptSensitive, hashCnic, hashPassword, maskCnic } from '../lib/crypto.ts';
import { computeAutoThreshold, evaluateEligibility } from '../lib/eligibility.ts';

let seedPromise: Promise<void> | null = null;

export async function ensureDatabaseSeeded(): Promise<void> {
  if (seedPromise) return seedPromise;
  seedPromise = runSeed().catch((err) => {
    seedPromise = null;
    console.error('Seed check error:', err);
  });
  return seedPromise;
}

export async function resetDemoData(): Promise<void> {
  // Wipe operational demo tables in safe foreign-key order and re-seed cleanly
  await db.delete(applicationStatusHistory);
  await db.delete(applicationDecisions);
  await db.delete(applications);
  await db.delete(consentHistory);
  await db.delete(consents);
  await db.delete(helperAssignments);
  await db.delete(scamChecks);
  await db.delete(notifications);
  await db.delete(auditLogs);
  await db.delete(mockServiceLogs);
  await db.delete(eligibilityRules);
  await db.delete(citizens);
  await db.delete(mockRegistryRecords);
  seedPromise = null;
  await runSeed(true);
}

async function runSeed(forceOperational = false): Promise<void> {
  const existingUsers = await db.select({ value: count() }).from(users);
  const existingRules = await db.select({ value: count() }).from(eligibilityRules);
  const existingPolicies = await db.select({ value: count() }).from(policyDocuments);

  if (
    !forceOperational &&
    (existingUsers[0]?.value ?? 0) > 0 &&
    (existingRules[0]?.value ?? 0) > 0 &&
    (existingPolicies[0]?.value ?? 0) > 0
  ) {
    return;
  }

  // Always ensure Policy RAG handbook is seeded even on already-initialized DBs
  if ((existingPolicies[0]?.value ?? 0) === 0 || forceOperational) {
    await db.delete(policyDocuments);
    const seedPolicies = [
      {
        code: 'POL-8171-01',
        titleEn: 'Income Eligibility & Asymmetric Cost Policy',
        titleUr: 'آمدن کی حد اور غیر متوازن لاگت کا اصول',
        category: 'eligibility',
        contentEn:
          'Households with verified monthly income at or below the active income ceiling (baseline Rs 25,000) and primary applicant age >= 18 qualify for relief. Because approving an ineligible claim costs 10x more than delaying a valid claim, automated approval requires confidence >= costWrong / (costWrong + costSlow) (~90.9%). Uncertain cases always route to proof upload or human review—never automatic rejection.',
        contentUr:
          'مقررہ ماہانہ آمدن کی حد (بنیادی 25,000 روپے) یا اس سے کم اور کم از کم عمر 18 سال والے گھرانے امداد کے اہل ہیں۔ غلط منظوری کا نقصان تاخیر سے 10 گنا زیادہ ہونے کے باعث کم یقین والے کیس کبھی خودکار مسترد نہیں ہوتے بلکہ ثبوت یا افسر کے پاس جاتے ہیں۔',
      },
      {
        code: 'POL-8171-02',
        titleEn: 'Widow, Senior & Urgent Medical Priority',
        titleUr: 'بیوہ، بزرگ شہری اور فوری طبی ترجیح',
        category: 'priority',
        contentEn:
          'Cases mentioning widowhood, senior citizens aged 60+, disability, or flood displacement receive elevated urgency scoring (85-95/100) in the Officer Review Queue so human officers prioritize vulnerable households first.',
        contentUr:
          'بیوہ خواتین، 60 سال سے زائد بزرگ شہریوں، معذوری یا سیلاب سے متاثرہ خاندانوں کے کیس افسر کی قطار میں ترجیحی اسکور کے ساتھ اوپر دکھائے جاتے ہیں۔',
      },
      {
        code: 'POL-8171-03',
        titleEn: 'Missing CNIC & Pakistani Name Transliteration Rules',
        titleUr: 'شناختی کارڈ کی عدم دستیابی اور ناموں کے ہجے',
        category: 'identity',
        contentEn:
          'Common Urdu-to-English transliteration variants (Muhammad / Mohammad / Muhammed / Mohd, Khatoon / Khatun, Bibi / Bano) are normalized before similarity matching. When CNIC is misplaced or ambiguous matches exist (e.g. two citizens named Aslam), confidence drops below 0.60 and the system must request documents or officer verification instead of guessing.',
        contentUr:
          'اردو سے انگریزی ناموں کے مختلف ہجے (محمد، خاتون وغیرہ) یکساں کر کے ملائے جاتے ہیں۔ اگر شناختی کارڈ گم ہو یا ایک نام کے دو افراد ہوں تو نظام اندازہ لگانے کے بجائے افسر یا ثبوت طلب کرتا ہے۔',
      },
      {
        code: 'POL-8171-04',
        titleEn: 'Zero-Fee Anti-Scam Mandate & 8171 Verification',
        titleUr: 'بغیر فیس امداد اور 8171 تصدیقی اصول',
        category: 'anti_fraud',
        contentEn:
          'Official public relief programs charge zero registration, Easypaisa, or JazzCash fees and never ask citizens for bank PINs or OTP codes via SMS or WhatsApp. Any message requesting an advance fee, OTP, or shortened external URL must be flagged High Risk.',
        contentUr:
          'سرکاری امدادی پروگرام کوئی پیشگی فیس، ایزی پیسہ، جاز کیش رقم یا بینک پن/او ٹی پی نہیں مانگتے۔ کسی بھی فیس یا مشکوک لنک والا پیغام فوری طور پر خطرناک قرار دیا جاتا ہے۔',
      },
      {
        code: 'POL-8171-05',
        titleEn: 'Citizen Data Consent & Immediate Withdrawal',
        titleUr: 'شہری کی رضامندی اور ڈیٹا تک رسائی واپس لینا',
        category: 'privacy',
        contentEn:
          'Citizens control four separate consent scopes: helper_access, department_review, document_access, and payment_disbursement. Withdrawing consent stops all future API access immediately with HTTP 403 and records a security audit entry while preserving immutable audit history.',
        contentUr:
          'شہری مددگار، محکمہ، دستاویز اور ادائیگی کی اجازت الگ الگ کنٹرول کر سکتے ہیں۔ اجازت واپس لینے پر سرور فوراً رسائی روک دیتا ہے اور آڈٹ ریکارڈ میں درج کرتا ہے۔',
      },
      {
        code: 'POL-8171-06',
        titleEn: 'Officer Justification & Slip QR Verification',
        titleUr: 'افسر کی تحریری وجہ اور کیو آر سلپ تصدیق',
        category: 'governance',
        contentEn:
          'Every officer decision (approve, request evidence, escalate, reject) requires a written justification stored in application_decisions. Issued Case Slips carry an HMAC-SHA256 signed QR payload verifiable offline/online to stop counterfeit relief receipts.',
        contentUr:
          'افسر کے ہر فیصلے کے لیے تحریری وجہ لازمی ہے۔ جاری کردہ کیس سلپ پر محفوظ کیو آر کوڈ موجود ہوتا ہے جس سے جعلی رسیدوں کی روک تھام ہوتی ہے۔',
      },
    ];
    await db.insert(policyDocuments).values(seedPolicies).onConflictDoNothing();
  }

  const existingTele = await db.select({ value: count() }).from(aiTelemetry);
  if ((existingTele[0]?.value ?? 0) === 0 || forceOperational) {
    await db.insert(aiTelemetry).values([
      { endpoint: '/api/ai/scam-check', model: 'gemini-4-hydrogen', latencyMs: 1180, success: true, usedFallback: false, inputTokensEst: 420, costUsdEst: 0.0002 },
      { endpoint: '/api/ai/assistant', model: 'gemini-4-hydrogen', latencyMs: 1640, success: true, usedFallback: false, inputTokensEst: 510, costUsdEst: 0.0003 },
      { endpoint: '/api/ai/voice/tts', model: 'gemini-3.8-flash-lite-tts', latencyMs: 2150, success: true, usedFallback: false, inputTokensEst: 180, costUsdEst: 0.0004 },
    ]);
  }

  const existingHooks = await db.select({ value: count() }).from(webhooks);
  if ((existingHooks[0]?.value ?? 0) === 0 || forceOperational) {
    await db.insert(webhooks).values({
      name: 'Provincial Relief Audit Sandbox Receiver',
      targetUrl: 'sandbox://madad-audit-inspector',
      eventsJson: JSON.stringify(['APPLICATION_SUBMITTED', 'APPLICATION_APPROVED', 'CASE_ESCALATED', 'HIGH_RISK_SCAM_DETECTED']),
      secretMasked: 'whsec_demo_****8171',
      secretEncrypted: encryptSensitive('whsec_demo_madad_sandbox_8171'),
      isActive: true,
    });
  }

  if (!forceOperational && (existingUsers[0]?.value ?? 0) > 0 && (existingRules[0]?.value ?? 0) > 0) {
    return;
  }

  // 1. Ensure 5 synthetic demo accounts + primary owner email
  const demoPasswordHash = hashPassword('MadadDemo2026!');
  const seedUsers = [
    {
      uid: 'demo-citizen-fatima',
      email: 'citizen.demo@madaddesk.pk',
      displayName: 'Fatima Bibi (Demo Citizen)',
      role: 'citizen',
      lang: 'ur',
      isDemoAccount: true,
    },
    {
      uid: 'demo-helper-nasreen',
      email: 'helper.demo@madaddesk.pk',
      displayName: 'Nasreen Akhtar (Demo Helper)',
      role: 'helper',
      lang: 'ur',
      isDemoAccount: true,
    },
    {
      uid: 'demo-officer-tariq',
      email: 'officer.demo@madaddesk.pk',
      displayName: 'Tariq Mahmood (Demo Officer)',
      role: 'officer',
      lang: 'en',
      isDemoAccount: true,
    },
    {
      uid: 'demo-admin-ayesha',
      email: 'admin.demo@madaddesk.pk',
      displayName: 'Ayesha Siddiqui (Demo Admin)',
      role: 'admin',
      lang: 'en',
      isDemoAccount: true,
    },
    {
      uid: 'demo-auditor-kamran',
      email: 'auditor.demo@madaddesk.pk',
      displayName: 'Kamran Qureshi (Demo Auditor)',
      role: 'auditor',
      lang: 'en',
      isDemoAccount: true,
    },
  ];

  const userMap = new Map<string, number>();

  for (const u of seedUsers) {
    const existing = await db.select().from(users).where(eq(users.email, u.email));
    let userId: number;
    if (existing[0]) {
      userId = existing[0].id;
    } else {
      const inserted = await db
        .insert(users)
        .values({
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          passwordHash: demoPasswordHash,
          preferredLang: u.lang,
          isDemoAccount: u.isDemoAccount,
        })
        .returning();
      userId = inserted[0].id;
      await db.insert(userRoles).values({
        userId,
        role: u.role,
        tenantId: 'relief-dept-pk',
      });
      await db
        .insert(notificationPreferences)
        .values({ userId, inApp: true, smsMock: true, emailMock: false })
        .onConflictDoNothing();
    }
    userMap.set(u.role, userId);
  }

  const citizenUserId = userMap.get('citizen')!;
  const helperUserId = userMap.get('helper')!;
  const officerUserId = userMap.get('officer')!;
  const adminUserId = userMap.get('admin')!;

  // 2. Seed Mock Identity Registry (clearly synthetic Pakistani records)
  const syntheticRegistry = [
    {
      fullName: 'Fatima Bibi',
      cnic: '42201-7654321-2',
      age: 47,
      monthlyIncome: 12000,
      district: 'Karachi South',
    },
    {
      fullName: 'Zainab Khatoon',
      cnic: '42301-5550001-2',
      age: 66,
      monthlyIncome: 9000,
      district: 'Hyderabad',
    },
    {
      fullName: 'Muhammad Aslam',
      cnic: '42101-1234567-1',
      age: 54,
      monthlyIncome: 18000,
      district: 'Karachi Central',
    },
    {
      fullName: 'Mohammad Aslam',
      cnic: '42101-1234999-1',
      age: 61,
      monthlyIncome: 30000,
      district: 'Lahore',
    },
    {
      fullName: 'Rukhsana Parveen',
      cnic: '36302-4441122-4',
      age: 39,
      monthlyIncome: 14500,
      district: 'Multan',
    },
    {
      fullName: 'Bilal Ahmed',
      cnic: '35202-8877665-3',
      age: 42,
      monthlyIncome: 29000,
      district: 'Lahore',
    },
  ];

  const registryRows: Array<{
    fullName: string;
    cnicMasked: string;
    cnicHash: string;
    age: number;
    monthlyIncome: number;
    district: string;
  }> = [];

  for (const r of syntheticRegistry) {
    const cnicHash = hashCnic(r.cnic);
    const cnicMasked = maskCnic(r.cnic);
    await db
      .insert(mockRegistryRecords)
      .values({
        fullName: r.fullName,
        cnicMasked,
        cnicHash,
        age: r.age,
        monthlyIncome: r.monthlyIncome,
        district: r.district,
        status: 'active',
      })
      .onConflictDoNothing();
    registryRows.push({
      fullName: r.fullName,
      cnicMasked,
      cnicHash,
      age: r.age,
      monthlyIncome: r.monthlyIncome,
      district: r.district,
    });
  }

  // 3. Seed Citizens, Helper Assignments, and Consents
  const citizenIdMap = new Map<string, number>();
  for (const r of syntheticRegistry) {
    const cnicHash = hashCnic(r.cnic);
    const cnicMasked = maskCnic(r.cnic);
    const existing = await db.select().from(citizens).where(eq(citizens.cnicHash, cnicHash));
    let cid: number;
    if (existing[0]) {
      cid = existing[0].id;
    } else {
      const inserted = await db
        .insert(citizens)
        .values({
          userId: r.fullName === 'Fatima Bibi' ? citizenUserId : null,
          fullName: r.fullName,
          cnicMasked,
          cnicHash,
          cnicEncrypted: encryptSensitive(r.cnic),
          age: r.age,
          monthlyIncome: r.monthlyIncome,
          householdSize: r.fullName === 'Fatima Bibi' ? 5 : 4,
          district: r.district,
          phoneMasked: '0300-***-8171',
          isSyntheticDemo: true,
        })
        .returning();
      cid = inserted[0].id;
    }
    citizenIdMap.set(r.fullName, cid);
  }

  // Helper assignments: Nasreen assists Fatima, Zainab, Rukhsana, Muhammad Aslam
  const helperTargets = [
    { name: 'Fatima Bibi', helperConsent: true },
    { name: 'Zainab Khatoon', helperConsent: true },
    { name: 'Rukhsana Parveen', helperConsent: false },
    { name: 'Muhammad Aslam', helperConsent: true },
  ];

  for (const target of helperTargets) {
    const cid = citizenIdMap.get(target.name)!;
    await db.insert(helperAssignments).values({
      helperUserId,
      citizenId: cid,
      relationship: 'Neighborhood Relief Facilitator',
    });

    const scopes = [
      { scope: 'helper_access', label: 'Nasreen Akhtar (Community Helper)', granted: target.helperConsent },
      { scope: 'department_review', label: 'Public Relief Department', granted: true },
      { scope: 'document_access', label: 'Officer Verification & OCR', granted: true },
      { scope: 'payment_disbursement', label: 'Mock Payment Adapter (Raast-style)', granted: false },
    ];
    for (const sc of scopes) {
      const [insertedConsent] = await db
        .insert(consents)
        .values({
          citizenId: cid,
          scope: sc.scope,
          granteeLabel: sc.label,
          granted: sc.granted,
        })
        .returning();
      await db.insert(consentHistory).values({
        consentId: insertedConsent.id,
        citizenId: cid,
        actorUserId: citizenUserId,
        scope: sc.scope,
        action: sc.granted ? 'granted' : 'withdrawn',
        note: 'Initial seeded synthetic consent state',
      });
    }
  }

  // 4. Seed Rule v1
  const ruleV1 = {
    version: 1,
    name: 'Baseline Household Relief Policy',
    maxIncome: 25000,
    minAge: 18,
    costWrong: 10,
    costSlow: 1,
    askBelow: 0.6,
    autoThreshold: computeAutoThreshold({ costWrong: 10, costSlow: 1 }),
    isActive: true,
    createdByUserId: adminUserId,
    changeSummary: 'Initial policy: wrong approvals weighted 10x cost of delay.',
  };
  await db.insert(eligibilityRules).values(ruleV1).onConflictDoNothing();

  // 5. Seed 5 Representative Applications
  const seedCases = [
    {
      caseCode: 'C-097',
      citizenName: 'Zainab Khatoon',
      applicantName: 'Zainab Khatun',
      cnic: '42301-5550001-2',
      age: 66,
      monthlyIncome: 9000,
      district: 'Hyderabad',
      householdDetails: 'Widow living with two grandchildren; no formal pension.',
      submittedBy: citizenUserId,
      forcedStatus: 'approved',
    },
    {
      caseCode: 'C-098',
      citizenName: 'Muhammad Aslam',
      applicantName: 'Muhammed Aslam',
      cnic: '',
      age: null,
      monthlyIncome: null,
      district: 'Karachi Central',
      householdDetails: 'Daily-wage laborer; CNIC card misplaced during flood relocation.',
      submittedBy: helperUserId,
      forcedStatus: 'in_review',
    },
    {
      caseCode: 'C-099',
      citizenName: 'Fatima Bibi',
      applicantName: 'Fatma Bibi',
      cnic: '42201-7654321-2',
      age: 47,
      monthlyIncome: 12000,
      district: 'Karachi South',
      householdDetails: 'Single-income tailoring household of 5.',
      submittedBy: citizenUserId,
      forcedStatus: 'needs_proof',
    },
    {
      caseCode: 'C-100',
      citizenName: 'Mohammad Aslam',
      applicantName: 'Mohammad Aslam',
      cnic: '42101-1234999-1',
      age: 61,
      monthlyIncome: 30000,
      district: 'Lahore',
      householdDetails: 'Small grocery shop owner requesting medical emergency support.',
      submittedBy: officerUserId,
      forcedStatus: 'in_review',
    },
    {
      caseCode: 'C-101',
      citizenName: 'Bilal Ahmed',
      applicantName: 'Bilal Ahmed',
      cnic: '35202-8877665-3',
      age: 42,
      monthlyIncome: 16000,
      district: 'Lahore',
      householdDetails: 'Declared Rs 16,000; registry lists Rs 29,000.',
      submittedBy: citizenUserId,
      forcedStatus: 'escalated',
    },
  ];

  for (const sc of seedCases) {
    const cnicHash = sc.cnic ? hashCnic(sc.cnic) : '';
    const cnicMasked = sc.cnic ? maskCnic(sc.cnic) : 'Not provided';
    const decision = evaluateEligibility(
      {
        name: sc.applicantName,
        cnicHash,
        cnicMasked,
        age: sc.age,
        monthlyIncome: sc.monthlyIncome,
      },
      ruleV1,
      registryRows
    );

    const cid = citizenIdMap.get(sc.citizenName)!;
    const [insertedApp] = await db
      .insert(applications)
      .values({
        caseCode: sc.caseCode,
        citizenId: cid,
        submittedByUserId: sc.submittedBy,
        idempotencyKey: `seed-${sc.caseCode}`,
        applicantName: sc.applicantName,
        cnicMasked,
        cnicHash,
        age: sc.age,
        monthlyIncome: sc.monthlyIncome,
        householdDetails: sc.householdDetails,
        contactPhone: '0300-***-8171',
        district: sc.district,
        status: sc.forcedStatus,
        route: decision.route,
        confidence: decision.confidence,
        ruleVersion: 1,
        matchedRegistryName: decision.matchedRegistryName,
        urgencyScore: decision.urgencyScore,
        isDraft: false,
      })
      .returning();

    await db.insert(applicationDecisions).values({
      applicationId: insertedApp.id,
      ruleVersion: 1,
      confidence: decision.confidence,
      deterministicEligible: decision.deterministicEligible,
      route: decision.route,
      traceJson: JSON.stringify(decision.trace),
      whyEn: decision.whyEn,
      whyUr: decision.whyUr,
      aiSummaryEn: decision.whyEn,
      aiSummaryUr: decision.whyUr,
      aiModel: 'deterministic-engine-v1',
    });

    await db.insert(applicationStatusHistory).values({
      applicationId: insertedApp.id,
      actorUserId: sc.submittedBy,
      actorRole: 'system',
      fromStatus: null,
      toStatus: sc.forcedStatus,
      note: `Seeded demonstration case (${sc.caseCode}) routed to ${decision.route}`,
    });
  }

  // 6. Seed Scam Checks across districts (for live Scam Map & Evaluation)
  const seedScams = [
    {
      messagePreview: 'URGENT: Your Rs 25,000 relief payment is blocked! Verify CNIC and OTP at http://bit.ly/claim-now',
      riskLevel: 'high',
      confidence: 0.96,
      indicators: ['Urgency pressure', 'OTP request', 'Shortened suspicious URL', 'CNIC harvesting'],
      explanationEn: 'This message uses urgent pressure, requests your OTP and CNIC, and links to an unofficial shortened URL.',
      explanationUr: 'اس پیغام میں فوری دباؤ ڈالا جا رہا ہے، او ٹی پی اور شناختی کارڈ مانگا گیا ہے اور غیر سرکاری لنک دیا گیا ہے۔',
      actions: ['Do not click the link', 'Never share any OTP or PIN', 'Block and report the sender'],
      humanReviewRequired: false,
      region: 'Karachi',
    },
    {
      messagePreview: 'Congratulations! You won Rs 35,000 flood relief prize. Send Rs 500 Easypaisa fee to claim.',
      riskLevel: 'high',
      confidence: 0.94,
      indicators: ['Advance fee demand', 'Fake relief prize claim'],
      explanationEn: 'Legitimate relief programs never charge an advance Easypaisa or JazzCash fee to release funds.',
      explanationUr: 'کوئی بھی سرکاری امدادی پروگرام رقم جاری کرنے کے لیے پیشگی فیس نہیں مانگتا۔',
      actions: ['Do not send money', 'Delete the message'],
      humanReviewRequired: false,
      region: 'Lahore',
    },
    {
      messagePreview: 'Please confirm your household details by replying with your bank PIN before 5 PM.',
      riskLevel: 'medium',
      confidence: 0.68,
      indicators: ['PIN request', 'Deadline pressure'],
      explanationEn: 'Asking for a banking PIN over SMS is a strong warning sign. Escalated for officer verification.',
      explanationUr: 'ایس ایم ایس پر بینک پن مانگنا مشکوک علامت ہے۔ تصدیق کے لیے افسر کو بھیجا گیا ہے۔',
      actions: ['Do not reply with your PIN', 'Verify via official 8171 portal'],
      humanReviewRequired: true,
      region: 'Multan',
    },
    {
      messagePreview: 'Dear citizen, your application C-097 was recorded. Track status on official portal 8171.',
      riskLevel: 'low',
      confidence: 0.86,
      indicators: ['Official 8171 reference', 'No link or OTP request'],
      explanationEn: 'Matches informational notice style with no link or credential request. Still never share OTPs.',
      explanationUr: 'یہ معلوماتی پیغام لگتا ہے اور اس میں کوئی لنک یا کوڈ نہیں مانگا گیا۔ پھر بھی او ٹی پی کسی کو نہ دیں۔',
      actions: ['Verify inside Madad Desk portal', 'Never share OTPs even with known contacts'],
      humanReviewRequired: false,
      region: 'Hyderabad',
    },
  ];

  for (const s of seedScams) {
    await db.insert(scamChecks).values({
      userId: citizenUserId,
      messagePreview: s.messagePreview,
      hasImage: false,
      riskLevel: s.riskLevel,
      confidence: s.confidence,
      indicatorsJson: JSON.stringify(s.indicators),
      explanationEn: s.explanationEn,
      explanationUr: s.explanationUr,
      recommendedActionsJson: JSON.stringify(s.actions),
      humanReviewRequired: s.humanReviewRequired,
      deterministicSignalsJson: JSON.stringify({ seeded: true }),
      region: s.region,
      aiModel: 'seed-hybrid-detector',
    });
  }

  // 7. Seed Notifications & Audit Logs & Mock Service Logs
  await db.insert(notifications).values([
    {
      userId: citizenUserId,
      titleEn: 'Additional Proof Requested (C-099)',
      titleUr: 'مزید ثبوت درکار ہے (C-099)',
      bodyEn: 'Your application C-099 needs a clearer CNIC photo because the name spelling differed slightly.',
      bodyUr: 'آپ کی درخواست C-099 کے لیے شناختی کارڈ کی واضح تصویر درکار ہے۔',
      category: 'evidence',
      relatedCaseCode: 'C-099',
    },
    {
      userId: citizenUserId,
      titleEn: 'Application Approved (C-097)',
      titleUr: 'درخواست منظور ہو گئی (C-097)',
      bodyEn: 'Demo case C-097 matched all Rule v1 criteria.',
      bodyUr: 'ڈیمو کیس C-097 موجودہ اصولوں کے مطابق منظور ہو گیا۔',
      category: 'decision',
      relatedCaseCode: 'C-097',
    },
  ]);

  await db.insert(auditLogs).values([
    {
      actorUserId: adminUserId,
      actorRole: 'admin',
      actorLabel: 'Ayesha Siddiqui',
      action: 'PUBLISH_RULE_V1',
      resourceType: 'eligibility_rules',
      resourceId: 'v1',
      detail: 'Activated Baseline Household Relief Policy v1 (maxIncome=25000, costWrong=10, costSlow=1)',
      severity: 'info',
    },
    {
      actorUserId: null,
      actorRole: 'system',
      actorLabel: 'Eligibility Engine',
      action: 'SEED_DEMO_CASES',
      resourceType: 'applications',
      resourceId: 'C-097..C-101',
      detail: 'Seeded 5 synthetic Pakistani demonstration cases with explicit mock registry data',
      severity: 'info',
    },
  ]);

  await db.insert(mockServiceLogs).values([
    {
      serviceName: 'mock_identity',
      requestRef: 'ID-INIT-001',
      status: 'success',
      latencyMs: 38,
      summary: 'Synthetic NADRA-style registry initialized with 6 demonstration records',
    },
    {
      serviceName: 'mock_payment',
      requestRef: 'PAY-INIT-001',
      status: 'success',
      latencyMs: 52,
      summary: 'Mock Raast-style disbursement adapter ready (requires payment_disbursement consent)',
    },
    {
      serviceName: 'mock_sms',
      requestRef: 'SMS-INIT-001',
      status: 'unavailable',
      latencyMs: 12,
      summary: 'External SMS gateway credentials not configured; in-app notifications active',
    },
  ]);
}
