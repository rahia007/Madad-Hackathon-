import {
  boolean,
  index,
  integer,
  pgTable,
  real,
  serial,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    uid: text('uid').notNull().unique(),
    email: text('email').notNull().unique(),
    displayName: text('display_name').notNull(),
    passwordHash: text('password_hash'),
    preferredLang: text('preferred_lang').notNull().default('ur'),
    isDemoAccount: boolean('is_demo_account').notNull().default(false),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('users_email_idx').on(table.email)]
);

export const userRoles = pgTable(
  'user_roles',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    role: text('role').notNull(), // citizen | helper | officer | admin | auditor
    tenantId: text('tenant_id').notNull().default('relief-dept-pk'),
    assignedByUserId: integer('assigned_by_user_id'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('user_roles_user_idx').on(table.userId)]
);

export const citizens = pgTable(
  'citizens',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    fullName: text('full_name').notNull(),
    cnicMasked: text('cnic_masked').notNull(),
    cnicHash: text('cnic_hash').notNull().unique(),
    cnicEncrypted: text('cnic_encrypted').notNull(),
    age: integer('age').notNull().default(30),
    monthlyIncome: integer('monthly_income').notNull().default(0),
    householdSize: integer('household_size').notNull().default(4),
    district: text('district').notNull().default('Karachi South'),
    phoneMasked: text('phone_masked').notNull().default('0300-***-0000'),
    isSyntheticDemo: boolean('is_synthetic_demo').notNull().default(true),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    index('citizens_user_idx').on(table.userId),
    index('citizens_cnic_hash_idx').on(table.cnicHash),
  ]
);

export const mockRegistryRecords = pgTable(
  'mock_registry_records',
  {
    id: serial('id').primaryKey(),
    fullName: text('full_name').notNull(),
    cnicMasked: text('cnic_masked').notNull(),
    cnicHash: text('cnic_hash').notNull().unique(),
    age: integer('age').notNull(),
    monthlyIncome: integer('monthly_income').notNull(),
    district: text('district').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('mock_registry_cnic_idx').on(table.cnicHash)]
);

export const helperAssignments = pgTable(
  'helper_assignments',
  {
    id: serial('id').primaryKey(),
    helperUserId: integer('helper_user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    citizenId: integer('citizen_id')
      .references(() => citizens.id, { onDelete: 'cascade' })
      .notNull(),
    relationship: text('relationship').notNull().default('Community Volunteer'),
    assignedAt: timestamp('assigned_at').defaultNow().notNull(),
  },
  (table) => [
    index('helper_assign_helper_idx').on(table.helperUserId),
    index('helper_assign_citizen_idx').on(table.citizenId),
  ]
);

export const consents = pgTable(
  'consents',
  {
    id: serial('id').primaryKey(),
    citizenId: integer('citizen_id')
      .references(() => citizens.id, { onDelete: 'cascade' })
      .notNull(),
    scope: text('scope').notNull(), // helper_access | department_review | payment_disbursement | document_access
    granteeLabel: text('grantee_label').notNull(),
    granted: boolean('granted').notNull().default(true),
    retentionNotice: text('retention_notice')
      .notNull()
      .default('Withdrawing stops all future access immediately; finalized audit records remain legally archived.'),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [index('consents_citizen_idx').on(table.citizenId)]
);

export const consentHistory = pgTable(
  'consent_history',
  {
    id: serial('id').primaryKey(),
    consentId: integer('consent_id')
      .references(() => consents.id, { onDelete: 'cascade' })
      .notNull(),
    citizenId: integer('citizen_id')
      .references(() => citizens.id, { onDelete: 'cascade' })
      .notNull(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    scope: text('scope').notNull(),
    action: text('action').notNull(), // granted | withdrawn
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('consent_history_citizen_idx').on(table.citizenId)]
);

export const eligibilityRules = pgTable('eligibility_rules', {
  id: serial('id').primaryKey(),
  version: integer('version').notNull().unique(),
  name: text('name').notNull(),
  maxIncome: integer('max_income').notNull(),
  minAge: integer('min_age').notNull(),
  costWrong: real('cost_wrong').notNull(),
  costSlow: real('cost_slow').notNull(),
  askBelow: real('ask_below').notNull(),
  autoThreshold: real('auto_threshold').notNull(),
  isActive: boolean('is_active').notNull().default(false),
  createdByUserId: integer('created_by_user_id').references(() => users.id, { onDelete: 'set null' }),
  changeSummary: text('change_summary').notNull().default('Initial baseline policy'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const ruleSimulations = pgTable('rule_simulations', {
  id: serial('id').primaryKey(),
  adminUserId: integer('admin_user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  baseVersion: integer('base_version').notNull(),
  draftRuleJson: text('draft_rule_json').notNull(),
  totalCases: integer('total_cases').notNull(),
  changedCount: integer('changed_count').notNull(),
  diffJson: text('diff_json').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const applications = pgTable(
  'applications',
  {
    id: serial('id').primaryKey(),
    caseCode: text('case_code').notNull().unique(),
    citizenId: integer('citizen_id')
      .references(() => citizens.id, { onDelete: 'cascade' })
      .notNull(),
    submittedByUserId: integer('submitted_by_user_id')
      .references(() => users.id, { onDelete: 'set null' })
      .notNull(),
    idempotencyKey: text('idempotency_key').notNull().unique(),
    applicantName: text('applicant_name').notNull(),
    cnicMasked: text('cnic_masked').notNull(),
    cnicHash: text('cnic_hash').notNull(),
    age: integer('age'),
    monthlyIncome: integer('monthly_income'),
    householdDetails: text('household_details').notNull().default(''),
    contactPhone: text('contact_phone').notNull().default(''),
    district: text('district').notNull().default('Karachi South'),
    status: text('status').notNull().default('draft'), // draft | approved | approved_by_officer | rejected | needs_proof | in_review | escalated
    route: text('route').notNull().default('human'), // auto | docs | human
    confidence: real('confidence').notNull().default(0),
    ruleVersion: integer('rule_version').notNull().default(1),
    matchedRegistryName: text('matched_registry_name'),
    urgencyScore: integer('urgency_score').notNull().default(50),
    assignedOfficerId: integer('assigned_officer_id').references(() => users.id, { onDelete: 'set null' }),
    isDraft: boolean('is_draft').notNull().default(false),
    offlineCreatedAt: timestamp('offline_created_at'),
    syncedAt: timestamp('synced_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [
    index('apps_citizen_idx').on(table.citizenId),
    index('apps_status_idx').on(table.status),
    index('apps_submitted_by_idx').on(table.submittedByUserId),
  ]
);

export const applicationDocuments = pgTable(
  'application_documents',
  {
    id: serial('id').primaryKey(),
    applicationId: integer('application_id')
      .references(() => applications.id, { onDelete: 'cascade' })
      .notNull(),
    uploadedByUserId: integer('uploaded_by_user_id')
      .references(() => users.id, { onDelete: 'set null' })
      .notNull(),
    originalName: text('original_name').notNull(),
    mimeType: text('mime_type').notNull(),
    sizeBytes: integer('size_bytes').notNull(),
    storageKey: text('storage_key').notNull(),
    sha256: text('sha256').notNull(),
    extractionJson: text('extraction_json'),
    tamperRisk: text('tamper_risk').default('unscanned'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('app_docs_app_idx').on(table.applicationId)]
);

export const applicationStatusHistory = pgTable(
  'application_status_history',
  {
    id: serial('id').primaryKey(),
    applicationId: integer('application_id')
      .references(() => applications.id, { onDelete: 'cascade' })
      .notNull(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status').notNull(),
    note: text('note').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('app_hist_app_idx').on(table.applicationId)]
);

export const applicationDecisions = pgTable(
  'application_decisions',
  {
    id: serial('id').primaryKey(),
    applicationId: integer('application_id')
      .references(() => applications.id, { onDelete: 'cascade' })
      .notNull(),
    ruleVersion: integer('rule_version').notNull(),
    confidence: real('confidence').notNull(),
    deterministicEligible: boolean('deterministic_eligible').notNull(),
    route: text('route').notNull(),
    traceJson: text('trace_json').notNull(),
    whyEn: text('why_en').notNull(),
    whyUr: text('why_ur').notNull(),
    aiSummaryEn: text('ai_summary_en'),
    aiSummaryUr: text('ai_summary_ur'),
    aiModel: text('ai_model').notNull().default('deterministic-engine+gemini-4-hydrogen'),
    humanDecision: text('human_decision'),
    officerId: integer('officer_id').references(() => users.id, { onDelete: 'set null' }),
    officerNote: text('officer_note'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('app_dec_app_idx').on(table.applicationId)]
);

export const scamChecks = pgTable(
  'scam_checks',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    messagePreview: text('message_preview').notNull(),
    hasImage: boolean('has_image').notNull().default(false),
    riskLevel: text('risk_level').notNull(), // high | medium | low | uncertain
    confidence: real('confidence').notNull(),
    indicatorsJson: text('indicators_json').notNull(),
    explanationEn: text('explanation_en').notNull(),
    explanationUr: text('explanation_ur').notNull(),
    recommendedActionsJson: text('recommended_actions_json').notNull(),
    humanReviewRequired: boolean('human_review_required').notNull().default(false),
    deterministicSignalsJson: text('deterministic_signals_json').notNull(),
    region: text('region').notNull().default('Karachi'),
    aiModel: text('ai_model').notNull().default('gemini-4-hydrogen'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('scam_checks_user_idx').on(table.userId)]
);

export const notifications = pgTable(
  'notifications',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    titleEn: text('title_en').notNull(),
    titleUr: text('title_ur').notNull(),
    bodyEn: text('body_en').notNull(),
    bodyUr: text('body_ur').notNull(),
    category: text('category').notNull().default('application'),
    isRead: boolean('is_read').notNull().default(false),
    relatedCaseCode: text('related_case_code'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('notifications_user_idx').on(table.userId)]
);

export const notificationPreferences = pgTable('notification_preferences', {
  id: serial('id').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull()
    .unique(),
  inApp: boolean('in_app').notNull().default(true),
  smsMock: boolean('sms_mock').notNull().default(true),
  emailMock: boolean('email_mock').notNull().default(false),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: serial('id').primaryKey(),
    actorUserId: integer('actor_user_id').references(() => users.id, { onDelete: 'set null' }),
    actorRole: text('actor_role').notNull(),
    actorLabel: text('actor_label').notNull(),
    action: text('action').notNull(),
    resourceType: text('resource_type').notNull(),
    resourceId: text('resource_id').notNull().default(''),
    detail: text('detail').notNull(),
    severity: text('severity').notNull().default('info'), // info | warning | security
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('audit_created_idx').on(table.createdAt)]
);

export const mockServiceLogs = pgTable('mock_service_logs', {
  id: serial('id').primaryKey(),
  serviceName: text('service_name').notNull(), // mock_identity | mock_payment | mock_sms | mock_email
  requestRef: text('request_ref').notNull(),
  status: text('status').notNull(), // success | unavailable | failed
  latencyMs: integer('latency_ms').notNull().default(42),
  summary: text('summary').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const apiKeys = pgTable('api_keys', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  keyPrefix: text('key_prefix').notNull(),
  keyHash: text('key_hash').notNull().unique(),
  role: text('role').notNull().default('auditor'),
  createdByUserId: integer('created_by_user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  lastUsedAt: timestamp('last_used_at'),
  revokedAt: timestamp('revoked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const policyDocuments = pgTable(
  'policy_documents',
  {
    id: serial('id').primaryKey(),
    code: text('code').notNull().unique(),
    titleEn: text('title_en').notNull(),
    titleUr: text('title_ur').notNull(),
    category: text('category').notNull().default('eligibility'),
    contentEn: text('content_en').notNull(),
    contentUr: text('content_ur').notNull(),
    embeddingJson: text('embedding_json'),
    version: integer('version').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('policy_docs_code_idx').on(table.code)]
);

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: serial('id').primaryKey(),
    applicationId: integer('application_id')
      .references(() => applications.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id').references(() => users.id, { onDelete: 'set null' }),
    goal: text('goal').notNull(),
    stepsJson: text('steps_json').notNull(),
    finalDecision: text('final_decision').notNull(),
    toolsCalledCount: integer('tools_called_count').notNull().default(0),
    model: text('model').notNull().default('gemini-4-hydrogen'),
    latencyMs: integer('latency_ms').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('agent_runs_app_idx').on(table.applicationId)]
);

export const aiTelemetry = pgTable(
  'ai_telemetry',
  {
    id: serial('id').primaryKey(),
    endpoint: text('endpoint').notNull(),
    model: text('model').notNull(),
    latencyMs: integer('latency_ms').notNull().default(0),
    success: boolean('success').notNull().default(true),
    usedFallback: boolean('used_fallback').notNull().default(false),
    inputTokensEst: integer('input_tokens_est').notNull().default(0),
    costUsdEst: real('cost_usd_est').notNull().default(0),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('ai_telemetry_endpoint_idx').on(table.endpoint)]
);

export const webhooks = pgTable('webhooks', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  targetUrl: text('target_url').notNull(),
  eventsJson: text('events_json').notNull(),
  secretMasked: text('secret_masked').notNull(),
  secretEncrypted: text('secret_encrypted').notNull(),
  isActive: boolean('is_active').notNull().default(true),
  createdByUserId: integer('created_by_user_id')
    .references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const webhookDeliveries = pgTable(
  'webhook_deliveries',
  {
    id: serial('id').primaryKey(),
    webhookId: integer('webhook_id')
      .references(() => webhooks.id, { onDelete: 'cascade' })
      .notNull(),
    eventType: text('event_type').notNull(),
    payloadJson: text('payload_json').notNull(),
    responseStatus: integer('response_status').notNull().default(0),
    success: boolean('success').notNull().default(false),
    latencyMs: integer('latency_ms').notNull().default(0),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [index('webhook_deliv_hook_idx').on(table.webhookId)]
);

// Drizzle Relations
export const usersRelations = relations(users, ({ many }) => ({
  roles: many(userRoles),
  citizens: many(citizens),
  notifications: many(notifications),
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
  user: one(users, {
    fields: [userRoles.userId],
    references: [users.id],
  }),
}));

export const citizensRelations = relations(citizens, ({ one, many }) => ({
  user: one(users, {
    fields: [citizens.userId],
    references: [users.id],
  }),
  consents: many(consents),
  applications: many(applications),
}));

export const applicationsRelations = relations(applications, ({ one, many }) => ({
  citizen: one(citizens, {
    fields: [applications.citizenId],
    references: [citizens.id],
  }),
  documents: many(applicationDocuments),
  history: many(applicationStatusHistory),
  decisions: many(applicationDecisions),
  agentRuns: many(agentRuns),
}));
