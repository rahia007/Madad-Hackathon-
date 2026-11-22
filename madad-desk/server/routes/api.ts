import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import express, { type NextFunction, type Request, type Response } from 'express';
import multer from 'multer';
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from '../../src/db/index.ts';
import {
  agentRuns,
  aiTelemetry,
  apiKeys,
  applicationDecisions,
  applicationDocuments,
  applications,
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
  ruleSimulations,
  scamChecks,
  userRoles,
  users,
  webhookDeliveries,
  webhooks,
} from '../../src/db/schema.ts';
import { ensureDatabaseSeeded, resetDemoData } from '../../src/db/seed.ts';
import {
  encryptSensitive,
  generateApiKey,
  hashCnic,
  hashPassword,
  maskCnic,
  signQrSlipPayload,
  signSessionToken,
  verifyPassword,
  verifyQrSlipPayload,
  verifySessionToken,
} from '../../src/lib/crypto.ts';
import { computeAutoThreshold, evaluateEligibility } from '../../src/lib/eligibility.ts';
import {
  type AppRole,
  type AuthenticatedRequest,
  recordAudit,
  requireAuth,
  requireRole,
} from '../middleware/auth.ts';
import {
  analyzeScamWithAI,
  askApplicationAssistant,
  extractDocumentWithAI,
  extractFormFromSpeechWithAI,
  generateDecisionExplanation,
  retrievePolicyCitations,
  runTriageAgentWithAI,
  synthesizeSpeechWithAI,
  transcribeAudioWithAI,
} from '../services/ai.ts';
import {
  dispatchNotification,
  dispatchOutboundWebhooks,
  dispatchSingleWebhook,
  getGatewayCapabilities,
  isAllowedWebhookUrl,
  mockIdentityLookup,
  mockPaymentDisbursement,
} from '../services/mockAdapters.ts';

export const apiRouter = express.Router();

// Private upload directory outside public/
const UPLOAD_DIR = path.resolve(process.cwd(), 'private_uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const ALLOWED_DOC_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_DOC_MIMES.has(file.mimetype)) {
      cb(new Error('Unsupported file type. Allowed: JPEG, PNG, WebP, PDF.'));
      return;
    }
    cb(null, true);
  },
});

// Simple sliding-window rate limiter
const rateBuckets = new Map<string, number[]>();
function rateLimit(maxRequests: number, windowMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${req.ip || 'unknown'}:${req.baseUrl}${req.path}`;
    const now = Date.now();
    const history = (rateBuckets.get(key) || []).filter((t) => now - t < windowMs);
    if (history.length >= maxRequests) {
      res.status(429).json({ error: 'Too many requests. Please slow down and try again shortly.' });
      return;
    }
    history.push(now);
    rateBuckets.set(key, history);
    next();
  };
}

// Ensure seed data exists on first API call
apiRouter.use(async (_req, _res, next) => {
  await ensureDatabaseSeeded();
  next();
});

// ---------------------------------------------------------------------------
// Health & OpenAPI Documentation
// ---------------------------------------------------------------------------
apiRouter.get('/health', async (_req, res) => {
  try {
    await db.execute(sql`SELECT 1`);
    res.json({
      status: 'ok',
      database: 'connected',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY),
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('Healthcheck error:', err);
    res.status(503).json({ status: 'degraded', database: 'unavailable' });
  }
});

apiRouter.get('/openapi.json', (_req, res) => {
  res.json({
    openapi: '3.0.3',
    info: {
      title: 'Madad Desk Public Service API',
      version: '1.0.0',
      description:
        'Authenticated civic relief platform API with deterministic eligibility routing, server-enforced consent, mock DPI adapters, and Gemini AI explainability.',
    },
    servers: [{ url: '/api' }],
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
        apiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' },
      },
    },
    security: [{ bearerAuth: [] }, { apiKeyAuth: [] }],
    paths: {
      '/applications': {
        get: { summary: 'List authorized applications for the signed-in user/role' },
        post: { summary: 'Create or save draft relief application' },
      },
      '/applications/{id}/submit': {
        post: { summary: 'Run deterministic eligibility + AI explanation and submit case' },
      },
      '/applications/{id}/documents': {
        post: { summary: 'Upload supporting document into private storage' },
      },
      '/review-queue': {
        get: { summary: 'Officer-only review queue sorted by confidence and urgency' },
      },
      '/applications/{id}/review': {
        post: { summary: 'Officer-only approve, reject (with justification), or escalate' },
      },
      '/consents': {
        get: { summary: 'View citizen consent settings and consent history' },
        post: { summary: 'Grant or immediately withdraw data-sharing consent' },
      },
      '/ai/scam-check': {
        post: { summary: 'Hybrid deterministic + Gemini scam classifier (text & screenshot)' },
      },
      '/ai/assistant': {
        post: { summary: 'Permission-scoped bilingual Urdu/English assistant with Policy RAG citations' },
      },
      '/ai/voice/fill-form': {
        post: { summary: 'Voice-to-Form bilingual speech extraction into application fields' },
      },
      '/ai/agent/triage/{id}': {
        post: { summary: 'Multi-turn Gemini FunctionDeclaration triage agent for a case' },
      },
      '/policy/docs': {
        get: { summary: 'List active relief policy handbook sections' },
        post: { summary: 'Admin-only publish new policy section for RAG retrieval' },
      },
      '/policy/ask': {
        post: { summary: 'Policy RAG question answering with handbook section citations' },
      },
      '/applications/{id}/slip-qr': {
        get: { summary: 'Generate cryptographic HMAC-SHA256 signed QR token for case slip' },
      },
      '/applications/verify-qr': {
        post: { summary: 'Verify QR slip cryptographic signature and live database status' },
      },
      '/admin/rules': {
        get: { summary: 'List versioned eligibility rules' },
        post: { summary: 'Admin-only publish new rule version' },
      },
      '/admin/rules/simulate': {
        post: { summary: 'Admin-only digital twin replay on historical cases' },
      },
      '/admin/evaluation': {
        get: { summary: 'AI latency/cost telemetry, human override calibration, and cross-claim anomaly alerts' },
      },
      '/admin/webhooks': {
        get: { summary: 'List outbound webhooks, recent deliveries, and real messaging gateway status' },
        post: { summary: 'Admin-only register SSRF-protected HMAC webhook endpoint' },
      },
      '/audit': {
        get: { summary: 'Auditor/Admin read-only audit trail' },
      },
    },
  });
});

// ---------------------------------------------------------------------------
// Authentication Endpoints
// ---------------------------------------------------------------------------
const registerSchema = z.object({
  email: z.string().email().max(120),
  password: z.string().min(8).max(100),
  displayName: z.string().min(2).max(100),
  cnic: z.string().optional(),
  district: z.string().max(60).optional(),
  preferredLang: z.enum(['en', 'ur']).optional(),
});

apiRouter.post('/auth/register', rateLimit(15, 60_000), async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid registration data.' });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  try {
    const existing = await db.select().from(users).where(eq(users.email, email));
    if (existing[0]) {
      res.status(409).json({ error: 'An account with this email already exists.' });
      return;
    }

    const uid = `local-${crypto.randomUUID()}`;
    const passwordHash = hashPassword(parsed.data.password);

    const createdUser = await db.transaction(async (tx) => {
      const [u] = await tx
        .insert(users)
        .values({
          uid,
          email,
          displayName: parsed.data.displayName.trim(),
          passwordHash,
          preferredLang: parsed.data.preferredLang || 'ur',
          isDemoAccount: false,
        })
        .returning();

      // New public registrations are strictly citizen role
      await tx.insert(userRoles).values({
        userId: u.id,
        role: 'citizen',
        tenantId: 'relief-dept-pk',
      });

      const cnicRaw = parsed.data.cnic?.trim() || `99900-${Math.floor(1000000 + Math.random() * 8999999)}-1`;
      const [cit] = await tx
        .insert(citizens)
        .values({
          userId: u.id,
          fullName: parsed.data.displayName.trim(),
          cnicMasked: maskCnic(cnicRaw),
          cnicHash: hashCnic(cnicRaw),
          cnicEncrypted: encryptSensitive(cnicRaw),
          district: parsed.data.district?.trim() || 'Karachi South',
          isSyntheticDemo: false,
        })
        .returning();

      const defaultScopes = [
        { scope: 'department_review', granteeLabel: 'Public Relief Department', granted: true },
        { scope: 'document_access', granteeLabel: 'Officer Verification & OCR', granted: true },
        { scope: 'helper_access', granteeLabel: 'Community Helper Access', granted: false },
        { scope: 'payment_disbursement', granteeLabel: 'Mock Payment Adapter', granted: false },
      ];
      for (const s of defaultScopes) {
        const [cRow] = await tx
          .insert(consents)
          .values({ citizenId: cit.id, scope: s.scope, granteeLabel: s.granteeLabel, granted: s.granted })
          .returning();
        await tx.insert(consentHistory).values({
          consentId: cRow.id,
          citizenId: cit.id,
          actorUserId: u.id,
          scope: s.scope,
          action: s.granted ? 'granted' : 'withdrawn',
          note: 'Initial registration privacy preference',
        });
      }

      await tx.insert(notificationPreferences).values({
        userId: u.id,
        inApp: true,
        smsMock: true,
        emailMock: false,
      });

      return u;
    });

    const token = signSessionToken({
      userId: createdUser.id,
      uid: createdUser.uid,
      email: createdUser.email,
    });

    await recordAudit({
      actorUserId: createdUser.id,
      actorRole: 'citizen',
      actorLabel: createdUser.displayName,
      action: 'USER_REGISTERED',
      resourceType: 'users',
      resourceId: String(createdUser.id),
      detail: 'New citizen account registered',
    });

    res.status(201).json({
      token,
      user: {
        id: createdUser.id,
        email: createdUser.email,
        displayName: createdUser.displayName,
        role: 'citizen',
        preferredLang: createdUser.preferredLang,
        isDemoAccount: false,
      },
    });
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Unable to register account.' });
  }
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

apiRouter.post('/auth/login', rateLimit(25, 60_000), async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid email and password are required.' });
    return;
  }

  const email = parsed.data.email.trim().toLowerCase();
  try {
    const rows = await db.select().from(users).where(eq(users.email, email));
    const user = rows[0];
    if (!user || !user.passwordHash || !verifyPassword(parsed.data.password, user.passwordHash)) {
      await recordAudit({
        actorRole: 'anonymous',
        actorLabel: email,
        action: 'LOGIN_FAILED',
        resourceType: 'auth',
        detail: 'Invalid email or password attempt',
        severity: 'security',
      });
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    const roles = await db.select().from(userRoles).where(eq(userRoles.userId, user.id));
    const role = (roles[0]?.role as AppRole) || 'citizen';
    const token = signSessionToken({ userId: user.id, uid: user.uid, email: user.email });

    await recordAudit({
      actorUserId: user.id,
      actorRole: role,
      actorLabel: user.displayName,
      action: 'LOGIN_SUCCESS',
      resourceType: 'auth',
      detail: `Signed in via password authentication as ${role}`,
    });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role,
        preferredLang: user.preferredLang,
        isDemoAccount: user.isDemoAccount,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Sign-in failed.' });
  }
});

// Explicit Demonstration-Only Login for the 5 synthetic hackathon demo accounts
apiRouter.post('/auth/demo-login', rateLimit(40, 60_000), async (req, res) => {
  const roleSchema = z.object({
    role: z.enum(['citizen', 'helper', 'officer', 'admin', 'auditor']),
  });
  const parsed = roleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid demo role requested.' });
    return;
  }

  const emailMap: Record<AppRole, string> = {
    citizen: 'citizen.demo@madaddesk.pk',
    helper: 'helper.demo@madaddesk.pk',
    officer: 'officer.demo@madaddesk.pk',
    admin: 'admin.demo@madaddesk.pk',
    auditor: 'auditor.demo@madaddesk.pk',
  };

  try {
    const rows = await db
      .select()
      .from(users)
      .where(and(eq(users.email, emailMap[parsed.data.role]), eq(users.isDemoAccount, true)));
    const user = rows[0];
    if (!user) {
      res.status(404).json({ error: 'Demo account not initialized.' });
      return;
    }

    const token = signSessionToken({ userId: user.id, uid: user.uid, email: user.email });
    await recordAudit({
      actorUserId: user.id,
      actorRole: parsed.data.role,
      actorLabel: user.displayName,
      action: 'DEMO_LOGIN',
      resourceType: 'auth',
      detail: `Signed into synthetic demo account (${parsed.data.role})`,
    });

    res.json({
      token,
      demoOnly: true,
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: parsed.data.role,
        preferredLang: user.preferredLang,
        isDemoAccount: true,
      },
    });
  } catch (err) {
    console.error('Demo login error:', err);
    res.status(500).json({ error: 'Failed to sign into demo account.' });
  }
});

apiRouter.get('/auth/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const citRows = await db.select().from(citizens).where(eq(citizens.userId, req.auth!.userId));
    res.json({
      user: req.auth,
      citizenProfile: citRows[0]
        ? {
            id: citRows[0].id,
            fullName: citRows[0].fullName,
            cnicMasked: citRows[0].cnicMasked,
            age: citRows[0].age,
            monthlyIncome: citRows[0].monthlyIncome,
            householdSize: citRows[0].householdSize,
            district: citRows[0].district,
            isSyntheticDemo: citRows[0].isSyntheticDemo,
          }
        : null,
    });
  } catch (err) {
    console.error('Profile fetch error:', err);
    res.status(500).json({ error: 'Failed to load profile.' });
  }
});

apiRouter.patch('/auth/me', requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    preferredLang: z.enum(['en', 'ur']).optional(),
    displayName: z.string().min(2).max(100).optional(),
    district: z.string().min(2).max(60).optional(),
    householdSize: z.number().int().min(1).max(30).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid profile update payload.' });
    return;
  }

  try {
    if (parsed.data.preferredLang || parsed.data.displayName) {
      await db
        .update(users)
        .set({
          ...(parsed.data.preferredLang ? { preferredLang: parsed.data.preferredLang } : {}),
          ...(parsed.data.displayName ? { displayName: parsed.data.displayName.trim() } : {}),
          updatedAt: new Date(),
        })
        .where(eq(users.id, req.auth!.userId));
    }

    if (parsed.data.district || parsed.data.householdSize) {
      await db
        .update(citizens)
        .set({
          ...(parsed.data.district ? { district: parsed.data.district.trim() } : {}),
          ...(parsed.data.householdSize ? { householdSize: parsed.data.householdSize } : {}),
        })
        .where(eq(citizens.userId, req.auth!.userId));
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Profile update error:', err);
    res.status(500).json({ error: 'Failed to update profile.' });
  }
});

// ---------------------------------------------------------------------------
// Citizen Consents & Privacy Control
// ---------------------------------------------------------------------------
async function resolveCitizenForUser(userId: number, targetCitizenId?: number) {
  if (targetCitizenId) {
    const rows = await db.select().from(citizens).where(eq(citizens.id, targetCitizenId));
    return rows[0] || null;
  }
  const rows = await db.select().from(citizens).where(eq(citizens.userId, userId));
  if (rows[0]) return rows[0];

  // Create default citizen profile if Google user hasn't got one yet
  const userRows = await db.select().from(users).where(eq(users.id, userId));
  const u = userRows[0];
  if (!u) return null;

  const placeholderCnic = `99901-${String(1000000 + userId).slice(0, 7)}-1`;
  const [created] = await db
    .insert(citizens)
    .values({
      userId: u.id,
      fullName: u.displayName,
      cnicMasked: maskCnic(placeholderCnic),
      cnicHash: hashCnic(placeholderCnic),
      cnicEncrypted: encryptSensitive(placeholderCnic),
      isSyntheticDemo: false,
    })
    .returning();

  const scopes = [
    { scope: 'department_review', granteeLabel: 'Public Relief Department', granted: true },
    { scope: 'document_access', granteeLabel: 'Officer Verification & OCR', granted: true },
    { scope: 'helper_access', granteeLabel: 'Community Helper Access', granted: false },
    { scope: 'payment_disbursement', granteeLabel: 'Mock Payment Adapter', granted: false },
  ];
  for (const s of scopes) {
    const [cRow] = await db
      .insert(consents)
      .values({ citizenId: created.id, scope: s.scope, granteeLabel: s.granteeLabel, granted: s.granted })
      .returning();
    await db.insert(consentHistory).values({
      consentId: cRow.id,
      citizenId: created.id,
      actorUserId: u.id,
      scope: s.scope,
      action: s.granted ? 'granted' : 'withdrawn',
      note: 'Auto-created privacy controls',
    });
  }

  return created;
}

async function checkConsent(citizenId: number, scope: string): Promise<boolean> {
  const rows = await db
    .select()
    .from(consents)
    .where(and(eq(consents.citizenId, citizenId), eq(consents.scope, scope)));
  return Boolean(rows[0]?.granted);
}

apiRouter.get('/consents', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const citizen = await resolveCitizenForUser(req.auth!.userId);
    if (!citizen) {
      res.status(404).json({ error: 'Citizen profile not found.' });
      return;
    }

    const currentConsents = await db
      .select()
      .from(consents)
      .where(eq(consents.citizenId, citizen.id));
    const history = await db
      .select()
      .from(consentHistory)
      .where(eq(consentHistory.citizenId, citizen.id))
      .orderBy(desc(consentHistory.createdAt))
      .limit(25);

    res.json({ citizenId: citizen.id, consents: currentConsents, history });
  } catch (err) {
    console.error('Consents fetch error:', err);
    res.status(500).json({ error: 'Failed to load consent settings.' });
  }
});

apiRouter.post('/consents', requireAuth, requireRole('citizen', 'admin'), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    scope: z.enum(['helper_access', 'department_review', 'payment_disbursement', 'document_access']),
    granted: z.boolean(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid consent payload.' });
    return;
  }

  try {
    const citizen = await resolveCitizenForUser(req.auth!.userId);
    if (!citizen) {
      res.status(404).json({ error: 'Citizen profile not found.' });
      return;
    }

    const existing = await db
      .select()
      .from(consents)
      .where(and(eq(consents.citizenId, citizen.id), eq(consents.scope, parsed.data.scope)));

    let consentId: number;
    if (existing[0]) {
      consentId = existing[0].id;
      await db
        .update(consents)
        .set({ granted: parsed.data.granted, updatedAt: new Date() })
        .where(eq(consents.id, consentId));
    } else {
      const [inserted] = await db
        .insert(consents)
        .values({
          citizenId: citizen.id,
          scope: parsed.data.scope,
          granteeLabel: parsed.data.scope,
          granted: parsed.data.granted,
        })
        .returning();
      consentId = inserted.id;
    }

    await db.insert(consentHistory).values({
      consentId,
      citizenId: citizen.id,
      actorUserId: req.auth!.userId,
      scope: parsed.data.scope,
      action: parsed.data.granted ? 'granted' : 'withdrawn',
      note: parsed.data.granted
        ? 'Citizen granted data-sharing permission'
        : 'Citizen withdrew data-sharing permission (effective immediately)',
    });

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: parsed.data.granted ? 'CONSENT_GRANTED' : 'CONSENT_WITHDRAWN',
      resourceType: 'consents',
      resourceId: `${citizen.id}:${parsed.data.scope}`,
      detail: `Scope ${parsed.data.scope} set to ${parsed.data.granted ? 'sharing' : 'stopped'}`,
      severity: parsed.data.granted ? 'info' : 'warning',
    });

    await dispatchNotification({
      userId: req.auth!.userId,
      titleEn: `Privacy setting updated (${parsed.data.scope})`,
      titleUr: 'رازداری کی ترتیب اپ ڈیٹ ہو گئی',
      bodyEn: `Sharing for ${parsed.data.scope} is now ${parsed.data.granted ? 'active' : 'stopped immediately'}.`,
      bodyUr: `${parsed.data.scope} کے لیے ڈیٹا شیئرنگ اب ${parsed.data.granted ? 'چالو' : 'فوری طور پر بند'} ہے۔`,
      category: 'consent',
    });

    res.json({ ok: true, scope: parsed.data.scope, granted: parsed.data.granted });
  } catch (err) {
    console.error('Consent update error:', err);
    res.status(500).json({ error: 'Failed to update consent.' });
  }
});

apiRouter.delete('/consents/:scope', requireAuth, requireRole('citizen'), async (req: AuthenticatedRequest, res) => {
  const scope = String(req.params.scope || '');
  const validScopes = ['helper_access', 'department_review', 'payment_disbursement', 'document_access'];
  if (!validScopes.includes(scope)) {
    res.status(400).json({ error: 'Invalid consent scope.' });
    return;
  }
  try {
    const citizen = await resolveCitizenForUser(req.auth!.userId);
    if (!citizen) {
      res.status(404).json({ error: 'Citizen profile not found.' });
      return;
    }
    const existing = await db
      .select()
      .from(consents)
      .where(and(eq(consents.citizenId, citizen.id), eq(consents.scope, scope)));
    if (existing[0]) {
      await db
        .update(consents)
        .set({ granted: false, updatedAt: new Date() })
        .where(eq(consents.id, existing[0].id));
      await db.insert(consentHistory).values({
        consentId: existing[0].id,
        citizenId: citizen.id,
        actorUserId: req.auth!.userId,
        scope,
        action: 'withdrawn',
        note: 'Withdrawn via DELETE /api/consents/:scope',
      });
    }
    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'CONSENT_WITHDRAWN',
      resourceType: 'consents',
      resourceId: `${citizen.id}:${scope}`,
      detail: `Immediately withdrew ${scope} consent`,
      severity: 'warning',
    });
    res.json({ ok: true, scope, granted: false });
  } catch (err) {
    console.error('Consent delete error:', err);
    res.status(500).json({ error: 'Failed to withdraw consent.' });
  }
});

// ---------------------------------------------------------------------------
// Community Helper Portal (Backend-Enforced Family Consent)
// ---------------------------------------------------------------------------
apiRouter.get('/helper/families', requireAuth, requireRole('helper', 'admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const assignments = await db
      .select()
      .from(helperAssignments)
      .where(eq(helperAssignments.helperUserId, req.auth!.userId));

    const results = [];
    for (const a of assignments) {
      const citRows = await db.select().from(citizens).where(eq(citizens.id, a.citizenId));
      const cit = citRows[0];
      if (!cit) continue;
      const helperConsent = await checkConsent(cit.id, 'helper_access');
      const docConsent = await checkConsent(cit.id, 'document_access');
      const caseCountRows = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(applications)
        .where(eq(applications.citizenId, cit.id));

      results.push({
        citizenId: cit.id,
        fullName: cit.fullName,
        cnicMasked: helperConsent ? cit.cnicMasked : 'Protected (no consent)',
        district: helperConsent ? cit.district : 'Protected',
        relationship: a.relationship,
        helperConsentGranted: helperConsent,
        documentConsentGranted: docConsent,
        applicationCount: helperConsent ? (caseCountRows[0]?.value ?? 0) : null,
      });
    }

    res.json({ families: results });
  } catch (err) {
    console.error('Helper families error:', err);
    res.status(500).json({ error: 'Failed to load assigned families.' });
  }
});

apiRouter.get('/helper/families/:citizenId', requireAuth, requireRole('helper', 'admin'), async (req: AuthenticatedRequest, res) => {
  const citizenId = Number(req.params.citizenId);
  if (!Number.isInteger(citizenId)) {
    res.status(400).json({ error: 'Invalid citizen ID.' });
    return;
  }

  try {
    const assigned = await db
      .select()
      .from(helperAssignments)
      .where(
        and(
          eq(helperAssignments.helperUserId, req.auth!.userId),
          eq(helperAssignments.citizenId, citizenId)
        )
      );

    if (!assigned[0] && req.auth!.role !== 'admin') {
      await recordAudit({
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        actorLabel: req.auth!.displayName,
        action: 'DENIED_UNASSIGNED_FAMILY',
        resourceType: 'citizens',
        resourceId: String(citizenId),
        detail: 'Helper attempted to open unassigned family profile',
        severity: 'security',
      });
      res.status(403).json({ error: 'This family is not assigned to you.' });
      return;
    }

    const hasConsent = await checkConsent(citizenId, 'helper_access');
    if (!hasConsent) {
      await recordAudit({
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        actorLabel: req.auth!.displayName,
        action: 'DENIED_NO_CONSENT',
        resourceType: 'citizens',
        resourceId: String(citizenId),
        detail: 'Blocked helper access: family has withdrawn or not granted helper_access consent',
        severity: 'security',
      });
      res.status(403).json({
        error: 'Access denied: this family has not granted permission for you to view or manage their record.',
      });
      return;
    }

    const citRows = await db.select().from(citizens).where(eq(citizens.id, citizenId));
    const cit = citRows[0];
    if (!cit) {
      res.status(404).json({ error: 'Family profile not found.' });
      return;
    }

    const familyApps = await db
      .select()
      .from(applications)
      .where(and(eq(applications.citizenId, citizenId), isNull(applications.deletedAt)))
      .orderBy(desc(applications.createdAt));

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'HELPER_VIEWED_FAMILY',
      resourceType: 'citizens',
      resourceId: String(citizenId),
      detail: `Helper accessed authorized profile for ${cit.fullName}`,
    });

    if (cit.userId) {
      await dispatchNotification({
        userId: cit.userId,
        titleEn: 'Helper accessed your authorized record',
        titleUr: 'ہیلپر نے آپ کا ریکارڈ کھولا',
        bodyEn: `${req.auth!.displayName} opened your family record under active consent.`,
        bodyUr: `${req.auth!.displayName} نے آپ کی اجازت کے تحت آپ کا خاندانی ریکارڈ کھولا۔`,
        category: 'consent',
      });
    }

    res.json({
      family: {
        id: cit.id,
        fullName: cit.fullName,
        cnicMasked: cit.cnicMasked,
        age: cit.age,
        monthlyIncome: cit.monthlyIncome,
        householdSize: cit.householdSize,
        district: cit.district,
      },
      applications: familyApps,
    });
  } catch (err) {
    console.error('Helper family detail error:', err);
    res.status(500).json({ error: 'Failed to load family details.' });
  }
});

// ---------------------------------------------------------------------------
// Applications (Draft, Submit, Offline Sync, List, Detail, Document Upload)
// ---------------------------------------------------------------------------
async function getActiveRule() {
  const rows = await db
    .select()
    .from(eligibilityRules)
    .where(eq(eligibilityRules.isActive, true))
    .orderBy(desc(eligibilityRules.version))
    .limit(1);
  if (rows[0]) return rows[0];
  const fallback = await db.select().from(eligibilityRules).orderBy(desc(eligibilityRules.version)).limit(1);
  return fallback[0];
}

const applicationInputSchema = z.object({
  applicantName: z.string().min(2).max(120),
  cnic: z.string().max(25).optional().default(''),
  age: z.union([z.number().int().min(0).max(120), z.null()]).optional(),
  monthlyIncome: z.union([z.number().int().min(0).max(10_000_000), z.null()]).optional(),
  householdDetails: z.string().max(1000).optional().default(''),
  contactPhone: z.string().max(30).optional().default(''),
  district: z.string().max(60).optional().default('Karachi South'),
  targetCitizenId: z.number().int().optional(),
  idempotencyKey: z.string().min(4).max(120).optional(),
  isDraft: z.boolean().optional().default(false),
  offlineCreatedAt: z.string().optional(),
});

async function canAccessApplication(auth: NonNullable<AuthenticatedRequest['auth']>, appRow: typeof applications.$inferSelect): Promise<boolean> {
  if (auth.role === 'officer' || auth.role === 'admin' || auth.role === 'auditor') return true;
  if (appRow.submittedByUserId === auth.userId) return true;
  const citRows = await db.select().from(citizens).where(eq(citizens.id, appRow.citizenId));
  if (citRows[0]?.userId === auth.userId) return true;
  if (auth.role === 'helper') {
    const assigned = await db
      .select()
      .from(helperAssignments)
      .where(and(eq(helperAssignments.helperUserId, auth.userId), eq(helperAssignments.citizenId, appRow.citizenId)));
    if (assigned[0] && (await checkConsent(appRow.citizenId, 'helper_access'))) {
      return true;
    }
  }
  return false;
}

apiRouter.get('/applications', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const auth = req.auth!;
    const allApps = await db
      .select()
      .from(applications)
      .where(isNull(applications.deletedAt))
      .orderBy(desc(applications.createdAt));

    const visible = [];
    for (const app of allApps) {
      if (await canAccessApplication(auth, app)) {
        visible.push(app);
      }
    }

    res.json({ applications: visible });
  } catch (err) {
    console.error('List applications error:', err);
    res.status(500).json({ error: 'Failed to load applications.' });
  }
});

apiRouter.post('/applications', requireAuth, requireRole('citizen', 'helper', 'admin'), async (req: AuthenticatedRequest, res) => {
  const parsed = applicationInputSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid application input.' });
    return;
  }

  const data = parsed.data;
  const auth = req.auth!;

  try {
    let citizen: typeof citizens.$inferSelect | null = null;
    if (auth.role === 'helper') {
      if (!data.targetCitizenId) {
        res.status(400).json({ error: 'Helpers must select an assigned family.' });
        return;
      }
      const assigned = await db
        .select()
        .from(helperAssignments)
        .where(and(eq(helperAssignments.helperUserId, auth.userId), eq(helperAssignments.citizenId, data.targetCitizenId)));
      if (!assigned[0]) {
        res.status(403).json({ error: 'Family not assigned to this helper.' });
        return;
      }
      if (!(await checkConsent(data.targetCitizenId, 'helper_access'))) {
        await recordAudit({
          actorUserId: auth.userId,
          actorRole: auth.role,
          actorLabel: auth.displayName,
          action: 'DENIED_HELPER_SUBMIT_NO_CONSENT',
          resourceType: 'citizens',
          resourceId: String(data.targetCitizenId),
          detail: 'Helper attempted to create application without helper_access consent',
          severity: 'security',
        });
        res.status(403).json({ error: 'Consent required from this family before submitting on their behalf.' });
        return;
      }
      citizen = await resolveCitizenForUser(auth.userId, data.targetCitizenId);
    } else {
      citizen = await resolveCitizenForUser(auth.userId);
    }

    if (!citizen) {
      res.status(404).json({ error: 'Citizen record could not be resolved.' });
      return;
    }

    if (!data.isDraft && !(await checkConsent(citizen.id, 'department_review'))) {
      await recordAudit({
        actorUserId: auth.userId,
        actorRole: auth.role,
        actorLabel: auth.displayName,
        action: 'DENIED_NO_DEPARTMENT_CONSENT',
        resourceType: 'applications',
        detail: 'Blocked submission because department_review consent is withdrawn',
        severity: 'warning',
      });
      res.status(403).json({
        error: 'Sharing with the Relief Department is currently turned off in My Data. Enable it to submit.',
      });
      return;
    }

    const idempotencyKey =
      data.idempotencyKey ||
      `app-${citizen.id}-${crypto.createHash('sha256').update(`${data.applicantName}|${data.cnic}|${data.isDraft ? Date.now() : 'submit'}`).digest('hex').slice(0, 16)}`;

    // Duplicate prevention via idempotencyKey
    const existingByKey = await db
      .select()
      .from(applications)
      .where(eq(applications.idempotencyKey, idempotencyKey));
    if (existingByKey[0]) {
      const dec = await db
        .select()
        .from(applicationDecisions)
        .where(eq(applicationDecisions.applicationId, existingByKey[0].id))
        .orderBy(desc(applicationDecisions.createdAt))
        .limit(1);
      res.status(200).json({
        duplicatePrevented: true,
        application: existingByKey[0],
        decision: dec[0] || null,
      });
      return;
    }

    const cnicHash = data.cnic.trim() ? hashCnic(data.cnic) : '';
    const cnicMasked = data.cnic.trim() ? maskCnic(data.cnic) : 'Not provided';
    const caseCode = `C-${Math.floor(102 + Math.random() * 890)}-${Date.now().toString(36).slice(-3).toUpperCase()}`;
    const activeRule = await getActiveRule();
    const registry = await db.select().from(mockRegistryRecords);

    if (data.isDraft) {
      const [draft] = await db
        .insert(applications)
        .values({
          caseCode,
          citizenId: citizen.id,
          submittedByUserId: auth.userId,
          idempotencyKey,
          applicantName: data.applicantName.trim(),
          cnicMasked,
          cnicHash,
          age: data.age ?? null,
          monthlyIncome: data.monthlyIncome ?? null,
          householdDetails: data.householdDetails,
          contactPhone: data.contactPhone,
          district: data.district,
          status: 'draft',
          route: 'human',
          confidence: 0,
          ruleVersion: activeRule.version,
          isDraft: true,
        })
        .returning();

      await db.insert(applicationStatusHistory).values({
        applicationId: draft.id,
        actorUserId: auth.userId,
        actorRole: auth.role,
        fromStatus: null,
        toStatus: 'draft',
        note: 'Saved application draft',
      });

      res.status(201).json({ application: draft, decision: null });
      return;
    }

    // Run mock identity check + deterministic eligibility evaluation
    await mockIdentityLookup(cnicHash, data.applicantName);
    const decision = evaluateEligibility(
      {
        name: data.applicantName,
        cnicHash,
        cnicMasked,
        age: data.age ?? null,
        monthlyIncome: data.monthlyIncome ?? null,
      },
      activeRule,
      registry
    );

    const status =
      decision.route === 'auto'
        ? 'approved'
        : decision.route === 'docs'
          ? 'needs_proof'
          : 'in_review';

    // Optional AI grounded summary (non-blocking if key missing)
    let aiSummaryEn = decision.whyEn;
    let aiSummaryUr = decision.whyUr;
    let aiModel = 'deterministic-engine';
    if (process.env.GEMINI_API_KEY) {
      try {
        const explained = await generateDecisionExplanation({
          applicantName: data.applicantName,
          decision,
        });
        aiSummaryEn = explained.aiSummaryEn;
        aiSummaryUr = explained.aiSummaryUr;
        aiModel = 'deterministic-engine+gemini-4-hydrogen';
      } catch (aiErr) {
        console.warn('AI summary skipped due to model error:', aiErr);
      }
    }

    const result = await db.transaction(async (tx) => {
      const [appRow] = await tx
        .insert(applications)
        .values({
          caseCode,
          citizenId: citizen!.id,
          submittedByUserId: auth.userId,
          idempotencyKey,
          applicantName: data.applicantName.trim(),
          cnicMasked,
          cnicHash,
          age: data.age ?? null,
          monthlyIncome: data.monthlyIncome ?? null,
          householdDetails: data.householdDetails,
          contactPhone: data.contactPhone,
          district: data.district,
          status,
          route: decision.route,
          confidence: decision.confidence,
          ruleVersion: activeRule.version,
          matchedRegistryName: decision.matchedRegistryName,
          urgencyScore: decision.urgencyScore,
          isDraft: false,
          offlineCreatedAt: data.offlineCreatedAt ? new Date(data.offlineCreatedAt) : null,
          syncedAt: data.offlineCreatedAt ? new Date() : null,
        })
        .returning();

      const [decRow] = await tx
        .insert(applicationDecisions)
        .values({
          applicationId: appRow.id,
          ruleVersion: activeRule.version,
          confidence: decision.confidence,
          deterministicEligible: decision.deterministicEligible,
          route: decision.route,
          traceJson: JSON.stringify(decision.trace),
          whyEn: decision.whyEn,
          whyUr: decision.whyUr,
          aiSummaryEn,
          aiSummaryUr,
          aiModel,
        })
        .returning();

      await tx.insert(applicationStatusHistory).values({
        applicationId: appRow.id,
        actorUserId: auth.userId,
        actorRole: auth.role,
        fromStatus: null,
        toStatus: status,
        note: `Submitted and routed to ${decision.route} (confidence ${decision.confidence.toFixed(2)}, rule v${activeRule.version})`,
      });

      return { appRow, decRow };
    });

    await recordAudit({
      actorUserId: auth.userId,
      actorRole: auth.role,
      actorLabel: auth.displayName,
      action: 'APPLICATION_SUBMITTED',
      resourceType: 'applications',
      resourceId: result.appRow.caseCode,
      detail: `Route: ${decision.route}, confidence: ${decision.confidence.toFixed(2)}, rule: v${activeRule.version}`,
    });

    if (citizen.userId) {
      await dispatchNotification({
        userId: citizen.userId,
        titleEn: `Application ${result.appRow.caseCode}: ${status.replace('_', ' ')}`,
        titleUr: `درخواست ${result.appRow.caseCode} موصول ہو گئی`,
        bodyEn: decision.msgEn,
        bodyUr: decision.msgUr,
        category: 'application',
        relatedCaseCode: result.appRow.caseCode,
        recipientPhone: data.contactPhone || undefined,
      });
    }

    void dispatchOutboundWebhooks('APPLICATION_SUBMITTED', {
      caseCode: result.appRow.caseCode,
      status,
      route: decision.route,
      confidence: decision.confidence,
      district: result.appRow.district,
      ruleVersion: activeRule.version,
    });
    if (status === 'approved') {
      void dispatchOutboundWebhooks('APPLICATION_APPROVED', {
        caseCode: result.appRow.caseCode,
        mode: 'auto',
        ruleVersion: activeRule.version,
      });
    } else if (decision.route === 'human') {
      void dispatchOutboundWebhooks('CASE_ESCALATED', {
        caseCode: result.appRow.caseCode,
        urgencyScore: decision.urgencyScore,
        confidence: decision.confidence,
      });
    }

    res.status(201).json({
      application: result.appRow,
      decision: result.decRow,
      factors: decision.factors,
    });
  } catch (err) {
    console.error('Submit application error:', err);
    res.status(500).json({ error: 'Failed to process application.' });
  }
});

apiRouter.post('/applications/:id/submit', requireAuth, requireRole('citizen', 'helper', 'admin'), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid application ID.' });
    return;
  }

  try {
    const rows = await db.select().from(applications).where(eq(applications.id, id));
    const appRow = rows[0];
    if (!appRow || appRow.deletedAt) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }
    if (!(await canAccessApplication(req.auth!, appRow))) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }
    if (!appRow.isDraft) {
      res.status(400).json({ error: 'Application has already been submitted.' });
      return;
    }
    if (!(await checkConsent(appRow.citizenId, 'department_review'))) {
      res.status(403).json({ error: 'Department sharing consent is currently withdrawn.' });
      return;
    }

    const activeRule = await getActiveRule();
    const registry = await db.select().from(mockRegistryRecords);
    const decision = evaluateEligibility(
      {
        name: appRow.applicantName,
        cnicHash: appRow.cnicHash,
        cnicMasked: appRow.cnicMasked,
        age: appRow.age,
        monthlyIncome: appRow.monthlyIncome,
      },
      activeRule,
      registry
    );
    const status =
      decision.route === 'auto'
        ? 'approved'
        : decision.route === 'docs'
          ? 'needs_proof'
          : 'in_review';

    const [updated] = await db
      .update(applications)
      .set({
        isDraft: false,
        status,
        route: decision.route,
        confidence: decision.confidence,
        ruleVersion: activeRule.version,
        matchedRegistryName: decision.matchedRegistryName,
        urgencyScore: decision.urgencyScore,
        updatedAt: new Date(),
      })
      .where(eq(applications.id, id))
      .returning();

    const [decRow] = await db
      .insert(applicationDecisions)
      .values({
        applicationId: id,
        ruleVersion: activeRule.version,
        confidence: decision.confidence,
        deterministicEligible: decision.deterministicEligible,
        route: decision.route,
        traceJson: JSON.stringify(decision.trace),
        whyEn: decision.whyEn,
        whyUr: decision.whyUr,
        aiSummaryEn: decision.whyEn,
        aiSummaryUr: decision.whyUr,
        aiModel: 'deterministic-engine',
      })
      .returning();

    await db.insert(applicationStatusHistory).values({
      applicationId: id,
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      fromStatus: 'draft',
      toStatus: status,
      note: `Draft finalized and routed to ${decision.route}`,
    });

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'DRAFT_SUBMITTED',
      resourceType: 'applications',
      resourceId: updated.caseCode,
      detail: `Draft converted to ${status}`,
    });

    res.json({ application: updated, decision: decRow, factors: decision.factors });
  } catch (err) {
    console.error('Submit draft error:', err);
    res.status(500).json({ error: 'Failed to submit draft.' });
  }
});

apiRouter.get('/applications/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid application ID.' });
    return;
  }

  try {
    const rows = await db.select().from(applications).where(eq(applications.id, id));
    const appRow = rows[0];
    if (!appRow || appRow.deletedAt) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    if (!(await canAccessApplication(req.auth!, appRow))) {
      await recordAudit({
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        actorLabel: req.auth!.displayName,
        action: 'DENIED_IDOR_ATTEMPT',
        resourceType: 'applications',
        resourceId: appRow.caseCode,
        detail: `Blocked unauthorized read of application ${appRow.caseCode}`,
        severity: 'security',
      });
      res.status(403).json({ error: 'You do not have permission to view this application.' });
      return;
    }

    const decisions = await db
      .select()
      .from(applicationDecisions)
      .where(eq(applicationDecisions.applicationId, id))
      .orderBy(desc(applicationDecisions.createdAt));

    const history = await db
      .select()
      .from(applicationStatusHistory)
      .where(eq(applicationStatusHistory.applicationId, id))
      .orderBy(desc(applicationStatusHistory.createdAt));

    const docs = await db
      .select()
      .from(applicationDocuments)
      .where(eq(applicationDocuments.applicationId, id))
      .orderBy(desc(applicationDocuments.createdAt));

    // Attach short-lived signed download URLs (5 minutes)
    const docsWithSignedUrl = docs.map((d) => {
      const signed = signSessionToken({
        userId: req.auth!.userId,
        uid: `doc:${d.id}`,
        email: req.auth!.email,
      });
      return {
        ...d,
        signedUrl: `/api/documents/${d.id}/file?token=${encodeURIComponent(signed)}`,
      };
    });

    res.json({
      application: appRow,
      decision: decisions[0] || null,
      history,
      documents: docsWithSignedUrl,
    });
  } catch (err) {
    console.error('Application detail error:', err);
    res.status(500).json({ error: 'Failed to load application details.' });
  }
});

// Secure Document Upload + Optional AI Document Extraction
apiRouter.post(
  '/applications/:id/documents',
  requireAuth,
  requireRole('citizen', 'helper', 'officer', 'admin'),
  upload.single('file'),
  async (req: AuthenticatedRequest, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(400).json({ error: 'Invalid application ID.' });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: 'No file attached. Allowed: JPEG, PNG, WebP, PDF (max 5 MB).' });
      return;
    }

    try {
      const rows = await db.select().from(applications).where(eq(applications.id, id));
      const appRow = rows[0];
      if (!appRow || appRow.deletedAt) {
        res.status(404).json({ error: 'Application not found.' });
        return;
      }

      if (!(await canAccessApplication(req.auth!, appRow))) {
        res.status(403).json({ error: 'You are not authorized to upload documents to this case.' });
        return;
      }

      if (req.auth!.role === 'helper' && !(await checkConsent(appRow.citizenId, 'document_access'))) {
        res.status(403).json({ error: 'Citizen has withdrawn document_access consent.' });
        return;
      }

      const ext =
        req.file.mimetype === 'application/pdf'
          ? '.pdf'
          : req.file.mimetype === 'image/png'
            ? '.png'
            : req.file.mimetype === 'image/webp'
              ? '.webp'
              : '.jpg';
      const storageKey = `${crypto.randomUUID()}${ext}`;
      const resolvedPath = path.resolve(UPLOAD_DIR, storageKey);
      if (!resolvedPath.startsWith(UPLOAD_DIR + path.sep)) {
        res.status(400).json({ error: 'Invalid storage path.' });
        return;
      }

      fs.writeFileSync(resolvedPath, req.file.buffer);
      const sha256 = crypto.createHash('sha256').update(req.file.buffer).digest('hex');

      let extractionJson: string | null = null;
      let tamperRisk = 'unscanned';

      if (process.env.GEMINI_API_KEY) {
        try {
          const extracted = await extractDocumentWithAI({
            base64Data: req.file.buffer.toString('base64'),
            mimeType: req.file.mimetype,
            declaredName: appRow.applicantName,
            declaredAge: appRow.age,
            declaredIncome: appRow.monthlyIncome,
          });
          extractionJson = JSON.stringify(extracted);
          tamperRisk =
            extracted.tamperSignals.length > 0
              ? 'review_needed'
              : extracted.isBlurryOrUnreadable
                ? 'blurry'
                : 'clear';
        } catch (aiErr) {
          console.warn('AI document extraction skipped:', aiErr);
        }
      }

      const [docRow] = await db
        .insert(applicationDocuments)
        .values({
          applicationId: id,
          uploadedByUserId: req.auth!.userId,
          originalName: req.file.originalname.slice(0, 140),
          mimeType: req.file.mimetype,
          sizeBytes: req.file.size,
          storageKey,
          sha256,
          extractionJson,
          tamperRisk,
        })
        .returning();

      await db.insert(applicationStatusHistory).values({
        applicationId: id,
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        fromStatus: appRow.status,
        toStatus: appRow.status === 'needs_proof' ? 'in_review' : appRow.status,
        note: `Uploaded supporting document (${docRow.originalName})`,
      });

      if (appRow.status === 'needs_proof') {
        await db
          .update(applications)
          .set({ status: 'in_review', updatedAt: new Date() })
          .where(eq(applications.id, id));
      }

      await recordAudit({
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        actorLabel: req.auth!.displayName,
        action: 'DOCUMENT_UPLOADED',
        resourceType: 'application_documents',
        resourceId: `${appRow.caseCode}:${docRow.id}`,
        detail: `Uploaded ${docRow.mimeType} (${docRow.sizeBytes} bytes), tamper check: ${tamperRisk}`,
      });

      const signed = signSessionToken({
        userId: req.auth!.userId,
        uid: `doc:${docRow.id}`,
        email: req.auth!.email,
      });

      res.status(201).json({
        document: {
          ...docRow,
          signedUrl: `/api/documents/${docRow.id}/file?token=${encodeURIComponent(signed)}`,
        },
      });
    } catch (err) {
      console.error('Upload document error:', err);
      res.status(500).json({ error: 'Failed to store uploaded document.' });
    }
  }
);

apiRouter.get('/documents/:id/file', async (req, res) => {
  const docId = Number(req.params.id);
  const token = String(req.query.token || '');
  if (!Number.isInteger(docId) || !token) {
    res.status(401).json({ error: 'Missing signed document token.' });
    return;
  }

  const verified = verifySessionToken(token);
  if (!verified || verified.uid !== `doc:${docId}`) {
    res.status(403).json({ error: 'Document link expired or invalid.' });
    return;
  }

  try {
    const rows = await db.select().from(applicationDocuments).where(eq(applicationDocuments.id, docId));
    const doc = rows[0];
    if (!doc) {
      res.status(404).json({ error: 'Document not found.' });
      return;
    }

    const filePath = path.resolve(UPLOAD_DIR, doc.storageKey);
    if (!filePath.startsWith(UPLOAD_DIR + path.sep) || !fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Stored file missing.' });
      return;
    }

    res.setHeader('Content-Type', doc.mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${path.basename(doc.originalName)}"`);
    res.sendFile(filePath);
  } catch (err) {
    console.error('Serve document error:', err);
    res.status(500).json({ error: 'Failed to retrieve document.' });
  }
});

// ---------------------------------------------------------------------------
// Department Officer Review Queue & Actions
// ---------------------------------------------------------------------------
apiRouter.get('/review-queue', requireAuth, requireRole('officer', 'admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const sortBy = String(req.query.sort || 'confidence');
    const search = String(req.query.q || '').trim().toLowerCase();
    const statusFilter = String(req.query.status || 'pending');

    const allApps = await db
      .select()
      .from(applications)
      .where(isNull(applications.deletedAt))
      .orderBy(desc(applications.createdAt));

    let filtered = allApps.filter((a) => !a.isDraft);
    if (statusFilter === 'pending') {
      filtered = filtered.filter((a) => ['in_review', 'needs_proof', 'escalated'].includes(a.status));
    } else if (statusFilter !== 'all') {
      filtered = filtered.filter((a) => a.status === statusFilter);
    }

    if (search) {
      filtered = filtered.filter(
        (a) =>
          a.applicantName.toLowerCase().includes(search) ||
          a.caseCode.toLowerCase().includes(search) ||
          a.district.toLowerCase().includes(search)
      );
    }

    if (sortBy === 'urgency') {
      filtered.sort((a, b) => b.urgencyScore - a.urgencyScore || a.confidence - b.confidence);
    } else {
      filtered.sort((a, b) => a.confidence - b.confidence || b.urgencyScore - a.urgencyScore);
    }

    const enriched = [];
    for (const app of filtered) {
      const decs = await db
        .select()
        .from(applicationDecisions)
        .where(eq(applicationDecisions.applicationId, app.id))
        .orderBy(desc(applicationDecisions.createdAt))
        .limit(1);
      const docs = await db
        .select()
        .from(applicationDocuments)
        .where(eq(applicationDocuments.applicationId, app.id));
      enriched.push({
        ...app,
        decision: decs[0] || null,
        documentCount: docs.length,
        documents: docs,
      });
    }

    res.json({ queue: enriched });
  } catch (err) {
    console.error('Review queue error:', err);
    res.status(500).json({ error: 'Failed to load review queue.' });
  }
});

const reviewActionSchema = z.object({
  decision: z.enum(['approve', 'reject', 'request_evidence', 'escalate']),
  note: z.string().min(3, 'A justification or review note of at least 3 characters is required.').max(1000),
});

apiRouter.post('/applications/:id/review', requireAuth, requireRole('officer', 'admin'), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid application ID.' });
    return;
  }

  const parsed = reviewActionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Officer justification note is required.' });
    return;
  }

  try {
    const rows = await db.select().from(applications).where(eq(applications.id, id));
    const appRow = rows[0];
    if (!appRow || appRow.deletedAt) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }

    const statusMap = {
      approve: 'approved_by_officer',
      reject: 'rejected',
      request_evidence: 'needs_proof',
      escalate: 'escalated',
    } as const;
    const newStatus = statusMap[parsed.data.decision];

    await db.transaction(async (tx) => {
      await tx
        .update(applications)
        .set({
          status: newStatus,
          assignedOfficerId: req.auth!.userId,
          updatedAt: new Date(),
        })
        .where(eq(applications.id, id));

      const latestDec = await tx
        .select()
        .from(applicationDecisions)
        .where(eq(applicationDecisions.applicationId, id))
        .orderBy(desc(applicationDecisions.createdAt))
        .limit(1);

      if (latestDec[0]) {
        await tx
          .update(applicationDecisions)
          .set({
            humanDecision: newStatus,
            officerId: req.auth!.userId,
            officerNote: parsed.data.note.trim(),
          })
          .where(eq(applicationDecisions.id, latestDec[0].id));
      }

      await tx.insert(applicationStatusHistory).values({
        applicationId: id,
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        fromStatus: appRow.status,
        toStatus: newStatus,
        note: parsed.data.note.trim(),
      });
    });

    // If approved, attempt mock payment adapter (respecting consent!)
    let payoutResult = null;
    if (newStatus === 'approved_by_officer') {
      payoutResult = await mockPaymentDisbursement({
        caseCode: appRow.caseCode,
        citizenId: appRow.citizenId,
        amountPkr: 10500,
      });
    }

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: `OFFICER_${parsed.data.decision.toUpperCase()}`,
      resourceType: 'applications',
      resourceId: appRow.caseCode,
      detail: `${appRow.status} -> ${newStatus} | Note: ${parsed.data.note.trim()}`,
    });

    const citRows = await db.select().from(citizens).where(eq(citizens.id, appRow.citizenId));
    if (citRows[0]?.userId) {
      await dispatchNotification({
        userId: citRows[0].userId,
        titleEn: `Case ${appRow.caseCode} updated: ${newStatus.replace(/_/g, ' ')}`,
        titleUr: `کیس ${appRow.caseCode} کی صورتحال تبدیل ہو گئی`,
        bodyEn: `Officer note: ${parsed.data.note.trim()}`,
        bodyUr: `افسر کا پیغام: ${parsed.data.note.trim()}`,
        category: 'decision',
        relatedCaseCode: appRow.caseCode,
        recipientPhone: appRow.contactPhone || undefined,
      });
    }

    if (newStatus === 'approved_by_officer') {
      void dispatchOutboundWebhooks('APPLICATION_APPROVED', {
        caseCode: appRow.caseCode,
        mode: 'officer',
        officer: req.auth!.displayName,
      });
    } else if (newStatus === 'escalated') {
      void dispatchOutboundWebhooks('CASE_ESCALATED', {
        caseCode: appRow.caseCode,
        note: parsed.data.note.trim(),
      });
    }

    res.json({ ok: true, status: newStatus, payoutResult });
  } catch (err) {
    console.error('Officer review error:', err);
    res.status(500).json({ error: 'Failed to record officer decision.' });
  }
});

// ---------------------------------------------------------------------------
// AI Endpoints (Scam Detection, Assistant, Decision Room, Voice STT & TTS)
// ---------------------------------------------------------------------------
const scamCheckSchema = z.object({
  message: z.string().max(4000).optional().default(''),
  imageBase64: z.string().max(7_000_000).optional(),
  imageMimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']).optional(),
  region: z.string().max(60).optional().default('Karachi'),
});

apiRouter.post('/ai/scam-check', requireAuth, rateLimit(20, 60_000), async (req: AuthenticatedRequest, res) => {
  const parsed = scamCheckSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid scam-check payload.' });
    return;
  }
  if (!parsed.data.message.trim() && !parsed.data.imageBase64) {
    res.status(400).json({ error: 'Please paste a message or upload a screenshot to check.' });
    return;
  }

  try {
    const result = await analyzeScamWithAI({
      message: parsed.data.message,
      imageBase64: parsed.data.imageBase64,
      imageMimeType: parsed.data.imageMimeType,
    });

    const [saved] = await db
      .insert(scamChecks)
      .values({
        userId: req.auth!.userId,
        messagePreview: (parsed.data.message || '[Screenshot uploaded]').slice(0, 280),
        hasImage: Boolean(parsed.data.imageBase64),
        riskLevel: result.risk_level,
        confidence: result.confidence,
        indicatorsJson: JSON.stringify(result.indicators),
        explanationEn: result.explanation_en,
        explanationUr: result.explanation_ur,
        recommendedActionsJson: JSON.stringify(result.recommended_actions),
        humanReviewRequired: result.human_review_required,
        deterministicSignalsJson: JSON.stringify(result.deterministic_signals),
        region: parsed.data.region,
        aiModel: result.model,
      })
      .returning();

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'AI_SCAM_CHECK',
      resourceType: 'scam_checks',
      resourceId: String(saved.id),
      detail: `Classified as ${result.risk_level} (conf ${result.confidence.toFixed(2)}, humanReview=${result.human_review_required})`,
    });

    if (result.risk_level === 'high') {
      void dispatchOutboundWebhooks('HIGH_RISK_SCAM_DETECTED', {
        scamCheckId: saved.id,
        region: parsed.data.region,
        confidence: result.confidence,
        indicators: result.indicators.slice(0, 4),
      });
    }

    res.json({ result, recordId: saved.id });
  } catch (err: any) {
    console.error('AI scam check error:', err);
    res.status(502).json({
      error: err?.message || 'AI scam check service could not complete. Check GEMINI_API_KEY configuration.',
    });
  }
});

apiRouter.get('/ai/scam-history', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const auth = req.auth!;
    const rows =
      auth.role === 'admin' || auth.role === 'officer' || auth.role === 'auditor'
        ? await db.select().from(scamChecks).orderBy(desc(scamChecks.createdAt)).limit(50)
        : await db
            .select()
            .from(scamChecks)
            .where(eq(scamChecks.userId, auth.userId))
            .orderBy(desc(scamChecks.createdAt))
            .limit(20);

    // Aggregate regional patterns for Scam Map (non-PII aggregate)
    const allForMap = await db.select().from(scamChecks);
    const byRegion: Record<string, { region: string; high: number; medium: number; low: number; uncertain: number }> = {};
    for (const r of allForMap) {
      if (!byRegion[r.region]) {
        byRegion[r.region] = { region: r.region, high: 0, medium: 0, low: 0, uncertain: 0 };
      }
      if (r.riskLevel === 'high') byRegion[r.region].high++;
      else if (r.riskLevel === 'medium') byRegion[r.region].medium++;
      else if (r.riskLevel === 'low') byRegion[r.region].low++;
      else byRegion[r.region].uncertain++;
    }

    res.json({ history: rows, regionalMap: Object.values(byRegion) });
  } catch (err) {
    console.error('Scam history error:', err);
    res.status(500).json({ error: 'Failed to load scam history.' });
  }
});

apiRouter.post('/ai/assistant', requireAuth, rateLimit(25, 60_000), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    message: z.string().min(1).max(1500),
    lang: z.enum(['en', 'ur']).optional().default('ur'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please enter or speak a question.' });
    return;
  }

  try {
    const auth = req.auth!;
    const activeRule = await getActiveRule();
    const allApps = await db
      .select()
      .from(applications)
      .where(isNull(applications.deletedAt))
      .orderBy(desc(applications.createdAt));

    const authorizedCases = [];
    for (const app of allApps) {
      if (await canAccessApplication(auth, app)) {
        const decs = await db
          .select()
          .from(applicationDecisions)
          .where(eq(applicationDecisions.applicationId, app.id))
          .limit(1);
        authorizedCases.push({
          caseCode: app.caseCode,
          status: app.status,
          route: app.route,
          confidence: app.confidence,
          whyEn: decs[0]?.whyEn || '',
          whyUr: decs[0]?.whyUr || '',
        });
      }
      if (authorizedCases.length >= 6) break;
    }

    const aiRes = await askApplicationAssistant({
      message: parsed.data.message,
      lang: parsed.data.lang,
      userRole: auth.role,
      verifiedContext: {
        activeRule: {
          version: activeRule.version,
          maxIncome: activeRule.maxIncome,
          minAge: activeRule.minAge,
          autoThreshold: activeRule.autoThreshold,
        },
        authorizedCases,
      },
    });

    await recordAudit({
      actorUserId: auth.userId,
      actorRole: auth.role,
      actorLabel: auth.displayName,
      action: 'AI_ASSISTANT_QUERY',
      resourceType: 'ai_assistant',
      detail: `Intent: ${aiRes.detectedIntent}, grounded: ${aiRes.groundedInSystemRecords}`,
    });

    res.json(aiRes);
  } catch (err: any) {
    console.error('AI assistant error:', err);
    res.status(502).json({
      error: err?.message || 'AI assistant failed to respond.',
    });
  }
});

apiRouter.post('/ai/voice/transcribe', requireAuth, rateLimit(20, 60_000), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    audioBase64: z.string().min(10).max(8_000_000),
    mimeType: z.string().default('audio/webm'),
    langHint: z.enum(['ur', 'en']).optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Valid audio payload is required.' });
    return;
  }

  try {
    const result = await transcribeAudioWithAI(parsed.data);
    res.json(result);
  } catch (err: any) {
    console.error('Audio transcription error:', err);
    res.status(502).json({ error: err?.message || 'Speech transcription unavailable.' });
  }
});

apiRouter.post('/ai/voice/tts', requireAuth, rateLimit(30, 60_000), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    text: z.string().min(1).max(800),
    lang: z.enum(['ur', 'en']).optional().default('ur'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Text is required for speech generation.' });
    return;
  }

  try {
    const audio = await synthesizeSpeechWithAI(parsed.data);
    res.json(audio);
  } catch (err: any) {
    console.error('TTS error:', err);
    res.status(502).json({ error: err?.message || 'Voice synthesis failed.' });
  }
});

apiRouter.get('/ai/decision/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid application ID.' });
    return;
  }
  try {
    const apps = await db.select().from(applications).where(eq(applications.id, id));
    const app = apps[0];
    if (!app) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }
    if (!(await canAccessApplication(req.auth!, app))) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const decs = await db
      .select()
      .from(applicationDecisions)
      .where(eq(applicationDecisions.applicationId, id))
      .orderBy(desc(applicationDecisions.createdAt));

    const ruleRows = await db
      .select()
      .from(eligibilityRules)
      .where(eq(eligibilityRules.version, app.ruleVersion));

    const docs = await db
      .select()
      .from(applicationDocuments)
      .where(eq(applicationDocuments.applicationId, id));

    const history = await db
      .select()
      .from(applicationStatusHistory)
      .where(eq(applicationStatusHistory.applicationId, id))
      .orderBy(desc(applicationStatusHistory.createdAt));

    const agentRunRows = await db
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.applicationId, id))
      .orderBy(desc(agentRuns.createdAt))
      .limit(1);

    res.json({
      application: app,
      decision: decs[0] || null,
      ruleUsed: ruleRows[0] || null,
      documents: docs,
      history,
      agentRun: agentRunRows[0] || null,
    });
  } catch (err) {
    console.error('Decision room error:', err);
    res.status(500).json({ error: 'Failed to load decision room data.' });
  }
});

// ---------------------------------------------------------------------------
// Voice-to-Form, Autonomous Tool-Calling Agent, Policy RAG, QR Verification
// ---------------------------------------------------------------------------
apiRouter.post('/ai/voice/fill-form', requireAuth, requireRole('citizen', 'helper', 'admin'), rateLimit(20, 60_000), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    text: z.string().max(1500).optional(),
    audioBase64: z.string().max(8_000_000).optional(),
    mimeType: z.string().optional(),
    lang: z.enum(['en', 'ur']).optional().default('ur'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid voice form input.' });
    return;
  }
  if (!parsed.data.text?.trim() && !parsed.data.audioBase64) {
    res.status(400).json({ error: 'Please speak or provide a voice statement first.' });
    return;
  }

  try {
    const extracted = await extractFormFromSpeechWithAI({
      text: parsed.data.text,
      audioBase64: parsed.data.audioBase64,
      mimeType: parsed.data.mimeType || 'audio/webm',
      lang: parsed.data.lang,
    });

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'VOICE_FORM_AUTOFILL',
      resourceType: 'ai_voice_form',
      detail: `Extracted fields via ${extracted.model}; missing: ${extracted.missingFields.join(', ') || 'none'}`,
    });

    res.json(extracted);
  } catch (err: any) {
    console.error('Voice-to-form error:', err);
    res.status(502).json({ error: err?.message || 'Could not extract fields from voice.' });
  }
});

apiRouter.post('/ai/agent/triage/:id', requireAuth, rateLimit(15, 60_000), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid application ID.' });
    return;
  }

  try {
    const apps = await db.select().from(applications).where(eq(applications.id, id));
    const appRow = apps[0];
    if (!appRow || appRow.deletedAt) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }
    if (!(await canAccessApplication(req.auth!, appRow))) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const start = Date.now();
    const agentOut = await runTriageAgentWithAI({ application: appRow });
    const latencyMs = Math.max(10, Date.now() - start);

    const [savedRun] = await db
      .insert(agentRuns)
      .values({
        applicationId: appRow.id,
        userId: req.auth!.userId,
        goal: `Verify identity, duplicates, policy manual, and deterministic scoring for ${appRow.caseCode}`,
        stepsJson: JSON.stringify(agentOut.steps),
        finalDecision: `${agentOut.suggestedAction}: ${agentOut.finalRecommendationEn}`,
        toolsCalledCount: agentOut.steps.length,
        model: agentOut.model,
        latencyMs,
      })
      .returning();

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'AI_AGENT_TRIAGE_RUN',
      resourceType: 'agent_runs',
      resourceId: appRow.caseCode,
      detail: `Agent ran ${agentOut.steps.length} tools via ${agentOut.model}, suggested ${agentOut.suggestedAction}`,
    });

    res.json({
      run: savedRun,
      steps: agentOut.steps,
      finalRecommendationEn: agentOut.finalRecommendationEn,
      finalRecommendationUr: agentOut.finalRecommendationUr,
      suggestedAction: agentOut.suggestedAction,
      model: agentOut.model,
    });
  } catch (err: any) {
    console.error('Agent triage error:', err);
    res.status(502).json({ error: err?.message || 'Triage agent execution failed.' });
  }
});

apiRouter.get('/policy/docs', requireAuth, async (_req, res) => {
  try {
    const docs = await db
      .select({
        id: policyDocuments.id,
        code: policyDocuments.code,
        titleEn: policyDocuments.titleEn,
        titleUr: policyDocuments.titleUr,
        category: policyDocuments.category,
        contentEn: policyDocuments.contentEn,
        contentUr: policyDocuments.contentUr,
        version: policyDocuments.version,
        isActive: policyDocuments.isActive,
        hasEmbedding: sql<boolean>`(${policyDocuments.embeddingJson} IS NOT NULL)`,
        createdAt: policyDocuments.createdAt,
      })
      .from(policyDocuments)
      .where(eq(policyDocuments.isActive, true))
      .orderBy(policyDocuments.code);

    res.json({ docs });
  } catch (err) {
    console.error('Policy docs error:', err);
    res.status(500).json({ error: 'Failed to load policy handbook.' });
  }
});

apiRouter.post('/policy/docs', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    code: z.string().min(3).max(40),
    titleEn: z.string().min(3).max(180),
    titleUr: z.string().min(3).max(180),
    category: z.string().min(2).max(50).default('eligibility'),
    contentEn: z.string().min(10).max(2000),
    contentUr: z.string().min(5).max(2000),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid policy circular payload.' });
    return;
  }

  try {
    const cleanCode = parsed.data.code.trim().toUpperCase();
    const [doc] = await db
      .insert(policyDocuments)
      .values({
        code: cleanCode,
        titleEn: parsed.data.titleEn.trim(),
        titleUr: parsed.data.titleUr.trim(),
        category: parsed.data.category.trim(),
        contentEn: parsed.data.contentEn.trim(),
        contentUr: parsed.data.contentUr.trim(),
        embeddingJson: null,
        version: 1,
        isActive: true,
      })
      .onConflictDoUpdate({
        target: policyDocuments.code,
        set: {
          titleEn: parsed.data.titleEn.trim(),
          titleUr: parsed.data.titleUr.trim(),
          category: parsed.data.category.trim(),
          contentEn: parsed.data.contentEn.trim(),
          contentUr: parsed.data.contentUr.trim(),
          embeddingJson: null,
          isActive: true,
        },
      })
      .returning();

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'POLICY_DOC_PUBLISHED',
      resourceType: 'policy_documents',
      resourceId: cleanCode,
      detail: `Published handbook circular ${cleanCode}: ${doc.titleEn}`,
      severity: 'warning',
    });

    res.status(201).json({ doc });
  } catch (err) {
    console.error('Publish policy doc error:', err);
    res.status(500).json({ error: 'Failed to publish policy circular.' });
  }
});

apiRouter.post('/policy/ask', requireAuth, rateLimit(25, 60_000), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    question: z.string().min(2).max(1000),
    lang: z.enum(['en', 'ur']).optional().default('en'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Please enter a policy question.' });
    return;
  }

  try {
    const activeRule = await getActiveRule();
    const citations = await retrievePolicyCitations(parsed.data.question, 3);
    let replyText = '';
    let grounded = true;

    if (process.env.GEMINI_API_KEY) {
      try {
        const aiRes = await askApplicationAssistant({
          message: parsed.data.question,
          lang: parsed.data.lang,
          userRole: req.auth!.role,
          verifiedContext: {
            activeRule: {
              version: activeRule.version,
              maxIncome: activeRule.maxIncome,
              minAge: activeRule.minAge,
              autoThreshold: activeRule.autoThreshold,
            },
            authorizedCases: [],
          },
        });
        replyText = aiRes.reply;
        grounded = aiRes.groundedInSystemRecords;
      } catch {
        // Fallback to top retrieved circular
      }
    }

    if (!replyText && citations[0]) {
      replyText =
        parsed.data.lang === 'ur'
          ? `[${citations[0].code}] ${citations[0].titleUr}: ${citations[0].excerptUr}`
          : `[${citations[0].code}] ${citations[0].titleEn}: ${citations[0].excerptEn}`;
    }

    res.json({
      answer: replyText,
      citations,
      grounded,
    });
  } catch (err) {
    console.error('Policy RAG ask error:', err);
    res.status(500).json({ error: 'Failed to retrieve policy answer.' });
  }
});

apiRouter.get('/applications/:id/slip-qr', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid application ID.' });
    return;
  }

  try {
    const rows = await db.select().from(applications).where(eq(applications.id, id));
    const appRow = rows[0];
    if (!appRow || appRow.deletedAt) {
      res.status(404).json({ error: 'Application not found.' });
      return;
    }
    if (!(await canAccessApplication(req.auth!, appRow))) {
      res.status(403).json({ error: 'Forbidden.' });
      return;
    }

    const payload = {
      caseCode: appRow.caseCode,
      citizenId: appRow.citizenId,
      status: appRow.status,
      ruleVersion: appRow.ruleVersion,
      issuedAt: new Date().toISOString(),
    };
    const qrToken = signQrSlipPayload(payload);

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'QR_SLIP_GENERATED',
      resourceType: 'applications',
      resourceId: appRow.caseCode,
      detail: `Generated HMAC-SHA256 signed QR verification slip for ${appRow.caseCode}`,
    });

    res.json({
      qrToken,
      payload,
      caseCode: appRow.caseCode,
      applicantName: appRow.applicantName,
      status: appRow.status,
      district: appRow.district,
    });
  } catch (err) {
    console.error('QR slip generation error:', err);
    res.status(500).json({ error: 'Failed to generate signed QR slip.' });
  }
});

apiRouter.post('/applications/verify-qr', requireAuth, rateLimit(30, 60_000), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    qrToken: z.string().min(5).max(1500),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid QR token payload.' });
    return;
  }

  try {
    const check = verifyQrSlipPayload(parsed.data.qrToken);
    if (!check.valid || !check.payload) {
      await recordAudit({
        actorUserId: req.auth!.userId,
        actorRole: req.auth!.role,
        actorLabel: req.auth!.displayName,
        action: 'QR_SLIP_INVALID',
        resourceType: 'qr_verification',
        detail: check.reason || 'Invalid or tampered QR token scanned',
        severity: 'warning',
      });
      res.json({
        verified: false,
        signatureValid: false,
        reason: check.reason || 'Signature verification failed.',
        liveApplication: null,
      });
      return;
    }

    const rows = await db
      .select()
      .from(applications)
      .where(and(eq(applications.caseCode, check.payload.caseCode), isNull(applications.deletedAt)));
    const liveApp = rows[0];

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'QR_SLIP_VERIFIED',
      resourceType: 'applications',
      resourceId: check.payload.caseCode,
      detail: liveApp
        ? `Authentic slip verified against live DB (${liveApp.status})`
        : 'Authentic signature but case record no longer active in DB',
    });

    res.json({
      verified: Boolean(liveApp),
      signatureValid: true,
      payload: check.payload,
      statusChangedSinceIssue: liveApp ? liveApp.status !== check.payload.status : false,
      liveApplication: liveApp
        ? {
            id: liveApp.id,
            caseCode: liveApp.caseCode,
            applicantName: liveApp.applicantName,
            cnicMasked: liveApp.cnicMasked,
            status: liveApp.status,
            route: liveApp.route,
            confidence: liveApp.confidence,
            ruleVersion: liveApp.ruleVersion,
            district: liveApp.district,
            updatedAt: liveApp.updatedAt,
          }
        : null,
      reason: liveApp ? undefined : 'Signature authentic, but case record was not found in active database.',
    });
  } catch (err) {
    console.error('QR verify error:', err);
    res.status(500).json({ error: 'Failed to verify QR slip.' });
  }
});

// ---------------------------------------------------------------------------
// Administrator Portal (Analytics, Versioned Rules, Digital Twin, Users, API Keys, Mock Services)
// ---------------------------------------------------------------------------
apiRouter.get('/admin/analytics', requireAuth, requireRole('admin', 'officer', 'auditor'), async (_req, res) => {
  try {
    const allApps = await db.select().from(applications).where(isNull(applications.deletedAt));
    const submitted = allApps.filter((a) => !a.isDraft);
    const allScams = await db.select().from(scamChecks);
    const rules = await db.select().from(eligibilityRules).orderBy(desc(eligibilityRules.version));
    const serviceLogs = await db
      .select()
      .from(mockServiceLogs)
      .orderBy(desc(mockServiceLogs.createdAt))
      .limit(20);

    const statusCounts: Record<string, number> = {};
    const routeCounts: Record<string, number> = { auto: 0, docs: 0, human: 0 };
    const districtCounts: Record<string, number> = {};

    for (const a of submitted) {
      statusCounts[a.status] = (statusCounts[a.status] || 0) + 1;
      routeCounts[a.route] = (routeCounts[a.route] || 0) + 1;
      districtCounts[a.district] = (districtCounts[a.district] || 0) + 1;
    }

    const scamCounts: Record<string, number> = { high: 0, medium: 0, low: 0, uncertain: 0 };
    for (const s of allScams) {
      scamCounts[s.riskLevel] = (scamCounts[s.riskLevel] || 0) + 1;
    }

    const humanEscalationRate =
      submitted.length > 0
        ? Number((((routeCounts.human + routeCounts.docs) / submitted.length) * 100).toFixed(1))
        : 0;

    res.json({
      totals: {
        applications: submitted.length,
        drafts: allApps.length - submitted.length,
        scamChecks: allScams.length,
        ruleVersions: rules.length,
        humanEscalationRate,
      },
      statusDistribution: Object.entries(statusCounts).map(([name, value]) => ({ name, value })),
      routeDistribution: Object.entries(routeCounts).map(([name, value]) => ({ name, value })),
      districtDistribution: Object.entries(districtCounts).map(([name, value]) => ({ name, value })),
      scamDistribution: Object.entries(scamCounts).map(([name, value]) => ({ name, value })),
      recentServiceLogs: serviceLogs,
      activeRule: rules.find((r) => r.isActive) || rules[0] || null,
    });
  } catch (err) {
    console.error('Admin analytics error:', err);
    res.status(500).json({ error: 'Failed to compute analytics.' });
  }
});

apiRouter.get('/admin/rules', requireAuth, requireRole('admin', 'officer', 'auditor'), async (_req, res) => {
  try {
    const versions = await db.select().from(eligibilityRules).orderBy(desc(eligibilityRules.version));
    const simulations = await db
      .select()
      .from(ruleSimulations)
      .orderBy(desc(ruleSimulations.createdAt))
      .limit(10);
    res.json({ versions, simulations });
  } catch (err) {
    console.error('Rules list error:', err);
    res.status(500).json({ error: 'Failed to load eligibility rules.' });
  }
});

const ruleSchema = z.object({
  name: z.string().min(2).max(120).optional().default('Updated Relief Policy'),
  maxIncome: z.number().int().min(1000).max(500000),
  minAge: z.number().int().min(14).max(90),
  costWrong: z.number().min(1).max(1000),
  costSlow: z.number().min(0.1).max(1000),
  askBelow: z.number().min(0.1).max(0.95),
  changeSummary: z.string().min(3).max(300).optional().default('Policy threshold updated by administrator'),
});

apiRouter.post('/admin/rules', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid rule values.' });
    return;
  }

  try {
    const current = await getActiveRule();
    const nextVersion = (current?.version || 0) + 1;
    const autoThreshold = computeAutoThreshold(parsed.data);

    if (parsed.data.askBelow >= autoThreshold) {
      res.status(400).json({
        error: `Human-review floor (${parsed.data.askBelow}) must be strictly lower than auto-approval threshold (${autoThreshold.toFixed(3)}).`,
      });
      return;
    }

    const created = await db.transaction(async (tx) => {
      await tx.update(eligibilityRules).set({ isActive: false });
      const [inserted] = await tx
        .insert(eligibilityRules)
        .values({
          version: nextVersion,
          name: parsed.data.name,
          maxIncome: parsed.data.maxIncome,
          minAge: parsed.data.minAge,
          costWrong: parsed.data.costWrong,
          costSlow: parsed.data.costSlow,
          askBelow: parsed.data.askBelow,
          autoThreshold,
          isActive: true,
          createdByUserId: req.auth!.userId,
          changeSummary: parsed.data.changeSummary,
        })
        .returning();
      return inserted;
    });

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: `PUBLISH_RULE_V${created.version}`,
      resourceType: 'eligibility_rules',
      resourceId: `v${created.version}`,
      detail: `maxIncome=${created.maxIncome}, minAge=${created.minAge}, costWrong=${created.costWrong}, costSlow=${created.costSlow}, autoThreshold=${created.autoThreshold.toFixed(3)}`,
      severity: 'warning',
    });

    res.status(201).json({ rule: created });
  } catch (err) {
    console.error('Publish rule error:', err);
    res.status(500).json({ error: 'Failed to publish rule version.' });
  }
});

apiRouter.post('/admin/rules/simulate', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  const parsed = ruleSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid simulation parameters.' });
    return;
  }

  try {
    const activeRule = await getActiveRule();
    const draftRule = {
      version: activeRule.version + 1,
      maxIncome: parsed.data.maxIncome,
      minAge: parsed.data.minAge,
      costWrong: parsed.data.costWrong,
      costSlow: parsed.data.costSlow,
      askBelow: parsed.data.askBelow,
    };

    const allApps = await db.select().from(applications).where(isNull(applications.deletedAt));
    const submitted = allApps.filter((a) => !a.isDraft);
    const registry = await db.select().from(mockRegistryRecords);

    const diffs: Array<{
      caseCode: string;
      applicantName: string;
      oldRoute: string;
      newRoute: string;
      oldConfidence: number;
      newConfidence: number;
    }> = [];

    for (const a of submitted) {
      const sim = evaluateEligibility(
        {
          name: a.applicantName,
          cnicHash: a.cnicHash,
          cnicMasked: a.cnicMasked,
          age: a.age,
          monthlyIncome: a.monthlyIncome,
        },
        draftRule,
        registry
      );
      if (sim.route !== a.route) {
        diffs.push({
          caseCode: a.caseCode,
          applicantName: a.applicantName,
          oldRoute: a.route,
          newRoute: sim.route,
          oldConfidence: a.confidence,
          newConfidence: sim.confidence,
        });
      }
    }

    await db.insert(ruleSimulations).values({
      adminUserId: req.auth!.userId,
      baseVersion: activeRule.version,
      draftRuleJson: JSON.stringify(draftRule),
      totalCases: submitted.length,
      changedCount: diffs.length,
      diffJson: JSON.stringify(diffs),
    });

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'RULE_SIMULATION_RUN',
      resourceType: 'rule_simulations',
      detail: `Replayed ${submitted.length} historical cases against draft policy: ${diffs.length} routing outcomes would change`,
    });

    res.json({
      totalCases: submitted.length,
      changedCount: diffs.length,
      autoThreshold: computeAutoThreshold(draftRule),
      diffs,
    });
  } catch (err) {
    console.error('Rule simulation error:', err);
    res.status(500).json({ error: 'Simulation failed.' });
  }
});

apiRouter.get('/admin/users', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const allUsers = await db.select().from(users).orderBy(desc(users.createdAt));
    const allRoles = await db.select().from(userRoles);
    const roleMap = new Map(allRoles.map((r) => [r.userId, r.role]));

    res.json({
      users: allUsers.map((u) => ({
        id: u.id,
        email: u.email,
        displayName: u.displayName,
        role: roleMap.get(u.id) || 'citizen',
        isDemoAccount: u.isDemoAccount,
        createdAt: u.createdAt,
      })),
    });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

apiRouter.patch('/admin/users/:id/role', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  const targetUserId = Number(req.params.id);
  const schema = z.object({ role: z.enum(['citizen', 'helper', 'officer', 'admin', 'auditor']) });
  const parsed = schema.safeParse(req.body);
  if (!Number.isInteger(targetUserId) || !parsed.success) {
    res.status(400).json({ error: 'Invalid user ID or role.' });
    return;
  }

  try {
    const existing = await db.select().from(userRoles).where(eq(userRoles.userId, targetUserId));
    if (existing[0]) {
      await db
        .update(userRoles)
        .set({ role: parsed.data.role, assignedByUserId: req.auth!.userId })
        .where(eq(userRoles.userId, targetUserId));
    } else {
      await db.insert(userRoles).values({
        userId: targetUserId,
        role: parsed.data.role,
        assignedByUserId: req.auth!.userId,
      });
    }

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'USER_ROLE_CHANGED',
      resourceType: 'user_roles',
      resourceId: String(targetUserId),
      detail: `Assigned role ${parsed.data.role} to user #${targetUserId}`,
      severity: 'warning',
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Update role error:', err);
    res.status(500).json({ error: 'Failed to update role.' });
  }
});

apiRouter.get('/admin/api-keys', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const keys = await db.select().from(apiKeys).orderBy(desc(apiKeys.createdAt));
    res.json({
      apiKeys: keys.map((k) => ({
        id: k.id,
        name: k.name,
        keyPrefix: k.keyPrefix,
        role: k.role,
        lastUsedAt: k.lastUsedAt,
        revokedAt: k.revokedAt,
        createdAt: k.createdAt,
      })),
    });
  } catch (err) {
    console.error('List API keys error:', err);
    res.status(500).json({ error: 'Failed to list API keys.' });
  }
});

apiRouter.post('/admin/api-keys', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    name: z.string().min(2).max(80),
    role: z.enum(['citizen', 'helper', 'officer', 'auditor']).default('auditor'),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid API key parameters.' });
    return;
  }

  try {
    const generated = generateApiKey();
    const [created] = await db
      .insert(apiKeys)
      .values({
        name: parsed.data.name.trim(),
        keyPrefix: generated.prefix,
        keyHash: generated.hash,
        role: parsed.data.role,
        createdByUserId: req.auth!.userId,
      })
      .returning();

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'API_KEY_CREATED',
      resourceType: 'api_keys',
      resourceId: String(created.id),
      detail: `Issued ${parsed.data.role} API key (${generated.prefix}...)`,
      severity: 'warning',
    });

    res.status(201).json({
      rawKey: generated.rawKey,
      apiKey: {
        id: created.id,
        name: created.name,
        keyPrefix: created.keyPrefix,
        role: created.role,
        createdAt: created.createdAt,
      },
    });
  } catch (err) {
    console.error('Create API key error:', err);
    res.status(500).json({ error: 'Failed to create API key.' });
  }
});

apiRouter.delete('/admin/api-keys/:id', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid key ID.' });
    return;
  }
  try {
    await db.update(apiKeys).set({ revokedAt: new Date() }).where(eq(apiKeys.id, id));
    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'API_KEY_REVOKED',
      resourceType: 'api_keys',
      resourceId: String(id),
      detail: `Revoked API key #${id}`,
      severity: 'warning',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Revoke key error:', err);
    res.status(500).json({ error: 'Failed to revoke key.' });
  }
});

apiRouter.post('/admin/demo-reset', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  try {
    await resetDemoData();
    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'DEMO_DATA_RESET',
      resourceType: 'system',
      detail: 'Administrator reset synthetic demonstration records',
      severity: 'warning',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Demo reset error:', err);
    res.status(500).json({ error: 'Failed to reset demo data.' });
  }
});

apiRouter.get('/mock/identity', requireAuth, requireRole('admin', 'officer', 'auditor'), async (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    if (q) {
      const lookup = await mockIdentityLookup(q.includes('-') ? hashCnic(q) : '', q);
      res.json(lookup);
      return;
    }
    const records = await db.select().from(mockRegistryRecords);
    res.json({
      adapter: 'MOCK_NADRA_ADAPTER (Synthetic Demonstration Data Only)',
      officialIntegration: false,
      records,
    });
  } catch (err) {
    console.error('Mock identity error:', err);
    res.status(500).json({ error: 'Mock identity lookup failed.' });
  }
});

// ---------------------------------------------------------------------------
// AI Evaluation, Override Calibration, Anomaly Detection & Outbound Webhooks
// ---------------------------------------------------------------------------
apiRouter.get('/admin/evaluation', requireAuth, requireRole('admin', 'officer', 'auditor'), async (_req, res) => {
  try {
    const telemetry = await db.select().from(aiTelemetry).orderBy(desc(aiTelemetry.createdAt)).limit(200);
    const decisions = await db.select().from(applicationDecisions).orderBy(desc(applicationDecisions.createdAt));
    const allApps = await db.select().from(applications).where(isNull(applications.deletedAt));
    const submittedApps = allApps.filter((a) => !a.isDraft);
    const registry = await db.select().from(mockRegistryRecords);
    const scams = await db.select().from(scamChecks);
    const runs = await db.select().from(agentRuns).orderBy(desc(agentRuns.createdAt)).limit(10);

    const totalCalls = telemetry.length;
    const successCount = telemetry.filter((t) => t.success).length;
    const fallbackCount = telemetry.filter((t) => t.usedFallback).length;
    const totalCostUsd = telemetry.reduce((acc, t) => acc + (t.costUsdEst || 0), 0);
    const latencies = telemetry.map((t) => t.latencyMs).sort((a, b) => a - b);
    const avgLatencyMs = totalCalls ? Math.round(latencies.reduce((a, b) => a + b, 0) / totalCalls) : 0;
    const p95LatencyMs = totalCalls ? latencies[Math.min(latencies.length - 1, Math.floor(totalCalls * 0.95))] : 0;

    const endpointMap = new Map<
      string,
      { endpoint: string; calls: number; totalMs: number; fallbacks: number; costUsd: number }
    >();
    for (const t of telemetry) {
      const cur = endpointMap.get(t.endpoint) || {
        endpoint: t.endpoint,
        calls: 0,
        totalMs: 0,
        fallbacks: 0,
        costUsd: 0,
      };
      cur.calls += 1;
      cur.totalMs += t.latencyMs;
      if (t.usedFallback) cur.fallbacks += 1;
      cur.costUsd += t.costUsdEst || 0;
      endpointMap.set(t.endpoint, cur);
    }

    const byEndpoint = Array.from(endpointMap.values()).map((e) => ({
      endpoint: e.endpoint,
      calls: e.calls,
      avgLatencyMs: Math.round(e.totalMs / e.calls),
      fallbackCount: e.fallbacks,
      costUsd: Number(e.costUsd.toFixed(5)),
    }));

    const humanReviewed = decisions.filter((d) => Boolean(d.humanDecision));
    let agreedCount = 0;
    let overriddenCount = 0;
    for (const d of humanReviewed) {
      const aiApproved = d.route === 'auto';
      const humanApproved = d.humanDecision === 'approved_by_officer';
      if (aiApproved === humanApproved) agreedCount++;
      else overriddenCount++;
    }

    // Cross-claim anomalies (duplicate CNIC, shared phone across multiple names, income variance vs mock registry)
    const cnicGroups = new Map<string, typeof submittedApps>();
    const phoneGroups = new Map<string, typeof submittedApps>();
    for (const a of submittedApps) {
      if (a.cnicHash) {
        const list = cnicGroups.get(a.cnicHash) || [];
        list.push(a);
        cnicGroups.set(a.cnicHash, list);
      }
      const cleanPhone = a.contactPhone.replace(/[^0-9]/g, '');
      if (cleanPhone.length >= 7) {
        const list = phoneGroups.get(cleanPhone) || [];
        list.push(a);
        phoneGroups.set(cleanPhone, list);
      }
    }

    const anomalies: Array<{
      type: string;
      severity: 'high' | 'medium';
      summary: string;
      caseCodes: string[];
    }> = [];

    for (const [, list] of cnicGroups) {
      if (list.length > 1) {
        anomalies.push({
          type: 'Duplicate CNIC Claim',
          severity: 'high',
          summary: `${list.length} active submissions share masked CNIC ${list[0].cnicMasked}.`,
          caseCodes: list.map((x) => x.caseCode),
        });
      }
    }

    for (const [phone, list] of phoneGroups) {
      const uniqueNames = new Set(list.map((x) => x.applicantName.trim().toLowerCase()));
      if (uniqueNames.size > 1) {
        anomalies.push({
          type: 'Shared Phone Across Distinct Applicants',
          severity: 'medium',
          summary: `Phone ending ${phone.slice(-4)} appears on ${uniqueNames.size} distinct applicant names.`,
          caseCodes: list.map((x) => x.caseCode),
        });
      }
    }

    for (const a of submittedApps) {
      if (a.cnicHash && a.monthlyIncome !== null) {
        const reg = registry.find((r) => r.cnicHash === a.cnicHash);
        if (reg && Math.abs(reg.monthlyIncome - a.monthlyIncome) > reg.monthlyIncome * 0.6) {
          anomalies.push({
            type: 'Declared vs Registry Income Variance',
            severity: 'high',
            summary: `${a.caseCode} declared Rs ${a.monthlyIncome.toLocaleString()} vs mock registry Rs ${reg.monthlyIncome.toLocaleString()}.`,
            caseCodes: [a.caseCode],
          });
        }
      }
    }

    res.json({
      telemetrySummary: {
        totalCalls,
        successCount,
        successRate: totalCalls ? Number(((successCount / totalCalls) * 100).toFixed(1)) : 100,
        avgLatencyMs,
        p95LatencyMs,
        fallbackRate: totalCalls ? Number(((fallbackCount / totalCalls) * 100).toFixed(1)) : 0,
        totalCostUsd: Number(totalCostUsd.toFixed(5)),
      },
      byEndpoint,
      recentTelemetry: telemetry.slice(0, 20),
      overrideMetrics: {
        totalDecisions: decisions.length,
        reviewedCount: humanReviewed.length,
        agreedCount,
        overriddenCount,
        overrideRate: humanReviewed.length
          ? Number(((overriddenCount / humanReviewed.length) * 100).toFixed(1))
          : 0,
      },
      scamMetrics: {
        total: scams.length,
        highRisk: scams.filter((s) => s.riskLevel === 'high').length,
        humanEscalated: scams.filter((s) => s.humanReviewRequired).length,
      },
      anomalies,
      recentAgentRuns: runs,
    });
  } catch (err) {
    console.error('Admin evaluation error:', err);
    res.status(500).json({ error: 'Failed to load AI evaluation metrics.' });
  }
});

apiRouter.get('/admin/webhooks', requireAuth, requireRole('admin'), async (_req, res) => {
  try {
    const hooks = await db
      .select({
        id: webhooks.id,
        name: webhooks.name,
        targetUrl: webhooks.targetUrl,
        eventsJson: webhooks.eventsJson,
        secretMasked: webhooks.secretMasked,
        isActive: webhooks.isActive,
        createdAt: webhooks.createdAt,
      })
      .from(webhooks)
      .orderBy(desc(webhooks.createdAt));

    const deliveries = await db
      .select()
      .from(webhookDeliveries)
      .orderBy(desc(webhookDeliveries.createdAt))
      .limit(25);

    res.json({
      webhooks: hooks,
      deliveries,
      gateways: getGatewayCapabilities(),
    });
  } catch (err) {
    console.error('Admin webhooks error:', err);
    res.status(500).json({ error: 'Failed to load outbound webhooks.' });
  }
});

apiRouter.post('/admin/webhooks', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    name: z.string().min(2).max(100),
    targetUrl: z.string().min(5).max(300),
    events: z.array(z.string()).min(1),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message || 'Invalid webhook payload.' });
    return;
  }

  const check = isAllowedWebhookUrl(parsed.data.targetUrl.trim());
  if (!check.ok) {
    res.status(400).json({ error: check.reason || 'Webhook target URL rejected by SSRF filter.' });
    return;
  }

  try {
    const rawSecret = `whsec_${crypto.randomBytes(16).toString('hex')}`;
    const masked = `whsec_****${rawSecret.slice(-4)}`;
    const [created] = await db
      .insert(webhooks)
      .values({
        name: parsed.data.name.trim(),
        targetUrl: parsed.data.targetUrl.trim(),
        eventsJson: JSON.stringify(parsed.data.events),
        secretMasked: masked,
        secretEncrypted: encryptSensitive(rawSecret),
        isActive: true,
        createdByUserId: req.auth!.userId,
      })
      .returning();

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'WEBHOOK_CREATED',
      resourceType: 'webhooks',
      resourceId: String(created.id),
      detail: `Registered outbound webhook "${created.name}" (${created.targetUrl})`,
      severity: 'warning',
    });

    res.status(201).json({
      webhook: {
        id: created.id,
        name: created.name,
        targetUrl: created.targetUrl,
        eventsJson: created.eventsJson,
        secretMasked: created.secretMasked,
        isActive: created.isActive,
        createdAt: created.createdAt,
      },
      rawSecret,
    });
  } catch (err) {
    console.error('Create webhook error:', err);
    res.status(500).json({ error: 'Failed to create outbound webhook.' });
  }
});

apiRouter.delete('/admin/webhooks/:id', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid webhook ID.' });
    return;
  }
  try {
    await db.delete(webhooks).where(eq(webhooks.id, id));
    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'WEBHOOK_DELETED',
      resourceType: 'webhooks',
      resourceId: String(id),
      detail: `Removed outbound webhook #${id}`,
      severity: 'warning',
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete webhook error:', err);
    res.status(500).json({ error: 'Failed to delete webhook.' });
  }
});

apiRouter.post('/admin/webhooks/:id/test', requireAuth, requireRole('admin'), async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid webhook ID.' });
    return;
  }
  try {
    const rows = await db.select().from(webhooks).where(eq(webhooks.id, id));
    const hook = rows[0];
    if (!hook) {
      res.status(404).json({ error: 'Webhook not found.' });
      return;
    }

    const delivery = await dispatchSingleWebhook(hook, 'WEBHOOK_TEST', {
      test: true,
      webhookName: hook.name,
      triggeredBy: req.auth!.displayName,
    });

    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'WEBHOOK_TEST_SENT',
      resourceType: 'webhooks',
      resourceId: String(hook.id),
      detail: `Test delivery ${delivery.success ? 'succeeded' : 'failed'} (${delivery.responseStatus})`,
    });

    res.json({ delivery });
  } catch (err) {
    console.error('Test webhook error:', err);
    res.status(500).json({ error: 'Failed to send test webhook.' });
  }
});

// ---------------------------------------------------------------------------
// Independent Auditor Portal (Strictly Read-Only)
// ---------------------------------------------------------------------------
apiRouter.get('/audit', requireAuth, requireRole('auditor', 'admin'), async (req, res) => {
  try {
    const severity = String(req.query.severity || 'all');
    const logs = await db
      .select()
      .from(auditLogs)
      .orderBy(desc(auditLogs.createdAt))
      .limit(150);
    const filtered = severity === 'all' ? logs : logs.filter((l) => l.severity === severity);

    const consentEvents = await db
      .select()
      .from(consentHistory)
      .orderBy(desc(consentHistory.createdAt))
      .limit(50);

    const decisions = await db
      .select()
      .from(applicationDecisions)
      .orderBy(desc(applicationDecisions.createdAt))
      .limit(50);

    res.json({
      logs: filtered,
      consentEvents,
      decisions,
    });
  } catch (err) {
    console.error('Audit fetch error:', err);
    res.status(500).json({ error: 'Failed to load audit records.' });
  }
});

apiRouter.get('/audit/export', requireAuth, requireRole('auditor', 'admin'), async (req: AuthenticatedRequest, res) => {
  try {
    const logs = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(500);
    await recordAudit({
      actorUserId: req.auth!.userId,
      actorRole: req.auth!.role,
      actorLabel: req.auth!.displayName,
      action: 'AUDIT_EXPORT_CSV',
      resourceType: 'audit_logs',
      detail: `Exported ${logs.length} audit events`,
    });

    const header = 'id,timestamp,actor_role,actor_label,action,resource_type,resource_id,severity,detail';
    const escapeCsv = (val: unknown) => `"${String(val ?? '').replace(/"/g, '""')}"`;
    const lines = logs.map((l) =>
      [
        l.id,
        l.createdAt.toISOString(),
        l.actorRole,
        l.actorLabel,
        l.action,
        l.resourceType,
        l.resourceId,
        l.severity,
        l.detail,
      ]
        .map(escapeCsv)
        .join(',')
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="madad-desk-audit-report.csv"');
    res.send([header, ...lines].join('\n'));
  } catch (err) {
    console.error('Audit export error:', err);
    res.status(500).json({ error: 'Failed to export audit report.' });
  }
});

// ---------------------------------------------------------------------------
// Notifications & Preferences
// ---------------------------------------------------------------------------
apiRouter.get('/notifications', requireAuth, async (req: AuthenticatedRequest, res) => {
  try {
    const rows = await db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, req.auth!.userId))
      .orderBy(desc(notifications.createdAt))
      .limit(40);
    const prefsRows = await db
      .select()
      .from(notificationPreferences)
      .where(eq(notificationPreferences.userId, req.auth!.userId));

    res.json({
      notifications: rows,
      preferences: prefsRows[0] || { inApp: true, smsMock: true, emailMock: false },
    });
  } catch (err) {
    console.error('Notifications error:', err);
    res.status(500).json({ error: 'Failed to load notifications.' });
  }
});

apiRouter.post('/notifications/:id/read', requireAuth, async (req: AuthenticatedRequest, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: 'Invalid notification ID.' });
    return;
  }
  try {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(and(eq(notifications.id, id), eq(notifications.userId, req.auth!.userId)));
    res.json({ ok: true });
  } catch (err) {
    console.error('Notification mark read error:', err);
    res.status(500).json({ error: 'Failed to mark notification read.' });
  }
});

apiRouter.patch('/notifications/preferences', requireAuth, async (req: AuthenticatedRequest, res) => {
  const schema = z.object({
    inApp: z.boolean(),
    smsMock: z.boolean(),
    emailMock: z.boolean(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: 'Invalid notification preferences.' });
    return;
  }

  try {
    await db
      .insert(notificationPreferences)
      .values({
        userId: req.auth!.userId,
        ...parsed.data,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: notificationPreferences.userId,
        set: { ...parsed.data, updatedAt: new Date() },
      });
    res.json({ ok: true, preferences: parsed.data });
  } catch (err) {
    console.error('Update notification preferences error:', err);
    res.status(500).json({ error: 'Failed to save preferences.' });
  }
});

// Error handler for multer / unexpected middleware errors
apiRouter.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof multer.MulterError) {
    res.status(400).json({ error: `File upload error: ${err.message}` });
    return;
  }
  if (err) {
    res.status(400).json({ error: err.message || 'Request failed.' });
    return;
  }
});
