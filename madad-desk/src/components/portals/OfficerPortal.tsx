import React, { useEffect, useState } from 'react';
import { Bot, Eye, ScanLine, Search, ShieldAlert } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient.ts';
import { Lang, ROUTE_LABELS, STATUS_LABELS } from '../../lib/i18n.ts';
import { ConfidenceGauge } from '../ConfidenceGauge.tsx';
import { DecisionRoomModal } from '../DecisionRoomModal.tsx';
import { QrVerifyModal } from '../QrSlipModal.tsx';

interface OfficerPortalProps {
  lang: Lang;
}

export const OfficerPortal: React.FC<OfficerPortalProps> = ({ lang }) => {
  const [queue, setQueue] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'confidence' | 'urgency'>('confidence');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [actionMsg, setActionMsg] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [decisionAppId, setDecisionAppId] = useState<number | null>(null);
  const [showQrVerify, setShowQrVerify] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [qRes, aRes] = await Promise.all([
        apiFetch<{ queue: any[] }>(
          `/api/review-queue?sort=${sortBy}&status=${statusFilter}&q=${encodeURIComponent(search)}`
        ),
        apiFetch('/api/admin/analytics'),
      ]);
      setQueue(qRes.queue || []);
      setAnalytics(aRes);
    } catch (err: any) {
      setErrorMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [sortBy, statusFilter]);

  const handleDecision = async (
    appId: number,
    decision: 'approve' | 'reject' | 'request_evidence' | 'escalate'
  ) => {
    setErrorMsg('');
    setActionMsg('');
    const note = (notes[appId] || '').trim();
    if (note.length < 3) {
      setErrorMsg('Please enter a mandatory justification note (at least 3 characters) before recording a decision.');
      return;
    }

    try {
      const res = await apiFetch<{ status: string; payoutResult?: any }>(
        `/api/applications/${appId}/review`,
        {
          method: 'POST',
          body: JSON.stringify({ decision, note }),
        }
      );
      setActionMsg(
        `Decision recorded (${res.status.replace(/_/g, ' ')}).${
          res.payoutResult
            ? ` Mock payment adapter: ${
                res.payoutResult.disbursed
                  ? `Simulated payout ${res.payoutResult.requestRef}`
                  : res.payoutResult.reason
              }`
            : ''
        }`
      );
      await load();
    } catch (err: any) {
      setErrorMsg(err.message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#CED6CC] pb-5">
        <div>
          <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
            {lang === 'ur' ? 'محکمانہ جائزہ قطار' : 'Department Officer Review Workspace'}
          </h2>
          <p className="text-sm text-[#4A554E] mt-1">
            Cases requiring human judgment. Rejections are never automatic; every officer action requires a written justification and writes to the audit log.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowQrVerify(true)}
          className="inline-flex items-center gap-2 rounded-lg border border-[#17372E] bg-white px-4 py-2.5 text-xs font-semibold text-[#17372E] hover:bg-[#DCE6DA]/50 shrink-0"
        >
          <ScanLine className="h-4 w-4 text-[#B77B50]" />
          <span>{lang === 'ur' ? 'کیو آر سلپ چیک کریں' : 'Scan / Verify Citizen QR Slip'}</span>
        </button>
      </div>

      {analytics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
            <span className="text-xs text-[#5A655D]">Submitted Cases</span>
            <p className="text-2xl font-semibold font-mono-tabular text-[#17372E] mt-1">
              {analytics.totals.applications}
            </p>
          </div>
          <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
            <span className="text-xs text-[#5A655D]">Awaiting Officer Action</span>
            <p className="text-2xl font-semibold font-mono-tabular text-[#B77B50] mt-1">
              {queue.filter((q) => ['in_review', 'needs_proof', 'escalated'].includes(q.status)).length}
            </p>
          </div>
          <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
            <span className="text-xs text-[#5A655D]">Human Escalation Rate</span>
            <p className="text-2xl font-semibold font-mono-tabular text-[#17372E] mt-1">
              {analytics.totals.humanEscalationRate}%
            </p>
          </div>
          <div className="rounded-xl border border-[#CED6CC] bg-white p-4">
            <span className="text-xs text-[#5A655D]">Active Policy</span>
            <p className="text-2xl font-semibold font-mono-tabular text-[#17372E] mt-1">
              v{analytics.activeRule?.version ?? 1}
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#CED6CC] bg-[#FAF7F0] p-4">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="h-4 w-4 text-[#5A655D] absolute start-3 top-2.5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
            placeholder="Search by case ID, applicant name, or district..."
            className="w-full rounded-lg border border-[#CED6CC] bg-white ps-9 pe-3 py-2 text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-[#CED6CC] bg-white px-3 py-2 text-sm"
        >
          <option value="pending">Pending Review & Proof</option>
          <option value="all">All Submitted Cases</option>
          <option value="in_review">In Review</option>
          <option value="needs_proof">Needs Proof</option>
          <option value="escalated">Escalated</option>
          <option value="approved_by_officer">Officer Approved</option>
          <option value="rejected">Rejected</option>
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as 'confidence' | 'urgency')}
          className="rounded-lg border border-[#CED6CC] bg-white px-3 py-2 text-sm"
        >
          <option value="confidence">Sort: Lowest Confidence First</option>
          <option value="urgency">Sort: Highest Urgency First</option>
        </select>
        <button
          onClick={load}
          className="rounded-lg bg-[#17372E] px-4 py-2 text-sm font-semibold text-white"
        >
          Filter
        </button>
      </div>

      {errorMsg && (
        <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-4 text-sm text-[#A94F40]">
          {errorMsg}
        </div>
      )}
      {actionMsg && (
        <div className="rounded-lg border border-[#17372E]/30 bg-[#DCE6DA]/50 p-4 text-sm text-[#17372E]">
          {actionMsg}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-[#5A655D]">Loading review queue...</p>
      ) : queue.length === 0 ? (
        <div className="rounded-xl border border-[#CED6CC] bg-white p-10 text-center text-sm text-[#5A655D]">
          No cases match the current filter.
        </div>
      ) : (
        <div className="space-y-4">
          {queue.map((item) => {
            let trace: string[] = [];
            try {
              trace = item.decision?.traceJson ? JSON.parse(item.decision.traceJson) : [];
            } catch {
              trace = [];
            }
            return (
              <div
                key={item.id}
                className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#CED6CC] pb-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-mono-tabular text-[#5A655D]">
                      <span className="font-semibold text-[#17372E]">{item.caseCode}</span>
                      <span aria-hidden="true">·</span>
                      <span>Rule v{item.ruleVersion}</span>
                      <span aria-hidden="true">·</span>
                      <span>Urgency {item.urgencyScore}/100</span>
                      <span aria-hidden="true">·</span>
                      <span>{item.district}</span>
                    </div>
                    <h3 className="font-editorial text-xl font-semibold text-[#17372E] mt-1">
                      {item.applicantName}
                    </h3>
                    <p className="text-xs font-mono-tabular text-[#5A655D]">
                      CNIC: {item.cnicMasked} · Declared Income: Rs{' '}
                      {item.monthlyIncome?.toLocaleString() ?? 'Missing'} · Age:{' '}
                      {item.age ?? 'Missing'} · Closest Registry: {item.matchedRegistryName || 'None'}
                    </p>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[#B77B50]">
                      {STATUS_LABELS[item.status]?.[lang] || item.status} ·{' '}
                      {ROUTE_LABELS[item.route]?.[lang] || item.route}
                    </span>
                    <button
                      onClick={() => setDecisionAppId(item.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-[#CED6CC] px-3 py-1.5 text-xs font-semibold text-[#17372E] hover:border-[#17372E]"
                    >
                      <Bot className="h-3.5 w-3.5 text-[#B77B50]" />
                      <Eye className="h-3.5 w-3.5" />
                      <span>Decision Room & Agent</span>
                    </button>
                  </div>
                </div>

                <ConfidenceGauge
                  confidence={item.confidence}
                  askBelow={analytics?.activeRule?.askBelow ?? 0.6}
                  autoThreshold={analytics?.activeRule?.autoThreshold ?? 0.909}
                  lang={lang}
                />

                {trace.length > 0 && (
                  <div className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] p-3.5 text-xs space-y-1">
                    {trace.map((line, i) => (
                      <p key={i} className="text-[#313D35]">
                        • {line}
                      </p>
                    ))}
                  </div>
                )}

                {item.documents?.some((d: any) => d.tamperRisk === 'review_needed' || d.tamperRisk === 'blurry') && (
                  <div className="flex items-center gap-2 text-xs text-[#A94F40]">
                    <ShieldAlert className="h-4 w-4" />
                    <span>Document scan flagged blurry image or inconsistency—check Decision Room.</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-3 pt-2">
                  <input
                    type="text"
                    value={notes[item.id] || ''}
                    onChange={(e) => setNotes({ ...notes, [item.id]: e.target.value })}
                    placeholder="Mandatory officer justification note..."
                    className="flex-1 rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3.5 py-2.5 text-sm"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() => handleDecision(item.id, 'approve')}
                      className="rounded-lg bg-[#17372E] px-4 py-2.5 text-xs font-semibold text-white hover:bg-[#1E473C]"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => handleDecision(item.id, 'request_evidence')}
                      className="rounded-lg border border-[#B77B50] px-3.5 py-2.5 text-xs font-semibold text-[#B77B50]"
                    >
                      Request Evidence
                    </button>
                    <button
                      onClick={() => handleDecision(item.id, 'escalate')}
                      className="rounded-lg border border-[#CED6CC] px-3.5 py-2.5 text-xs font-semibold text-[#202923]"
                    >
                      Escalate
                    </button>
                    <button
                      onClick={() => handleDecision(item.id, 'reject')}
                      className="rounded-lg border border-[#A94F40] px-3.5 py-2.5 text-xs font-semibold text-[#A94F40] hover:bg-[#A94F40]/10"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {decisionAppId && (
        <DecisionRoomModal
          applicationId={decisionAppId}
          lang={lang}
          onClose={() => setDecisionAppId(null)}
        />
      )}

      {showQrVerify && (
        <QrVerifyModal lang={lang} onClose={() => setShowQrVerify(false)} />
      )}
    </div>
  );
};
