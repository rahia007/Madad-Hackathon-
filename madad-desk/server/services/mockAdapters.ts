import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.ts';
import {
  consents,
  mockRegistryRecords,
  mockServiceLogs,
  notificationPreferences,
  notifications,
  webhookDeliveries,
  webhooks,
} from '../../src/db/schema.ts';
import { decryptSensitive, signWebhookHmac } from '../../src/lib/crypto.ts';

export async function mockIdentityLookup(cnicHash: string, nameQuery?: string) {
  const start = Date.now();
  const records = await db.select().from(mockRegistryRecords);
  const match = cnicHash
    ? records.find((r) => r.cnicHash === cnicHash)
    : records.find((r) => r.fullName.toLowerCase() === (nameQuery || '').toLowerCase());

  const latencyMs = Math.max(15, Date.now() - start);
  await db.insert(mockServiceLogs).values({
    serviceName: 'mock_identity',
    requestRef: `MOCK-ID-${Date.now().toString(36).toUpperCase()}`,
    status: 'success',
    latencyMs,
    summary: match
      ? `Mock registry matched synthetic record (${match.cnicMasked})`
      : 'Mock registry lookup returned no exact CNIC match (sensitive details redacted)',
  });

  return {
    adapter: 'MOCK_NADRA_ADAPTER (Synthetic Data Only)',
    officialIntegration: false,
    found: Boolean(match),
    record: match
      ? {
          fullName: match.fullName,
          cnicMasked: match.cnicMasked,
          age: match.age,
          monthlyIncome: match.monthlyIncome,
          district: match.district,
          status: match.status,
        }
      : null,
  };
}

export async function mockPaymentDisbursement(params: {
  caseCode: string;
  citizenId: number;
  amountPkr: number;
}) {
  const start = Date.now();
  const consentRows = await db
    .select()
    .from(consents)
    .where(
      and(
        eq(consents.citizenId, params.citizenId),
        eq(consents.scope, 'payment_disbursement')
      )
    );

  const hasConsent = Boolean(consentRows[0]?.granted);
  const requestRef = `MOCK-PAY-${Date.now().toString(36).toUpperCase()}`;

  if (!hasConsent) {
    await db.insert(mockServiceLogs).values({
      serviceName: 'mock_payment',
      requestRef,
      status: 'failed',
      latencyMs: Math.max(10, Date.now() - start),
      summary: `Simulated payout blocked for ${params.caseCode}: citizen has not granted payment_disbursement consent`,
    });
    return {
      adapter: 'MOCK_RAAST_PAYMENT_ADAPTER (Simulated)',
      officialIntegration: false,
      disbursed: false,
      reason: 'Citizen payment_disbursement consent is currently withdrawn.',
      requestRef,
    };
  }

  await db.insert(mockServiceLogs).values({
    serviceName: 'mock_payment',
    requestRef,
    status: 'success',
    latencyMs: Math.max(25, Date.now() - start),
    summary: `Simulated Rs ${params.amountPkr} relief payout recorded for ${params.caseCode} (mock adapter, no real funds moved)`,
  });

  return {
    adapter: 'MOCK_RAAST_PAYMENT_ADAPTER (Simulated)',
    officialIntegration: false,
    disbursed: true,
    amountPkr: params.amountPkr,
    requestRef,
  };
}

export function isAllowedWebhookUrl(rawUrl: string): { ok: boolean; reason?: string } {
  if (rawUrl.startsWith('sandbox://')) {
    return { ok: true };
  }
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'Invalid URL format.' };
  }
  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'External webhooks must use HTTPS (or sandbox:// for demo testing).' };
  }
  const host = parsed.hostname.toLowerCase();
  if (
    host === 'localhost' ||
    host === '127.0.0.1' ||
    host === '0.0.0.0' ||
    host === '::1' ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    host.startsWith('10.') ||
    host.startsWith('192.168.') ||
    host.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  ) {
    return { ok: false, reason: 'Private, loopback, and metadata IP addresses are blocked (SSRF protection).' };
  }
  return { ok: true };
}

export async function dispatchSingleWebhook(
  hook: typeof webhooks.$inferSelect,
  eventType: string,
  data: Record<string, unknown>
) {
  const start = Date.now();
  const envelope = {
    event: eventType,
    timestamp: new Date().toISOString(),
    source: 'madad-desk-platform',
    data,
  };
  const bodyString = JSON.stringify(envelope);
  const rawSecret = decryptSensitive(hook.secretEncrypted) || 'whsec_fallback';
  const signature = signWebhookHmac(rawSecret, bodyString);

  if (hook.targetUrl.startsWith('sandbox://')) {
    const latencyMs = Math.max(8, Date.now() - start);
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: hook.id,
        eventType,
        payloadJson: bodyString,
        responseStatus: 200,
        success: true,
        latencyMs,
        errorMessage: `Sandbox verified HMAC-SHA256 signature (${signature.slice(0, 16)}...)`,
      })
      .returning();
    return delivery;
  }

  const urlCheck = isAllowedWebhookUrl(hook.targetUrl);
  if (!urlCheck.ok) {
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: hook.id,
        eventType,
        payloadJson: bodyString,
        responseStatus: 0,
        success: false,
        latencyMs: Date.now() - start,
        errorMessage: urlCheck.reason || 'Blocked target URL',
      })
      .returning();
    return delivery;
  }

  try {
    const resp = await fetch(hook.targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Madad-Event': eventType,
        'X-Madad-Signature': `sha256=${signature}`,
      },
      body: bodyString,
      signal: AbortSignal.timeout(5000),
    });
    const latencyMs = Date.now() - start;
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: hook.id,
        eventType,
        payloadJson: bodyString,
        responseStatus: resp.status,
        success: resp.ok,
        latencyMs,
        errorMessage: resp.ok ? null : `HTTP ${resp.status} ${resp.statusText}`,
      })
      .returning();
    return delivery;
  } catch (err: any) {
    const [delivery] = await db
      .insert(webhookDeliveries)
      .values({
        webhookId: hook.id,
        eventType,
        payloadJson: bodyString,
        responseStatus: 0,
        success: false,
        latencyMs: Date.now() - start,
        errorMessage: err?.message || 'Network timeout calling webhook endpoint',
      })
      .returning();
    return delivery;
  }
}

export async function dispatchOutboundWebhooks(eventType: string, data: Record<string, unknown>) {
  try {
    const activeHooks = await db.select().from(webhooks).where(eq(webhooks.isActive, true));
    for (const hook of activeHooks) {
      let subscribed: string[] = [];
      try {
        subscribed = JSON.parse(hook.eventsJson);
      } catch {
        subscribed = [];
      }
      if (subscribed.includes(eventType) || subscribed.includes('*')) {
        await dispatchSingleWebhook(hook, eventType, data);
      }
    }
  } catch (err) {
    console.error('Webhook fanout error:', err);
  }
}

export function getGatewayCapabilities() {
  const twilioReady = Boolean(
    process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER
  );
  const smsWebhookReady = Boolean(process.env.SMS_WEBHOOK_URL);
  const resendReady = Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
  const smtpReady = Boolean(process.env.SMTP_HOST);

  return {
    sms: twilioReady
      ? { status: 'configured', provider: 'Twilio REST API' }
      : smsWebhookReady
        ? { status: 'configured', provider: 'Custom SMS Webhook Gateway' }
        : { status: 'unavailable', provider: 'No TWILIO_ACCOUNT_SID or SMS_WEBHOOK_URL configured' },
    email: resendReady
      ? { status: 'configured', provider: 'Resend Transactional Email API' }
      : smtpReady
        ? { status: 'configured', provider: 'SMTP Relay' }
        : { status: 'unavailable', provider: 'No RESEND_API_KEY or SMTP_HOST configured' },
  };
}

export async function dispatchNotification(params: {
  userId: number;
  titleEn: string;
  titleUr: string;
  bodyEn: string;
  bodyUr: string;
  category: string;
  relatedCaseCode?: string;
  recipientPhone?: string;
  recipientEmail?: string;
}) {
  const prefsRows = await db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, params.userId));
  const prefs = prefsRows[0] ?? { inApp: true, smsMock: true, emailMock: false };

  if (prefs.inApp) {
    await db.insert(notifications).values({
      userId: params.userId,
      titleEn: params.titleEn,
      titleUr: params.titleUr,
      bodyEn: params.bodyEn,
      bodyUr: params.bodyUr,
      category: params.category,
      relatedCaseCode: params.relatedCaseCode ?? null,
    });
  }

  if (prefs.smsMock) {
    const start = Date.now();
    const smsWebhook = process.env.SMS_WEBHOOK_URL;
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_FROM_NUMBER;

    if (twilioSid && twilioToken && twilioFrom && params.recipientPhone) {
      try {
        const form = new URLSearchParams({
          To: params.recipientPhone,
          From: twilioFrom,
          Body: `${params.titleEn}: ${params.bodyEn}`,
        });
        const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: 'POST',
          headers: {
            Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioToken}`).toString('base64')}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: form.toString(),
          signal: AbortSignal.timeout(5000),
        });
        await db.insert(mockServiceLogs).values({
          serviceName: 'sms_gateway',
          requestRef: `TWILIO-${Date.now().toString(36).toUpperCase()}`,
          status: resp.ok ? 'success' : 'failed',
          latencyMs: Date.now() - start,
          summary: resp.ok
            ? `Real SMS dispatched via Twilio (${params.category})`
            : `Twilio SMS failed with HTTP ${resp.status}`,
        });
      } catch (err: any) {
        await db.insert(mockServiceLogs).values({
          serviceName: 'sms_gateway',
          requestRef: `TWILIO-ERR-${Date.now().toString(36).toUpperCase()}`,
          status: 'failed',
          latencyMs: Date.now() - start,
          summary: `Twilio SMS network error: ${err?.message || 'unknown'}`,
        });
      }
    } else if (smsWebhook && isAllowedWebhookUrl(smsWebhook).ok) {
      try {
        const resp = await fetch(smsWebhook, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            channel: 'sms',
            to: params.recipientPhone || 'masked',
            titleEn: params.titleEn,
            titleUr: params.titleUr,
            bodyEn: params.bodyEn,
            bodyUr: params.bodyUr,
            caseCode: params.relatedCaseCode,
          }),
          signal: AbortSignal.timeout(5000),
        });
        await db.insert(mockServiceLogs).values({
          serviceName: 'sms_gateway',
          requestRef: `SMS-HOOK-${Date.now().toString(36).toUpperCase()}`,
          status: resp.ok ? 'success' : 'failed',
          latencyMs: Date.now() - start,
          summary: resp.ok
            ? `SMS payload delivered to SMS_WEBHOOK_URL (${params.category})`
            : `SMS webhook failed HTTP ${resp.status}`,
        });
      } catch (err: any) {
        await db.insert(mockServiceLogs).values({
          serviceName: 'sms_gateway',
          requestRef: `SMS-ERR-${Date.now().toString(36).toUpperCase()}`,
          status: 'failed',
          latencyMs: Date.now() - start,
          summary: `SMS webhook error: ${err?.message || 'timeout'}`,
        });
      }
    } else {
      await db.insert(mockServiceLogs).values({
        serviceName: 'mock_sms',
        requestRef: `SMS-${Date.now().toString(36).toUpperCase()}`,
        status: 'unavailable',
        latencyMs: 14,
        summary: `SMS delivery unavailable (set TWILIO_ACCOUNT_SID or SMS_WEBHOOK_URL); in-app notification saved`,
      });
    }
  }

  if (prefs.emailMock) {
    const start = Date.now();
    const resendKey = process.env.RESEND_API_KEY;
    const emailFrom = process.env.EMAIL_FROM || 'Madad Desk <noreply@madaddesk.pk>';

    if (resendKey && params.recipientEmail && !params.recipientEmail.endsWith('@madaddesk.pk')) {
      try {
        const resp = await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${resendKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: emailFrom,
            to: [params.recipientEmail],
            subject: params.titleEn,
            text: `${params.bodyEn}\n\n---\n${params.bodyUr}`,
          }),
          signal: AbortSignal.timeout(5000),
        });
        await db.insert(mockServiceLogs).values({
          serviceName: 'email_gateway',
          requestRef: `RESEND-${Date.now().toString(36).toUpperCase()}`,
          status: resp.ok ? 'success' : 'failed',
          latencyMs: Date.now() - start,
          summary: resp.ok
            ? `Real email dispatched via Resend (${params.category})`
            : `Resend email failed HTTP ${resp.status}`,
        });
      } catch (err: any) {
        await db.insert(mockServiceLogs).values({
          serviceName: 'email_gateway',
          requestRef: `MAIL-ERR-${Date.now().toString(36).toUpperCase()}`,
          status: 'failed',
          latencyMs: Date.now() - start,
          summary: `Email gateway error: ${err?.message || 'timeout'}`,
        });
      }
    } else {
      await db.insert(mockServiceLogs).values({
        serviceName: 'mock_email',
        requestRef: `MAIL-${Date.now().toString(36).toUpperCase()}`,
        status: 'unavailable',
        latencyMs: 11,
        summary: `Email delivery unavailable (configure RESEND_API_KEY + verified non-demo email); in-app notification saved`,
      });
    }
  }
}
