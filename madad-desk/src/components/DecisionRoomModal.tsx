import React, { useEffect, useState } from 'react';
import { Bot, FileText, Play, ShieldAlert, UserCheck, X } from 'lucide-react';
import { apiFetch } from '../lib/apiClient.ts';
import { Lang, ROUTE_LABELS, STATUS_LABELS } from '../lib/i18n.ts';
import { ConfidenceGauge } from './ConfidenceGauge.tsx';

interface DecisionRoomModalProps {
  applicationId: number;
  lang: Lang;
  onClose: () => void;
}

export const DecisionRoomModal: React.FC<DecisionRoomModalProps> = ({
  applicationId,
  lang,
  onClose,
}) => {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agentRunning, setAgentRunning] = useState(false);
  const [agentLive, setAgentLive] = useState<any>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setAgentLive(null);
    apiFetch(`/api/ai/decision/${applicationId}`)
      .then((res) => {
        if (active) setData(res);
      })
      .catch((err) => {
        if (active) setError(err.message || 'Unable to load decision trace');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [applicationId]);

  const handleRunAgent = async () => {
    setAgentRunning(true);
    setError('');
    try {
      const res = await apiFetch(`/api/ai/agent/triage/${applicationId}`, {
        method: 'POST',
      });
      setAgentLive(res);
    } catch (err: any) {
      setError(err.message || 'Agent triage failed.');
    } finally {
      setAgentRunning(false);
    }
  };

  const app = data?.application;
  const dec = data?.decision;
  const rule = data?.ruleUsed;
  const docs = data?.documents || [];
  const history = data?.history || [];
  const savedRun = data?.agentRun;

  let savedSteps: any[] = [];
  if (agentLive?.steps) {
    savedSteps = agentLive.steps;
  } else if (savedRun?.stepsJson) {
    try {
      savedSteps = JSON.parse(savedRun.stepsJson);
    } catch {
      savedSteps = [];
    }
  }

  let traceList: string[] = [];
  if (dec?.traceJson) {
    try {
      traceList = JSON.parse(dec.traceJson);
    } catch {
      traceList = [];
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#202923]/60 p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="AI Decision Room"
    >
      <div className="w-full max-w-3xl rounded-xl border border-[#CED6CC] bg-[#FAF7F0] text-[#202923] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[#CED6CC] bg-[#FAF7F0] px-6 py-4">
          <div>
            <p className="text-xs font-medium text-[#5A655D]">
              {lang === 'ur' ? 'اے آئی فیصلے کی وضاحت' : 'AI Decision Room · Evidence & Rule Trace'}
            </p>
            <h3 className="font-editorial text-xl font-semibold text-[#17372E]">
              {app ? `${app.caseCode} — ${app.applicantName}` : 'Loading case...'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-[#CED6CC] p-2 text-[#202923] hover:bg-[#DCE6DA]/50 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {loading && <p className="text-sm text-[#5A655D]">Loading decision trace...</p>}
          {error && (
            <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-4 text-sm text-[#A94F40]">
              {error}
            </div>
          )}

          {app && dec && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 border-b border-[#CED6CC] pb-5 text-sm">
                <div>
                  <span className="block text-xs text-[#5A655D]">Status</span>
                  <span className="font-semibold text-[#17372E]">
                    {STATUS_LABELS[app.status]?.[lang] || app.status}
                  </span>
                </div>
                <div>
                  <span className="block text-xs text-[#5A655D]">Routing Outcome</span>
                  <span className="font-semibold text-[#B77B50]">
                    {ROUTE_LABELS[dec.route]?.[lang] || dec.route}
                  </span>
                </div>
                <div>
                  <span className="block text-xs text-[#5A655D]">Policy Version</span>
                  <span className="font-mono-tabular font-semibold">v{dec.ruleVersion}</span>
                </div>
                <div>
                  <span className="block text-xs text-[#5A655D]">Mock Registry Match</span>
                  <span className="font-medium">
                    {app.matchedRegistryName || 'No match'}
                  </span>
                </div>
              </div>

              <ConfidenceGauge
                confidence={dec.confidence}
                askBelow={rule?.askBelow ?? 0.6}
                autoThreshold={rule?.autoThreshold ?? 0.909}
                costWrong={rule?.costWrong ?? 10}
                costSlow={rule?.costSlow ?? 1}
                lang={lang}
              />

              <div className="rounded-lg border border-[#CED6CC] bg-white p-4 space-y-2">
                <h4 className="text-sm font-semibold text-[#17372E]">
                  {lang === 'ur' ? 'سادہ الفاظ میں وجہ' : 'Plain-Language Explanation'}
                </h4>
                <p className="text-sm leading-relaxed text-[#202923]">
                  {lang === 'ur' ? dec.aiSummaryUr || dec.whyUr : dec.aiSummaryEn || dec.whyEn}
                </p>
                <p className="text-xs text-[#5A655D] pt-1">
                  Engine: <span className="font-mono-tabular">{dec.aiModel}</span> · Deterministic Policy Eligible:{' '}
                  <strong>{dec.deterministicEligible ? 'Yes' : 'No (Escalated to Human)'}</strong>
                </p>
              </div>

              {/* Tool-Calling Agent Audit Section */}
              <div className="rounded-xl border border-[#17372E]/30 bg-white p-5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Bot className="h-4 w-4 text-[#B77B50]" />
                    <h4 className="text-sm font-semibold text-[#17372E]">
                      {lang === 'ur'
                        ? 'خودکار ٹول کالنگ ٹرائیاج ایجنٹ'
                        : 'Autonomous Multi-Tool Triage Agent (Function Calling)'}
                    </h4>
                  </div>
                  <button
                    type="button"
                    onClick={handleRunAgent}
                    disabled={agentRunning}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#17372E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1E473C] disabled:opacity-50"
                  >
                    <Play className="h-3.5 w-3.5" />
                    <span>
                      {agentRunning
                        ? lang === 'ur'
                          ? 'ایجنٹ جانچ رہا ہے...'
                          : 'Running 4 Verification Tools...'
                        : savedSteps.length > 0
                          ? lang === 'ur'
                            ? 'دوبارہ ایجنٹ چلائیں'
                            : 'Re-Run Triage Agent'
                          : lang === 'ur'
                            ? 'ٹرائیاج ایجنٹ چلائیں'
                            : 'Run Triage Agent'}
                    </span>
                  </button>
                </div>

                {savedSteps.length === 0 ? (
                  <p className="text-xs text-[#5A655D]">
                    {lang === 'ur'
                      ? 'یہ ایجنٹ خودکار طور پر شناخت، ڈپلیکیٹ کیس، پالیسی مینوئل اور اہلیت کے اصول چیک کر کے مکمل ٹریس محفوظ کرتا ہے۔'
                      : 'Runs live multi-turn Gemini FunctionDeclaration calls across Identity Lookup, Duplicate Claim Check, Policy Manual RAG, and Eligibility Scoring.'}
                  </p>
                ) : (
                  <div className="space-y-2.5 pt-1">
                    {(agentLive?.finalRecommendationEn || savedRun?.finalDecision) && (
                      <div className="rounded-lg border border-[#B77B50]/40 bg-[#FAF7F0] p-3 text-xs space-y-1">
                        <p className="font-semibold text-[#17372E]">
                          Agent Summary ({agentLive?.model || savedRun?.model}):
                        </p>
                        <p className="text-[#202923]">
                          {lang === 'ur' && agentLive?.finalRecommendationUr
                            ? agentLive.finalRecommendationUr
                            : agentLive?.finalRecommendationEn || savedRun?.finalDecision}
                        </p>
                      </div>
                    )}
                    <div className="space-y-2">
                      {savedSteps.map((st: any) => (
                        <div
                          key={st.step}
                          className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] p-3 text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between font-mono-tabular">
                            <span className="font-bold text-[#17372E]">
                              Step {st.step}: {st.toolName}()
                            </span>
                            <span className="text-[#5A655D]">{st.durationMs}ms</span>
                          </div>
                          <pre className="overflow-x-auto text-[11px] font-mono-tabular text-[#313D35] whitespace-pre-wrap">
                            {JSON.stringify(st.result, null, 2)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-[#17372E] mb-2">
                  Deterministic Evaluation Trace
                </h4>
                <ul className="space-y-1.5 text-sm text-[#313D35] border border-[#CED6CC] rounded-lg bg-white p-4">
                  {traceList.map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="font-mono-tabular text-xs text-[#B77B50] mt-0.5">
                        {String(i + 1).padStart(2, '0')}.
                      </span>
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {dec.humanDecision && (
                <div className="rounded-lg border border-[#17372E]/30 bg-[#DCE6DA]/50 p-4 space-y-1">
                  <div className="flex items-center gap-2 text-sm font-semibold text-[#17372E]">
                    <UserCheck className="h-4 w-4" />
                    <span>Human Officer Decision: {dec.humanDecision.replace(/_/g, ' ')}</span>
                  </div>
                  <p className="text-sm text-[#202923]">{dec.officerNote}</p>
                </div>
              )}

              <div>
                <h4 className="text-sm font-semibold text-[#17372E] mb-2">
                  Uploaded Documents & OCR Extraction ({docs.length})
                </h4>
                {docs.length === 0 ? (
                  <p className="text-sm text-[#5A655D]">No supporting documents uploaded yet.</p>
                ) : (
                  <div className="space-y-3">
                    {docs.map((doc: any) => {
                      let ext: any = null;
                      try {
                        ext = doc.extractionJson ? JSON.parse(doc.extractionJson) : null;
                      } catch {
                        ext = null;
                      }
                      return (
                        <div key={doc.id} className="rounded-lg border border-[#CED6CC] bg-white p-4 space-y-2 text-sm">
                          <div className="flex items-center justify-between gap-4">
                            <div className="flex items-center gap-2 font-medium">
                              <FileText className="h-4 w-4 text-[#17372E]" />
                              <span>{doc.originalName}</span>
                            </div>
                            <span className="text-xs font-mono-tabular text-[#5A655D]">
                              Tamper/Quality: {doc.tamperRisk}
                            </span>
                          </div>
                          {ext && (
                            <div className="text-xs text-[#4A554E] space-y-1 border-t border-[#CED6CC]/60 pt-2">
                              <p>
                                Extracted: {ext.documentType} · Name: {ext.extractedName || 'N/A'} · CNIC:{' '}
                                {ext.extractedCnicMasked || 'N/A'} · Income: {ext.extractedIncome ?? 'N/A'}
                              </p>
                              {ext.inconsistencies?.length > 0 && (
                                <p className="text-[#A94F40] flex items-center gap-1">
                                  <ShieldAlert className="h-3.5 w-3.5" />
                                  Inconsistencies: {ext.inconsistencies.join('; ')}
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-sm font-semibold text-[#17372E] mb-2">Case Timeline</h4>
                <div className="space-y-2 border-s border-[#CED6CC] ps-4">
                  {history.map((h: any) => (
                    <div key={h.id} className="text-sm">
                      <div className="flex items-center gap-2 text-xs text-[#5A655D]">
                        <span className="font-mono-tabular">
                          {new Date(h.createdAt).toLocaleString()}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-medium text-[#17372E]">{h.actorRole}</span>
                        <span aria-hidden="true">·</span>
                        <span>{h.toStatus}</span>
                      </div>
                      <p className="text-[#202923]">{h.note}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
