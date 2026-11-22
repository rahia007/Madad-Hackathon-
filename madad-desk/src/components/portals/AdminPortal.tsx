import React, { useEffect, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  Bot,
  Copy,
  Key,
  Play,
  RefreshCw,
  Send,
  Shield,
  Trash2,
  Webhook,
} from 'lucide-react';
import { apiFetch, getMemoryAuthToken } from '../../lib/apiClient.ts';
import { Lang } from '../../lib/i18n.ts';
import { ConfidenceGauge } from '../ConfidenceGauge.tsx';
import { PolicyRagExplorer } from '../PolicyRagExplorer.tsx';

interface AdminPortalProps {
  activeTab: string;
  lang: Lang;
}

const CHART_COLORS = ['#17372E', '#B77B50', '#688573', '#A94F40', '#4A554E'];

export const AdminPortal: React.FC<AdminPortalProps> = ({ activeTab, lang }) => {
  const [analytics, setAnalytics] = useState<any>(null);
  const [rules, setRules] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [apiKeys, setApiKeys] = useState<any[]>([]);
  const [mockRegistry, setMockRegistry] = useState<any[]>([]);
  const [evaluation, setEvaluation] = useState<any>(null);
  const [webhooksData, setWebhooksData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Rule form
  const [ruleName, setRuleName] = useState('Updated Relief Policy');
  const [maxIncome, setMaxIncome] = useState(25000);
  const [minAge, setMinAge] = useState(18);
  const [costWrong, setCostWrong] = useState(10);
  const [costSlow, setCostSlow] = useState(1);
  const [askBelow, setAskBelow] = useState(0.6);
  const [changeSummary, setChangeSummary] = useState('');
  const [simulation, setSimulation] = useState<any>(null);

  // API key form
  const [newKeyName, setNewKeyName] = useState('');
  const [newKeyRole, setNewKeyRole] = useState<'auditor' | 'officer' | 'citizen'>('auditor');
  const [createdRawKey, setCreatedRawKey] = useState('');

  // Webhook form
  const [whName, setWhName] = useState('');
  const [whUrl, setWhUrl] = useState('https://');
  const [whEvents, setWhEvents] = useState<string[]>([
    'APPLICATION_SUBMITTED',
    'APPLICATION_APPROVED',
    'HIGH_RISK_SCAM_DETECTED',
  ]);
  const [createdWebhookSecret, setCreatedWebhookSecret] = useState('');
  const [whTestingId, setWhTestingId] = useState<number | null>(null);

  const loadAll = async () => {
    setLoading(true);
    setError('');
    try {
      const [aRes, rRes, uRes, kRes, mRes, eRes, wRes] = await Promise.all([
        apiFetch('/api/admin/analytics'),
        apiFetch<{ versions: any[] }>('/api/admin/rules'),
        apiFetch<{ users: any[] }>('/api/admin/users'),
        apiFetch<{ apiKeys: any[] }>('/api/admin/api-keys'),
        apiFetch<{ records: any[] }>('/api/mock/identity'),
        apiFetch('/api/admin/evaluation'),
        apiFetch('/api/admin/webhooks'),
      ]);
      setAnalytics(aRes);
      setRules(rRes.versions || []);
      setUsersList(uRes.users || []);
      setApiKeys(kRes.apiKeys || []);
      setMockRegistry(mRes.records || []);
      setEvaluation(eRes);
      setWebhooksData(wRes);

      const active = (rRes.versions || []).find((r) => r.isActive) || rRes.versions?.[0];
      if (active) {
        setMaxIncome(active.maxIncome);
        setMinAge(active.minAge);
        setCostWrong(active.costWrong);
        setCostSlow(active.costSlow);
        setAskBelow(active.askBelow);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAll();
  }, [activeTab]);

  const computedThreshold = costWrong + costSlow > 0 ? costWrong / (costWrong + costSlow) : 0.9;

  const handleSimulate = async () => {
    setError('');
    setNotice('');
    try {
      const res = await apiFetch('/api/admin/rules/simulate', {
        method: 'POST',
        body: JSON.stringify({
          name: ruleName,
          maxIncome: Number(maxIncome),
          minAge: Number(minAge),
          costWrong: Number(costWrong),
          costSlow: Number(costSlow),
          askBelow: Number(askBelow),
          changeSummary: changeSummary || 'Digital twin simulation',
        }),
      });
      setSimulation(res);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handlePublishRule = async () => {
    setError('');
    setNotice('');
    try {
      const res = await apiFetch<{ rule: any }>('/api/admin/rules', {
        method: 'POST',
        body: JSON.stringify({
          name: ruleName,
          maxIncome: Number(maxIncome),
          minAge: Number(minAge),
          costWrong: Number(costWrong),
          costSlow: Number(costSlow),
          askBelow: Number(askBelow),
          changeSummary: changeSummary || 'Updated thresholds via Admin Console',
        }),
      });
      setNotice(`Rule v${res.rule.version} is now live. Historical decisions remain bound to their original rule versions.`);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRoleChange = async (userId: number, role: string) => {
    setError('');
    try {
      await apiFetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
      setNotice(`Updated user #${userId} role to ${role}.`);
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleCreateApiKey = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newKeyName.trim()) return;
    setError('');
    try {
      const res = await apiFetch<{ rawKey: string }>('/api/admin/api-keys', {
        method: 'POST',
        body: JSON.stringify({ name: newKeyName, role: newKeyRole }),
      });
      setCreatedRawKey(res.rawKey);
      setNewKeyName('');
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleRevokeKey = async (id: number) => {
    await apiFetch(`/api/admin/api-keys/${id}`, { method: 'DELETE' });
    await loadAll();
  };

  const handleResetDemo = async () => {
    setError('');
    await apiFetch('/api/admin/demo-reset', { method: 'POST' });
    setNotice('Demonstration records reset cleanly in PostgreSQL.');
    await loadAll();
  };

  const handleCreateWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setCreatedWebhookSecret('');
    try {
      const res = await apiFetch<{ rawSecret: string }>('/api/admin/webhooks', {
        method: 'POST',
        body: JSON.stringify({
          name: whName,
          targetUrl: whUrl,
          events: whEvents,
        }),
      });
      setCreatedWebhookSecret(res.rawSecret);
      setWhName('');
      setNotice('Outbound webhook registered with HMAC-SHA256 signing.');
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const handleTestWebhook = async (id: number) => {
    setWhTestingId(id);
    setError('');
    try {
      const res = await apiFetch<{ delivery: any }>(`/api/admin/webhooks/${id}/test`, {
        method: 'POST',
      });
      setNotice(
        res.delivery.success
          ? `Test webhook delivered (HTTP ${res.delivery.responseStatus}, ${res.delivery.latencyMs}ms).`
          : `Test webhook failed: ${res.delivery.errorMessage}`
      );
      await loadAll();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setWhTestingId(null);
    }
  };

  const handleDeleteWebhook = async (id: number) => {
    await apiFetch(`/api/admin/webhooks/${id}`, { method: 'DELETE' });
    await loadAll();
  };

  if (loading && !analytics) {
    return <p className="text-sm text-[#5A655D]">Loading administrator telemetry from PostgreSQL...</p>;
  }

  // ---------------------------------------------------------------------------
  // TAB 1: ANALYTICS
  // ---------------------------------------------------------------------------
  if (activeTab === 'analytics') {
    return (
      <div className="space-y-6">
        <div className="border-b border-[#CED6CC] pb-5">
          <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
            {lang === 'ur' ? 'سسٹم تجزیات (پوسٹ گریس کیو ایل)' : 'System Analytics & Decision Distribution'}
          </h2>
          <p className="text-sm text-[#4A554E] mt-1">
            All figures computed live from persisted PostgreSQL records (includes clearly labeled synthetic demonstration cases).
          </p>
        </div>

        {analytics && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
              <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
                <span className="text-xs text-[#5A655D]">Submitted Cases</span>
                <p className="text-2xl font-semibold font-mono-tabular text-[#17372E] mt-1">
                  {analytics.totals.applications}
                </p>
              </div>
              <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
                <span className="text-xs text-[#5A655D]">Saved Drafts</span>
                <p className="text-2xl font-semibold font-mono-tabular text-[#4A554E] mt-1">
                  {analytics.totals.drafts}
                </p>
              </div>
              <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
                <span className="text-xs text-[#5A655D]">Human Escalation</span>
                <p className="text-2xl font-semibold font-mono-tabular text-[#B77B50] mt-1">
                  {analytics.totals.humanEscalationRate}%
                </p>
              </div>
              <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
                <span className="text-xs text-[#5A655D]">Scam Checks</span>
                <p className="text-2xl font-semibold font-mono-tabular text-[#A94F40] mt-1">
                  {analytics.totals.scamChecks}
                </p>
              </div>
              <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
                <span className="text-xs text-[#5A655D]">Policy Versions</span>
                <p className="text-2xl font-semibold font-mono-tabular text-[#17372E] mt-1">
                  v{analytics.activeRule?.version ?? 1} ({analytics.totals.ruleVersions})
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
                <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
                  Application Outcomes
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.statusDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5EAE3" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#17372E" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
                <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
                  AI Confidence Routing Split
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={analytics.routeDistribution}
                        dataKey="value"
                        nameKey="name"
                        cx="50%"
                        cy="50%"
                        outerRadius={88}
                        label
                      >
                        {analytics.routeDistribution.map((_: any, i: number) => (
                          <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
                <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
                  Scam Classifier Distribution
                </h3>
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={analytics.scamDistribution}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5EAE3" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
                      <Tooltip />
                      <Bar dataKey="value" fill="#B77B50" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
                <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
                  Mock Service Adapter Activity Log
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto text-xs">
                  {analytics.recentServiceLogs.map((log: any) => (
                    <div key={log.id} className="border-b border-[#CED6CC]/60 pb-2">
                      <div className="flex justify-between font-mono-tabular">
                        <span className="font-semibold text-[#17372E]">{log.serviceName}</span>
                        <span
                          className={
                            log.status === 'success'
                              ? 'text-[#17372E]'
                              : log.status === 'unavailable'
                                ? 'text-[#B77B50]'
                                : 'text-[#A94F40]'
                          }
                        >
                          {log.status} · {log.latencyMs}ms
                        </span>
                      </div>
                      <p className="text-[#4A554E] mt-0.5">{log.summary}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TAB 1.5: AI EVALUATION, OVERRIDE CALIBRATION & ANOMALY DETECTION
  // ---------------------------------------------------------------------------
  if (activeTab === 'evaluation' && evaluation) {
    return (
      <div className="space-y-6">
        <div className="border-b border-[#CED6CC] pb-5">
          <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
            {lang === 'ur'
              ? 'اے آئی کارکردگی، لاگت اور تضاد کی جانچ'
              : 'AI Evaluation, Override Calibration & Fraud Anomalies'}
          </h2>
          <p className="text-sm text-[#4A554E] mt-1">
            Live telemetry from Gemini calls, human-officer override tracking, and cross-claim duplicate/variance alerts.
          </p>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
          <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
            <span className="text-xs text-[#5A655D]">AI API Calls</span>
            <p className="text-2xl font-semibold font-mono-tabular text-[#17372E] mt-1">
              {evaluation.telemetrySummary.totalCalls}
            </p>
            <span className="text-[11px] text-[#5A655D]">
              {evaluation.telemetrySummary.successRate}% success
            </span>
          </div>
          <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
            <span className="text-xs text-[#5A655D]">Avg / P95 Latency</span>
            <p className="text-2xl font-semibold font-mono-tabular text-[#17372E] mt-1">
              {evaluation.telemetrySummary.avgLatencyMs}ms
            </p>
            <span className="text-[11px] font-mono-tabular text-[#5A655D]">
              P95: {evaluation.telemetrySummary.p95LatencyMs}ms
            </span>
          </div>
          <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
            <span className="text-xs text-[#5A655D]">Lite Fallback Rate</span>
            <p className="text-2xl font-semibold font-mono-tabular text-[#B77B50] mt-1">
              {evaluation.telemetrySummary.fallbackRate}%
            </p>
            <span className="text-[11px] text-[#5A655D]">503 resilience</span>
          </div>
          <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
            <span className="text-xs text-[#5A655D]">Est. AI Spend</span>
            <p className="text-2xl font-semibold font-mono-tabular text-[#17372E] mt-1">
              ${evaluation.telemetrySummary.totalCostUsd.toFixed(4)}
            </p>
            <span className="text-[11px] text-[#5A655D]">token-estimated</span>
          </div>
          <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
            <span className="text-xs text-[#5A655D]">Human Override Rate</span>
            <p className="text-2xl font-semibold font-mono-tabular text-[#A94F40] mt-1">
              {evaluation.overrideMetrics.overrideRate}%
            </p>
            <span className="text-[11px] text-[#5A655D]">
              {evaluation.overrideMetrics.overriddenCount}/{evaluation.overrideMetrics.reviewedCount} reviewed
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-[#17372E]" />
              <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
                Latency by AI Endpoint (ms)
              </h3>
            </div>
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={evaluation.byEndpoint}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5EAE3" />
                  <XAxis dataKey="endpoint" tick={{ fontSize: 10 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="avgLatencyMs" fill="#17372E" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[#A94F40]" />
              <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
                Cross-Claim Anomaly & Fraud Signals ({evaluation.anomalies.length})
              </h3>
            </div>
            {evaluation.anomalies.length === 0 ? (
              <p className="text-sm text-[#5A655D]">
                No duplicate CNICs, shared phones across distinct names, or registry income variances detected.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-60 overflow-y-auto">
                {evaluation.anomalies.map((an: any, idx: number) => (
                  <div
                    key={idx}
                    className={`rounded-lg border p-3 text-xs space-y-1 ${
                      an.severity === 'high'
                        ? 'border-[#A94F40]/40 bg-[#A94F40]/5'
                        : 'border-[#B77B50]/40 bg-[#FAF7F0]'
                    }`}
                  >
                    <div className="flex justify-between font-semibold">
                      <span className={an.severity === 'high' ? 'text-[#A94F40]' : 'text-[#B77B50]'}>
                        {an.type}
                      </span>
                      <span className="font-mono-tabular text-[#5A655D]">
                        {an.caseCodes.join(', ')}
                      </span>
                    </div>
                    <p className="text-[#202923]">{an.summary}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Recent Autonomous Triage Agent Runs */}
        <div className="rounded-xl border border-[#CED6CC] bg-white overflow-hidden">
          <div className="border-b border-[#CED6CC] bg-[#FAF7F0] px-5 py-3 flex items-center gap-2">
            <Bot className="h-4 w-4 text-[#B77B50]" />
            <h3 className="text-sm font-semibold text-[#17372E]">
              Recent Tool-Calling Agent Executions ({evaluation.recentAgentRuns.length})
            </h3>
          </div>
          {evaluation.recentAgentRuns.length === 0 ? (
            <p className="p-5 text-xs text-[#5A655D]">
              No autonomous triage runs recorded yet. Open any case Decision Room and click "Run Triage Agent".
            </p>
          ) : (
            <div className="divide-y divide-[#CED6CC] text-xs">
              {evaluation.recentAgentRuns.map((run: any) => (
                <div key={run.id} className="p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[#17372E]">{run.goal}</p>
                    <p className="text-[#4A554E] mt-0.5">{run.finalDecision}</p>
                  </div>
                  <div className="text-end font-mono-tabular text-[#5A655D]">
                    <p>{run.toolsCalledCount} tools · {run.latencyMs}ms</p>
                    <p>{run.model}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Recent Telemetry Table */}
        <div className="rounded-xl border border-[#CED6CC] bg-white overflow-hidden">
          <div className="border-b border-[#CED6CC] bg-[#FAF7F0] px-5 py-3">
            <h3 className="text-sm font-semibold text-[#17372E]">Live Gemini Call Telemetry Log</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead className="border-b border-[#CED6CC] text-[#5A655D]">
                <tr>
                  <th className="px-4 py-2.5 text-start">Endpoint</th>
                  <th className="px-4 py-2.5 text-start">Model</th>
                  <th className="px-4 py-2.5 text-start">Latency</th>
                  <th className="px-4 py-2.5 text-start">Fallback</th>
                  <th className="px-4 py-2.5 text-start">Est. Cost</th>
                  <th className="px-4 py-2.5 text-end">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CED6CC]">
                {evaluation.recentTelemetry.map((row: any) => (
                  <tr key={row.id}>
                    <td className="px-4 py-2.5 font-mono-tabular font-medium text-[#17372E]">
                      {row.endpoint}
                    </td>
                    <td className="px-4 py-2.5 font-mono-tabular">{row.model}</td>
                    <td className="px-4 py-2.5 font-mono-tabular">{row.latencyMs}ms</td>
                    <td className="px-4 py-2.5">{row.usedFallback ? 'Lite Fallback' : 'Primary'}</td>
                    <td className="px-4 py-2.5 font-mono-tabular">${row.costUsdEst.toFixed(5)}</td>
                    <td className="px-4 py-2.5 text-end font-semibold">
                      {row.success ? (
                        <span className="text-[#17372E]">OK</span>
                      ) : (
                        <span className="text-[#A94F40]">Error</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TAB 1.8: POLICY HANDBOOK & SEMANTIC RAG EDITOR
  // ---------------------------------------------------------------------------
  if (activeTab === 'policy') {
    return <PolicyRagExplorer lang={lang} canPublish={true} />;
  }

  // ---------------------------------------------------------------------------
  // TAB 2: VERSIONED RULES & DIGITAL TWIN SIMULATOR
  // ---------------------------------------------------------------------------
  if (activeTab === 'rules') {
    return (
      <div className="space-y-6">
        <div className="border-b border-[#CED6CC] pb-5">
          <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
            Versioned Eligibility Rules & Digital Twin
          </h2>
          <p className="text-sm text-[#4A554E] mt-1">
            Simulate policy changes on historical PostgreSQL cases before publishing. Publishing creates an immutable new version without altering past decisions.
          </p>
        </div>

        {error && (
          <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-4 text-sm text-[#A94F40]">
            {error}
          </div>
        )}
        {notice && (
          <div className="rounded-lg border border-[#17372E]/30 bg-[#DCE6DA]/50 p-4 text-sm text-[#17372E]">
            {notice}
          </div>
        )}

        <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-[#5A655D] mb-1">
                Policy Name
              </label>
              <input
                type="text"
                value={ruleName}
                onChange={(e) => setRuleName(e.target.value)}
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#5A655D] mb-1">
                Max Monthly Income (Rs)
              </label>
              <input
                type="number"
                value={maxIncome}
                onChange={(e) => setMaxIncome(Number(e.target.value))}
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#5A655D] mb-1">
                Minimum Age
              </label>
              <input
                type="number"
                value={minAge}
                onChange={(e) => setMinAge(Number(e.target.value))}
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#5A655D] mb-1">
                Cost of Wrong Approval
              </label>
              <input
                type="number"
                step="0.5"
                value={costWrong}
                onChange={(e) => setCostWrong(Number(e.target.value))}
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#5A655D] mb-1">
                Cost of Delay
              </label>
              <input
                type="number"
                step="0.5"
                value={costSlow}
                onChange={(e) => setCostSlow(Number(e.target.value))}
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-[#5A655D] mb-1">
                Human Review Floor (askBelow)
              </label>
              <input
                type="number"
                step="0.05"
                min="0.1"
                max="0.9"
                value={askBelow}
                onChange={(e) => setAskBelow(Number(e.target.value))}
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm font-mono-tabular"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-[#5A655D] mb-1">
              Change Justification (recorded in version history)
            </label>
            <input
              type="text"
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              placeholder="e.g. Adjusted income threshold for winter inflation relief"
              className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
            />
          </div>

          <ConfidenceGauge
            confidence={0.82}
            askBelow={askBelow}
            autoThreshold={computedThreshold}
            costWrong={costWrong}
            costSlow={costSlow}
            lang={lang}
          />

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              onClick={handleSimulate}
              className="flex items-center gap-2 rounded-lg border border-[#17372E] bg-[#FAF7F0] px-5 py-2.5 text-sm font-semibold text-[#17372E] hover:bg-[#DCE6DA]/50"
            >
              <Play className="h-4 w-4" />
              <span>Run Digital Twin Simulation</span>
            </button>
            <button
              onClick={handlePublishRule}
              className="rounded-lg bg-[#17372E] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1E473C]"
            >
              Publish New Rule Version
            </button>
          </div>
        </div>

        {simulation && (
          <div className="rounded-xl border border-[#B77B50]/50 bg-[#FAF7F0] p-6 space-y-3">
            <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
              Digital Twin Replay Result: {simulation.changedCount} of {simulation.totalCases} decisions would change
            </h3>
            <p className="text-xs text-[#5A655D]">
              Draft auto-approval threshold: {(simulation.autoThreshold * 100).toFixed(1)}% · Nothing was modified in live cases.
            </p>
            {simulation.diffs?.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-[#CED6CC] bg-white">
                <table className="w-full text-start text-xs">
                  <thead className="border-b border-[#CED6CC] bg-[#FAF7F0]">
                    <tr>
                      <th className="px-3 py-2 text-start">Case</th>
                      <th className="px-3 py-2 text-start">Applicant</th>
                      <th className="px-3 py-2 text-start">Current Route</th>
                      <th className="px-3 py-2 text-start">Simulated Route</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#CED6CC]">
                    {simulation.diffs.map((d: any) => (
                      <tr key={d.caseCode}>
                        <td className="px-3 py-2 font-mono-tabular font-semibold">{d.caseCode}</td>
                        <td className="px-3 py-2">{d.applicantName}</td>
                        <td className="px-3 py-2 font-mono-tabular">{d.oldRoute}</td>
                        <td className="px-3 py-2 font-mono-tabular font-semibold text-[#B77B50]">
                          {d.newRoute}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-[#17372E]">
                All historical cases keep identical routing under this draft rule.
              </p>
            )}
          </div>
        )}

        <div className="rounded-xl border border-[#CED6CC] bg-white overflow-hidden">
          <div className="border-b border-[#CED6CC] bg-[#FAF7F0] px-5 py-3">
            <h3 className="text-sm font-semibold text-[#17372E]">Rule Version History</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead className="border-b border-[#CED6CC] text-[#5A655D]">
                <tr>
                  <th className="px-4 py-2.5 text-start">Ver</th>
                  <th className="px-4 py-2.5 text-start">Policy</th>
                  <th className="px-4 py-2.5 text-start">Max Income</th>
                  <th className="px-4 py-2.5 text-start">Min Age</th>
                  <th className="px-4 py-2.5 text-start">Auto Threshold</th>
                  <th className="px-4 py-2.5 text-start">State</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CED6CC]">
                {rules.map((r) => (
                  <tr key={r.id}>
                    <td className="px-4 py-3 font-mono-tabular font-semibold">v{r.version}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-[#202923]">{r.name}</div>
                      <div className="text-[#5A655D]">{r.changeSummary}</div>
                    </td>
                    <td className="px-4 py-3 font-mono-tabular">Rs {r.maxIncome.toLocaleString()}</td>
                    <td className="px-4 py-3 font-mono-tabular">{r.minAge}</td>
                    <td className="px-4 py-3 font-mono-tabular">
                      {(r.autoThreshold * 100).toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 font-semibold">
                      {r.isActive ? (
                        <span className="text-[#17372E]">Active</span>
                      ) : (
                        <span className="text-[#5A655D]">Archived</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // TAB 3: USER ROLES, PUBLIC API KEYS, MOCK SERVICES & DEMO RESET
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#CED6CC] pb-5">
        <div>
          <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
            Users, Public API Keys & Mock Services
          </h2>
          <p className="text-sm text-[#4A554E] mt-1">
            All external government adapters (NADRA-style registry, Raast-style disbursement, SMS/Email gateways) are explicitly simulated using synthetic records.
          </p>
        </div>
        <button
          onClick={handleResetDemo}
          className="flex items-center gap-2 rounded-lg border border-[#A94F40] px-4 py-2 text-xs font-semibold text-[#A94F40] hover:bg-[#A94F40]/10"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          <span>Reset Demo Records</span>
        </button>
      </div>

      {error && (
        <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-4 text-sm text-[#A94F40]">
          {error}
        </div>
      )}
      {notice && (
        <div className="rounded-lg border border-[#17372E]/30 bg-[#DCE6DA]/50 p-4 text-sm text-[#17372E]">
          {notice}
        </div>
      )}

      {/* User & Role Management */}
      <div className="rounded-xl border border-[#CED6CC] bg-white overflow-hidden">
        <div className="border-b border-[#CED6CC] bg-[#FAF7F0] px-5 py-3 flex items-center gap-2">
          <Shield className="h-4 w-4 text-[#17372E]" />
          <h3 className="text-sm font-semibold text-[#17372E]">Server-Enforced User Roles</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs">
            <thead className="border-b border-[#CED6CC] text-[#5A655D]">
              <tr>
                <th className="px-4 py-2.5 text-start">User</th>
                <th className="px-4 py-2.5 text-start">Email</th>
                <th className="px-4 py-2.5 text-start">Type</th>
                <th className="px-4 py-2.5 text-end">Role</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#CED6CC]">
              {usersList.map((u) => (
                <tr key={u.id}>
                  <td className="px-4 py-3 font-medium text-[#202923]">{u.displayName}</td>
                  <td className="px-4 py-3 font-mono-tabular text-[#5A655D]">{u.email}</td>
                  <td className="px-4 py-3">{u.isDemoAccount ? 'Synthetic Demo' : 'Registered'}</td>
                  <td className="px-4 py-3 text-end">
                    <select
                      value={u.role}
                      onChange={(e) => handleRoleChange(u.id, e.target.value)}
                      className="rounded border border-[#CED6CC] bg-[#FAF7F0] px-2.5 py-1 text-xs font-semibold"
                    >
                      <option value="citizen">citizen</option>
                      <option value="helper">helper</option>
                      <option value="officer">officer</option>
                      <option value="admin">admin</option>
                      <option value="auditor">auditor</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Public REST API Keys & OpenAPI */}
      <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-[#B77B50]" />
            <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
              Public REST API Keys & OpenAPI Specification
            </h3>
          </div>
          <a
            href="/api/openapi.json"
            target="_blank"
            rel="noreferrer"
            className="text-xs font-semibold text-[#17372E] underline"
          >
            Open /api/openapi.json
          </a>
        </div>

        <form onSubmit={handleCreateApiKey} className="flex flex-wrap gap-3">
          <input
            type="text"
            value={newKeyName}
            onChange={(e) => setNewKeyName(e.target.value)}
            placeholder="Key label (e.g. Hackathon Auditor Curl Test)"
            className="flex-1 min-w-[220px] rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
          />
          <select
            value={newKeyRole}
            onChange={(e) => setNewKeyRole(e.target.value as any)}
            className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
          >
            <option value="auditor">auditor (read-only)</option>
            <option value="officer">officer</option>
            <option value="citizen">citizen</option>
          </select>
          <button
            type="submit"
            className="rounded-lg bg-[#17372E] px-4 py-2 text-sm font-semibold text-white"
          >
            Issue API Key
          </button>
        </form>

        {createdRawKey && (
          <div className="rounded-lg border border-[#17372E]/40 bg-[#DCE6DA]/50 p-3 flex items-center justify-between gap-2 text-xs">
            <div>
              <strong className="text-[#17372E]">Copy now (shown once): </strong>
              <code className="font-mono-tabular">{createdRawKey}</code>
            </div>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(createdRawKey);
                setNotice('API key copied to clipboard.');
              }}
              className="rounded border border-[#17372E] px-2.5 py-1 font-semibold flex items-center gap-1"
            >
              <Copy className="h-3 w-3" />
              Copy
            </button>
          </div>
        )}

        <div className="divide-y divide-[#CED6CC] text-xs">
          {apiKeys.map((k) => (
            <div key={k.id} className="py-2.5 flex items-center justify-between gap-4">
              <div>
                <span className="font-semibold text-[#202923]">{k.name}</span>
                <span className="font-mono-tabular text-[#5A655D] ms-2">
                  {k.keyPrefix}… · role: {k.role}
                </span>
              </div>
              {k.revokedAt ? (
                <span className="text-[#A94F40]">Revoked</span>
              ) : (
                <button
                  onClick={() => handleRevokeKey(k.id)}
                  className="text-[#A94F40] hover:underline flex items-center gap-1"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>

        <div className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] p-3 text-xs font-mono-tabular text-[#4A554E] overflow-x-auto">
          curl -H "Authorization: Bearer {getMemoryAuthToken()?.slice(0, 18) || '<TOKEN>'}..." /api/applications
        </div>
      </div>

      {/* Real Messaging Gateways & Outbound Webhooks */}
      {webhooksData && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="rounded-xl border border-[#CED6CC] bg-white p-5 space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#5A655D]">
                SMS Messaging Gateway
              </span>
              <p className="text-base font-semibold text-[#17372E]">
                {webhooksData.gateways.sms.status === 'configured'
                  ? `Active: ${webhooksData.gateways.sms.provider}`
                  : 'Mock Fallback Active (Live Gateway Unconfigured)'}
              </p>
              <p className="text-xs text-[#4A554E] font-mono-tabular">
                {webhooksData.gateways.sms.provider}
              </p>
            </div>
            <div className="rounded-xl border border-[#CED6CC] bg-white p-5 space-y-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-[#5A655D]">
                Email Transactional Gateway
              </span>
              <p className="text-base font-semibold text-[#17372E]">
                {webhooksData.gateways.email.status === 'configured'
                  ? `Active: ${webhooksData.gateways.email.provider}`
                  : 'Mock Fallback Active (Live Gateway Unconfigured)'}
              </p>
              <p className="text-xs text-[#4A554E] font-mono-tabular">
                {webhooksData.gateways.email.provider}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Webhook className="h-4 w-4 text-[#B77B50]" />
                <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
                  Outbound Event Webhooks (HMAC-SHA256 Signed · SSRF Protected)
                </h3>
              </div>
            </div>

            <form onSubmit={handleCreateWebhook} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type="text"
                required
                value={whName}
                onChange={(e) => setWhName(e.target.value)}
                placeholder="Webhook Label (e.g. District Welfare Sync)"
                className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
              />
              <input
                type="text"
                required
                value={whUrl}
                onChange={(e) => setWhUrl(e.target.value)}
                placeholder="https://... or sandbox://demo-receiver"
                className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm font-mono-tabular"
              />
              <button
                type="submit"
                className="rounded-lg bg-[#17372E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E473C]"
              >
                Register Webhook
              </button>
            </form>

            <div className="flex flex-wrap gap-3 text-xs text-[#4A554E]">
              {[
                'APPLICATION_SUBMITTED',
                'APPLICATION_APPROVED',
                'CASE_ESCALATED',
                'HIGH_RISK_SCAM_DETECTED',
              ].map((ev) => (
                <label key={ev} className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={whEvents.includes(ev)}
                    onChange={(e) =>
                      setWhEvents((prev) =>
                        e.target.checked ? [...prev, ev] : prev.filter((x) => x !== ev)
                      )
                    }
                  />
                  <span className="font-mono-tabular">{ev}</span>
                </label>
              ))}
            </div>

            {createdWebhookSecret && (
              <div className="rounded-lg border border-[#17372E]/40 bg-[#DCE6DA]/50 p-3 text-xs">
                <strong className="text-[#17372E]">Signing Secret (shown once): </strong>
                <code className="font-mono-tabular">{createdWebhookSecret}</code>
              </div>
            )}

            <div className="divide-y divide-[#CED6CC] text-xs">
              {webhooksData.webhooks.map((hook: any) => (
                <div key={hook.id} className="py-3 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold text-[#17372E]">{hook.name}</p>
                    <p className="font-mono-tabular text-[#5A655D]">
                      {hook.targetUrl} · {hook.secretMasked}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      disabled={whTestingId === hook.id}
                      onClick={() => handleTestWebhook(hook.id)}
                      className="inline-flex items-center gap-1 rounded border border-[#17372E] px-3 py-1.5 font-semibold text-[#17372E] hover:bg-[#DCE6DA]/40 disabled:opacity-50"
                    >
                      <Send className="h-3 w-3" />
                      <span>{whTestingId === hook.id ? 'Sending...' : 'Send Test Event'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteWebhook(hook.id)}
                      className="text-[#A94F40] hover:underline flex items-center gap-1"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {webhooksData.deliveries.length > 0 && (
              <div className="border-t border-[#CED6CC] pt-3 space-y-2">
                <h4 className="text-xs font-semibold text-[#5A655D]">Recent Webhook Deliveries</h4>
                <div className="space-y-1.5 max-h-48 overflow-y-auto text-xs font-mono-tabular">
                  {webhooksData.deliveries.map((d: any) => (
                    <div key={d.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#CED6CC]/50 pb-1.5">
                      <span>
                        <strong className="text-[#17372E]">{d.eventType}</strong> · HTTP {d.responseStatus} · {d.latencyMs}ms
                      </span>
                      <span className={d.success ? 'text-[#17372E]' : 'text-[#A94F40]'}>
                        {d.errorMessage || (d.success ? 'Delivered' : 'Failed')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Mock Identity Registry Table */}
      <div className="rounded-xl border border-[#CED6CC] bg-white overflow-hidden">
        <div className="border-b border-[#CED6CC] bg-[#FAF7F0] px-5 py-3">
          <h3 className="text-sm font-semibold text-[#17372E]">
            Mock Identity Adapter (Synthetic NADRA-Style Records — Not Official)
          </h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-start text-xs">
            <thead className="border-b border-[#CED6CC] text-[#5A655D]">
              <tr>
                <th className="px-4 py-2.5 text-start">Full Name</th>
                <th className="px-4 py-2.5 text-start">Masked CNIC</th>
                <th className="px-4 py-2.5 text-start">Age</th>
                <th className="px-4 py-2.5 text-start">Registry Income</th>
                <th className="px-4 py-2.5 text-start">District</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#CED6CC]">
              {mockRegistry.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-medium">{r.fullName}</td>
                  <td className="px-4 py-2.5 font-mono-tabular">{r.cnicMasked}</td>
                  <td className="px-4 py-2.5 font-mono-tabular">{r.age}</td>
                  <td className="px-4 py-2.5 font-mono-tabular">
                    Rs {r.monthlyIncome.toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">{r.district}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
