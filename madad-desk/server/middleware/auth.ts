import type { NextFunction, Request, Response } from 'express';
import { eq } from 'drizzle-orm';
import { adminAuth } from '../../src/lib/firebase-admin.ts';
import { hashApiKey, verifySessionToken } from '../../src/lib/crypto.ts';
import { db } from '../../src/db/index.ts';
import { apiKeys, auditLogs, notificationPreferences, userRoles, users } from '../../src/db/schema.ts';

export type AppRole = 'citizen' | 'helper' | 'officer' | 'admin' | 'auditor';

export interface AuthContext {
  userId: number;
  uid: string;
  email: string;
  displayName: string;
  role: AppRole;
  preferredLang: string;
  authMethod: 'firebase' | 'session' | 'api_key';
}

export interface AuthenticatedRequest extends Request {
  auth?: AuthContext;
}

const OWNER_ADMIN_EMAIL = 'rahiasarfraz@gmail.com';

export async function recordAudit(params: {
  actorUserId?: number | null;
  actorRole: string;
  actorLabel: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  detail: string;
  severity?: 'info' | 'warning' | 'security';
}): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorUserId: params.actorUserId ?? null,
      actorRole: params.actorRole,
      actorLabel: params.actorLabel,
      action: params.action,
      resourceType: params.resourceType,
      resourceId: params.resourceId ?? '',
      detail: params.detail,
      severity: params.severity ?? 'info',
    });
  } catch (err) {
    console.error('Audit log insert failed:', err);
  }
}

export async function resolveUserWithRole(
  uid: string,
  email: string,
  displayName: string
): Promise<AuthContext> {
  const existing = await db.select().from(users).where(eq(users.uid, uid));
  let userRow = existing[0];

  if (!userRow) {
    // Also check by email in case user signed in via another method
    const byEmail = await db.select().from(users).where(eq(users.email, email));
    if (byEmail[0]) {
      userRow = byEmail[0];
    } else {
      const inserted = await db
        .insert(users)
        .values({
          uid,
          email,
          displayName: displayName || email.split('@')[0],
          preferredLang: 'ur',
          isDemoAccount: false,
        })
        .onConflictDoUpdate({
          target: users.uid,
          set: { email, displayName: displayName || email.split('@')[0], updatedAt: new Date() },
        })
        .returning();
      userRow = inserted[0];

      const defaultRole: AppRole =
        email.toLowerCase() === OWNER_ADMIN_EMAIL ? 'admin' : 'citizen';

      await db.insert(userRoles).values({
        userId: userRow.id,
        role: defaultRole,
        tenantId: 'relief-dept-pk',
      });
      await db
        .insert(notificationPreferences)
        .values({ userId: userRow.id, inApp: true, smsMock: true, emailMock: false })
        .onConflictDoNothing();
    }
  }

  const roles = await db.select().from(userRoles).where(eq(userRoles.userId, userRow.id));
  const role = (roles[0]?.role as AppRole) || 'citizen';

  return {
    userId: userRow.id,
    uid: userRow.uid,
    email: userRow.email,
    displayName: userRow.displayName,
    role,
    preferredLang: userRow.preferredLang,
    authMethod: 'firebase',
  };
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers.authorization;
  const apiKeyHeader = req.headers['x-api-key'];

  // 1. API Key authentication (for Public REST API / Swagger / curl tests)
  if (typeof apiKeyHeader === 'string' && apiKeyHeader.trim().length > 0) {
    try {
      const hashed = hashApiKey(apiKeyHeader.trim());
      const rows = await db.select().from(apiKeys).where(eq(apiKeys.keyHash, hashed));
      const keyRow = rows[0];
      if (!keyRow || keyRow.revokedAt) {
        await recordAudit({
          actorRole: 'anonymous',
          actorLabel: 'API Key Client',
          action: 'DENIED_INVALID_API_KEY',
          resourceType: 'auth',
          detail: `Rejected invalid or revoked API key on ${req.method} ${req.path}`,
          severity: 'security',
        });
        res.status(401).json({ error: 'Invalid or revoked API key.' });
        return;
      }

      const ownerRows = await db.select().from(users).where(eq(users.id, keyRow.createdByUserId));
      const owner = ownerRows[0];
      await db
        .update(apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(apiKeys.id, keyRow.id));

      req.auth = {
        userId: owner?.id ?? keyRow.createdByUserId,
        uid: owner?.uid ?? `apikey-${keyRow.id}`,
        email: owner?.email ?? 'api-client@madaddesk.pk',
        displayName: `API Key (${keyRow.name})`,
        role: keyRow.role as AppRole,
        preferredLang: 'en',
        authMethod: 'api_key',
      };
      next();
      return;
    } catch (err) {
      console.error('API key verification failed:', err);
      res.status(500).json({ error: 'Authentication verification failed.' });
      return;
    }
  }

  // 2. Bearer token authentication (custom signed session token OR Firebase ID token)
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Missing Bearer token or x-api-key.' });
    return;
  }

  const token = authHeader.slice('Bearer '.length).trim();

  if (token.startsWith('md_')) {
    const payload = verifySessionToken(token);
    if (!payload) {
      res.status(401).json({ error: 'Session expired or invalid token.' });
      return;
    }
    try {
      const userRows = await db.select().from(users).where(eq(users.id, payload.userId));
      const userRow = userRows[0];
      if (!userRow) {
        res.status(401).json({ error: 'User account not found.' });
        return;
      }
      const roles = await db.select().from(userRoles).where(eq(userRoles.userId, userRow.id));
      const role = (roles[0]?.role as AppRole) || 'citizen';

      req.auth = {
        userId: userRow.id,
        uid: userRow.uid,
        email: userRow.email,
        displayName: userRow.displayName,
        role,
        preferredLang: userRow.preferredLang,
        authMethod: 'session',
      };
      next();
      return;
    } catch (err) {
      console.error('Session verification error:', err);
      res.status(500).json({ error: 'Failed to validate session.' });
      return;
    }
  }

  // 3. Firebase ID token verification
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    const email = decoded.email || `${decoded.uid}@firebase.local`;
    const displayName = decoded.name || email.split('@')[0];
    req.auth = await resolveUserWithRole(decoded.uid, email, displayName);
    next();
  } catch (err) {
    console.error('Firebase token verification error:', err);
    res.status(401).json({ error: 'Unauthorized: Invalid authentication token.' });
  }
}

export function requireRole(...allowedRoles: AppRole[]) {
  return async (
    req: AuthenticatedRequest,
    res: Response,
    next: NextFunction
  ): Promise<void> => {
    if (!req.auth) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!allowedRoles.includes(req.auth.role)) {
      await recordAudit({
        actorUserId: req.auth.userId,
        actorRole: req.auth.role,
        actorLabel: req.auth.displayName,
        action: 'DENIED_RBAC',
        resourceType: 'endpoint',
        resourceId: `${req.method} ${req.path}`,
        detail: `Server refused ${req.auth.role} access; required: ${allowedRoles.join(', ')}`,
        severity: 'security',
      });
      res.status(403).json({
        error: `Forbidden: role '${req.auth.role}' is not permitted to perform this action.`,
      });
      return;
    }
    next();
  };
}
