import React, { useEffect, useState } from 'react';
import { Download, Lock, ShieldAlert } from 'lucide-react';
import { apiFetch, getMemoryAuthToken } from '../../lib/apiClient.ts';
import { Lang } from '../../lib/i18n.ts';

interface AuditorPortalProps {
  lang: Lang;
}

export const AuditorPortal: React.FC<AuditorPortalProps> = ({ lang }) => {
  const [logs, setLogs] = useState<any[]>([]);
  const [consentEvents, setConsentEvents] = useState<any[]>([]);
  const [decisions, setDecisions] = useState<any[]>([]);
  const [severity, setSeverity] = useState('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ logs: any[]; consentEvents: any[]; decisions: any[] }>(
        `/api/audit?severity=${severity}`
      );
      setLogs(res.logs || []);
      setConsentEvents(res.consentEvents || []);
      setDecisions(res.decisions || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [severity]);

  const handleExportCsv = async () => {
    const token = getMemoryAuthToken();
    const res = await fetch('/api/audit/export', {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'madad-desk-audit-report.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#CED6CC] pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold text-[#5A655D]">
            <Lock className="h-3.5 w-3.5" />
            <span>Strictly Read-Only Compliance Access</span>
          </div>
          <h2 className="font-editorial text-3xl font-semibold text-[#17372E] mt-1">
            {lang === 'ur' ? 'آڈٹ اور جوابدہی لیجر' : 'Independent Audit & Decision Ledger'}
          </h2>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={severity}
            onChange={(e) => setSeverity(e.target.value)}
            className="rounded-lg border border-[#CED6CC] bg-white px-3 py-2 text-sm"
          >
            <option value="all">All Events</option>
            <option value="security">Security Events</option>
            <option value="warning">Policy & Consent Warnings</option>
            <option value="info">Standard Activity</option>
          </select>
          <button
            onClick={handleExportCsv}
            className="flex items-center gap-2 rounded-lg bg-[#17372E] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1E473C]"
          >
            <Download className="h-4 w-4" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-4 text-sm text-[#A94F40]">
          {error}
        </div>
      )}

      {/* System & Security Audit Trail */}
      <div className="rounded-xl border border-[#CED6CC] bg-white overflow-hidden">
        <div className="border-b border-[#CED6CC] bg-[#FAF7F0] px-5 py-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[#17372E]">
            Immutable Event Trail ({logs.length})
          </h3>
        </div>
        {loading ? (
          <div className="p-6 text-sm text-[#5A655D]">Loading audit records...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-start text-xs">
              <thead className="border-b border-[#CED6CC] text-[#5A655D]">
                <tr>
                  <th className="px-4 py-2.5 text-start">Timestamp</th>
                  <th className="px-4 py-2.5 text-start">Actor & Role</th>
                  <th className="px-4 py-2.5 text-start">Action</th>
                  <th className="px-4 py-2.5 text-start">Resource</th>
                  <th className="px-4 py-2.5 text-start">Detail</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CED6CC]">
                {logs.map((l) => (
                  <tr key={l.id} className={l.severity === 'security' ? 'bg-[#A94F40]/5' : ''}>
                    <td className="px-4 py-2.5 font-mono-tabular text-[#5A655D] whitespace-nowrap">
                      {new Date(l.createdAt).toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="font-semibold text-[#202923]">{l.actorLabel}</span>
                      <span className="text-[#5A655D] ms-1">({l.actorRole})</span>
                    </td>
                    <td className="px-4 py-2.5 font-mono-tabular font-semibold">
                      {l.severity === 'security' && (
                        <ShieldAlert className="inline h-3.5 w-3.5 text-[#A94F40] me-1" />
                      )}
                      <span className={l.severity === 'security' ? 'text-[#A94F40]' : 'text-[#17372E]'}>
                        {l.action}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 font-mono-tabular">
                      {l.resourceType} {l.resourceId ? `· ${l.resourceId}` : ''}
                    </td>
                    <td className="px-4 py-2.5 text-[#313D35]">{l.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* AI Decision Traces & Consent History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="rounded-xl border border-[#CED6CC] bg-white p-5 space-y-3">
          <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
            AI & Deterministic Decision Traces
          </h3>
          <div className="space-y-2.5 max-h-72 overflow-y-auto text-xs">
            {decisions.map((d) => (
              <div key={d.id} className="border-b border-[#CED6CC]/70 pb-2.5 space-y-1">
                <div className="flex justify-between font-mono-tabular">
                  <span className="font-semibold text-[#17372E]">
                    App #{d.applicationId} · Route: {d.route} · v{d.ruleVersion}
                  </span>
                  <span>Conf {(d.confidence * 100).toFixed(0)}%</span>
                </div>
                <p className="text-[#313D35]">{d.whyEn}</p>
                {d.humanDecision && (
                  <p className="text-[#B77B50] font-medium">
                    Officer Override: {d.humanDecision} — {d.officerNote}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-[#CED6CC] bg-white p-5 space-y-3">
          <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
            Citizen Consent Audit History
          </h3>
          <div className="space-y-2.5 max-h-72 overflow-y-auto text-xs">
            {consentEvents.map((c) => (
              <div key={c.id} className="border-b border-[#CED6CC]/70 pb-2">
                <div className="flex justify-between font-mono-tabular">
                  <span className="font-semibold">
                    Citizen #{c.citizenId} · {c.scope}
                  </span>
                  <span className={c.action === 'withdrawn' ? 'text-[#A94F40]' : 'text-[#17372E]'}>
                    {c.action}
                  </span>
                </div>
                <p className="text-[#5A655D]">
                  {new Date(c.createdAt).toLocaleString()} — {c.note}
                </p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
