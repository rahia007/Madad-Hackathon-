import React, { useEffect, useState } from 'react';
import { BookOpen, PlusCircle, Search, Volume2 } from 'lucide-react';
import { apiFetch } from '../lib/apiClient.ts';
import { Lang } from '../lib/i18n.ts';

interface PolicyRagExplorerProps {
  lang: Lang;
  canPublish?: boolean;
  onSpeakText?: (text: string) => void;
}

export const PolicyRagExplorer: React.FC<PolicyRagExplorerProps> = ({
  lang,
  canPublish = false,
  onSpeakText,
}) => {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [question, setQuestion] = useState('');
  const [asking, setAsking] = useState(false);
  const [ragAnswer, setRagAnswer] = useState<any>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  // Admin circular form
  const [code, setCode] = useState('');
  const [titleEn, setTitleEn] = useState('');
  const [titleUr, setTitleUr] = useState('');
  const [category, setCategory] = useState('eligibility');
  const [contentEn, setContentEn] = useState('');
  const [contentUr, setContentUr] = useState('');
  const [publishing, setPublishing] = useState(false);

  const loadDocs = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ docs: any[] }>('/api/policy/docs');
      setDocs(res.docs || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDocs();
  }, []);

  const handleAsk = async (qOverride?: string) => {
    const q = (qOverride ?? question).trim();
    if (!q) return;
    if (qOverride) setQuestion(qOverride);
    setAsking(true);
    setError('');
    try {
      const res = await apiFetch('/api/policy/ask', {
        method: 'POST',
        body: JSON.stringify({ question: q, lang }),
      });
      setRagAnswer(res);
    } catch (err: any) {
      setError(err.message || 'Policy lookup failed.');
    } finally {
      setAsking(false);
    }
  };

  const handlePublishDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    setPublishing(true);
    try {
      await apiFetch('/api/policy/docs', {
        method: 'POST',
        body: JSON.stringify({
          code,
          titleEn,
          titleUr,
          category,
          contentEn,
          contentUr,
        }),
      });
      setNotice(`Policy circular ${code.toUpperCase()} published and indexed for RAG citations.`);
      setCode('');
      setTitleEn('');
      setTitleUr('');
      setContentEn('');
      setContentUr('');
      await loadDocs();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="border-b border-[#CED6CC] pb-5">
        <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
          {lang === 'ur' ? 'سرکاری امدادی پالیسی رہنما (RAG)' : 'Policy Handbook & Semantic RAG Citations'}
        </h2>
        <p className="text-sm text-[#4A554E] mt-1">
          {lang === 'ur'
            ? 'مدد ڈیسک کے سرکاری پالیسی سرکلرز میں سے سوال پوچھیں اور اصل سیکشن کوڈ کے ساتھ جواب حاصل کریں۔'
            : 'Ask questions grounded directly in Madad Desk relief policy circulars using Gemini vector embeddings + bilingual lexical retrieval with section citations.'}
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

      {/* Ask RAG Box */}
      <div className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
            placeholder={
              lang === 'ur'
                ? 'پوچھیں: مثلاً بیوہ خواتین یا شناختی کارڈ نہ ہونے پر کیا قانون ہے؟'
                : 'Ask e.g. "What happens if my CNIC is missing or blurry?" or "Are widows prioritized?"'
            }
            className="flex-1 min-w-[240px] rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-4 py-3 text-sm focus:outline-none focus:border-[#17372E]"
          />
          <button
            type="button"
            disabled={asking || !question.trim()}
            onClick={() => handleAsk()}
            className="inline-flex items-center gap-2 rounded-lg bg-[#17372E] px-5 py-3 text-sm font-semibold text-white hover:bg-[#1E473C] disabled:opacity-50"
          >
            <Search className="h-4 w-4" />
            <span>{asking ? (lang === 'ur' ? 'تلاش جاری...' : 'Searching RAG...') : lang === 'ur' ? 'پالیسی پوچھیں' : 'Ask Policy RAG'}</span>
          </button>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          {(lang === 'ur'
            ? [
                'ماہانہ آمدن کی حد کیا ہے؟',
                'شناختی کارڈ نہ ہو تو کیا ہوگا؟',
                'دھوکہ دہی والے ایس ایم ایس کی پہچان؟',
              ]
            : [
                'What is the monthly income limit?',
                'What if applicant has no CNIC?',
                'How does human-only rejection work?',
              ]
          ).map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => handleAsk(q)}
              className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-1.5 text-[#17372E] hover:border-[#17372E]"
            >
              {q}
            </button>
          ))}
        </div>

        {ragAnswer && (
          <div className="rounded-xl border border-[#17372E]/30 bg-[#FAF7F0] p-5 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm leading-relaxed text-[#202923]">{ragAnswer.answer}</p>
              {onSpeakText && ragAnswer.answer && (
                <button
                  type="button"
                  onClick={() => onSpeakText(ragAnswer.answer)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-[#B77B50] px-3 py-1.5 text-xs font-semibold text-white shrink-0"
                >
                  <Volume2 className="h-3.5 w-3.5" />
                  <span>{lang === 'ur' ? 'سنیں' : 'Listen'}</span>
                </button>
              )}
            </div>

            {ragAnswer.citations?.length > 0 && (
              <div className="space-y-2 border-t border-[#CED6CC] pt-3">
                <p className="text-xs font-semibold text-[#5A655D]">
                  {lang === 'ur' ? 'استعمال شدہ پالیسی سیکشنز:' : 'Grounded Policy Citations:'}
                </p>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {ragAnswer.citations.map((c: any) => (
                    <div key={c.code} className="rounded-lg border border-[#CED6CC] bg-white p-3 space-y-1 text-xs">
                      <div className="flex items-center justify-between font-mono-tabular">
                        <span className="font-bold text-[#17372E]">{c.code}</span>
                        <span className="text-[#B77B50]">score {(c.score * 100).toFixed(0)}%</span>
                      </div>
                      <p className="font-semibold text-[#202923]">
                        {lang === 'ur' ? c.titleUr : c.titleEn}
                      </p>
                      <p className="text-[#4A554E] leading-relaxed">
                        {lang === 'ur' ? c.excerptUr : c.excerptEn}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Admin circular editor */}
      {canPublish && (
        <form onSubmit={handlePublishDoc} className="rounded-xl border border-[#CED6CC] bg-white p-6 space-y-4">
          <div className="flex items-center gap-2">
            <PlusCircle className="h-4 w-4 text-[#B77B50]" />
            <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
              Publish / Update Policy Circular (Live RAG Index)
            </h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <input
              type="text"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Code (e.g. POL-8171-07)"
              className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm font-mono-tabular"
            />
            <input
              type="text"
              required
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
              placeholder="English Circular Title"
              className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
            />
            <input
              type="text"
              required
              value={titleUr}
              onChange={(e) => setTitleUr(e.target.value)}
              placeholder="اردو عنوان"
              className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
            >
              <option value="eligibility">eligibility</option>
              <option value="documents">documents</option>
              <option value="priority">priority</option>
              <option value="safety">safety</option>
              <option value="privacy">privacy</option>
            </select>
            <textarea
              rows={2}
              required
              value={contentEn}
              onChange={(e) => setContentEn(e.target.value)}
              placeholder="Policy text in English..."
              className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
            />
            <textarea
              rows={2}
              required
              value={contentUr}
              onChange={(e) => setContentUr(e.target.value)}
              placeholder="پالیسی کا متن اردو میں..."
              className="rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={publishing}
            className="rounded-lg bg-[#17372E] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1E473C] disabled:opacity-50"
          >
            {publishing ? 'Publishing...' : 'Publish Policy Circular'}
          </button>
        </form>
      )}

      {/* Handbook Directory */}
      <div className="rounded-xl border border-[#CED6CC] bg-white overflow-hidden">
        <div className="border-b border-[#CED6CC] bg-[#FAF7F0] px-5 py-3 flex items-center gap-2">
          <BookOpen className="h-4 w-4 text-[#17372E]" />
          <h3 className="text-sm font-semibold text-[#17372E]">
            {lang === 'ur' ? `موجودہ پالیسی سرکلرز (${docs.length})` : `Active Relief Policy Handbook (${docs.length})`}
          </h3>
        </div>
        {loading ? (
          <p className="p-6 text-sm text-[#5A655D]">Loading handbook...</p>
        ) : (
          <div className="divide-y divide-[#CED6CC]">
            {docs.map((d) => (
              <div key={d.id} className="p-5 space-y-1.5">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-mono-tabular font-bold text-[#17372E]">
                    {d.code} · {d.category}
                  </span>
                  <span className="font-mono-tabular text-[#5A655D]">
                    {d.hasEmbedding ? 'Vector Indexed' : 'Lexical + Lazy Vector'}
                  </span>
                </div>
                <h4 className="font-editorial text-base font-semibold text-[#202923]">
                  {lang === 'ur' ? d.titleUr : d.titleEn}
                </h4>
                <p className="text-sm text-[#4A554E] leading-relaxed">
                  {lang === 'ur' ? d.contentUr : d.contentEn}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
