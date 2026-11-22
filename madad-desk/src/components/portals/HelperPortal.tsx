import React, { useEffect, useState } from 'react';
import { Lock, Search, ShieldCheck, UserCheck } from 'lucide-react';
import { apiFetch } from '../../lib/apiClient.ts';
import { Lang } from '../../lib/i18n.ts';
import { CitizenPortal } from './CitizenPortal.tsx';

interface HelperPortalProps {
  activeTab: string;
  onTabChange: (tab: string) => void;
  lang: Lang;
  isOnline: boolean;
  simulatedOffline: boolean;
  onSpeakText: (text: string) => void;
}

export const HelperPortal: React.FC<HelperPortalProps> = ({
  activeTab,
  onTabChange,
  lang,
  isOnline,
  simulatedOffline,
  onSpeakText,
}) => {
  const [families, setFamilies] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedFamilyDetail, setSelectedFamilyDetail] = useState<any>(null);
  const [actingTarget, setActingTarget] = useState<{ citizenId: number; fullName: string } | null>(
    null
  );

  const loadFamilies = async () => {
    setLoading(true);
    try {
      const res = await apiFetch<{ families: any[] }>('/api/helper/families');
      setFamilies(res.families || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFamilies();
  }, []);

  const openFamilyProfile = async (citizenId: number, fullName: string) => {
    setError('');
    setSelectedFamilyDetail(null);
    try {
      // Server checks helperAssignments AND helper_access consent
      const res = await apiFetch(`/api/helper/families/${citizenId}`);
      setSelectedFamilyDetail(res);
      setActingTarget({ citizenId, fullName });
    } catch (err: any) {
      setError(err.message);
    }
  };

  if (activeTab !== 'families') {
    return (
      <CitizenPortal
        activeTab={activeTab}
        onTabChange={onTabChange}
        lang={lang}
        isOnline={isOnline}
        simulatedOffline={simulatedOffline}
        onSpeakText={onSpeakText}
        helperTargetCitizen={actingTarget}
      />
    );
  }

  const filtered = families.filter((f) =>
    f.fullName.toLowerCase().includes(search.trim().toLowerCase())
  );

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#CED6CC] pb-5">
        <div>
          <h2 className="font-editorial text-3xl font-semibold text-[#17372E]">
            {lang === 'ur' ? 'میرے خاندان (کمیونٹی ہیلپر)' : 'Assigned Families — Shared Phone Mode'}
          </h2>
          <p className="text-sm text-[#4A554E] mt-1">
            {lang === 'ur'
              ? 'ایک مشترکہ فون سے متعدد خاندانوں کی مدد کریں۔ ہر خاندان کی اجازت سرور پر الگ سے چیک ہوتی ہے۔'
              : 'Every family record requires active backend consent. Opening a profile without permission is blocked and logged.'}
          </p>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="h-4 w-4 text-[#5A655D] absolute start-3 top-3" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={lang === 'ur' ? 'خاندان تلاش کریں...' : 'Search families...'}
            className="w-full rounded-lg border border-[#CED6CC] bg-white ps-9 pe-3 py-2 text-sm"
          />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-4 text-sm text-[#A94F40] flex items-center gap-2">
          <Lock className="h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-7 rounded-xl border border-[#CED6CC] bg-white overflow-hidden">
          {loading ? (
            <div className="p-6 text-sm text-[#5A655D]">Loading assigned families...</div>
          ) : (
            <table className="w-full text-start text-sm">
              <thead className="border-b border-[#CED6CC] bg-[#FAF7F0] text-xs text-[#5A655D]">
                <tr>
                  <th className="px-4 py-3 text-start font-semibold">Family</th>
                  <th className="px-4 py-3 text-start font-semibold">Consent Status</th>
                  <th className="px-4 py-3 text-end font-semibold">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#CED6CC]">
                {filtered.map((f) => (
                  <tr key={f.citizenId} className="hover:bg-[#FAF7F0]/70">
                    <td className="px-4 py-3.5">
                      <div className="font-semibold text-[#17372E]">{f.fullName}</div>
                      <div className="text-xs font-mono-tabular text-[#5A655D]">
                        {f.cnicMasked} · {f.district}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      {f.helperConsentGranted ? (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#17372E]">
                          <ShieldCheck className="h-4 w-4" />
                          Permitted
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-semibold text-[#A94F40]">
                          <Lock className="h-4 w-4" />
                          Not permitted
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3.5 text-end">
                      <button
                        onClick={() => openFamilyProfile(f.citizenId, f.fullName)}
                        className="rounded-lg border border-[#17372E] px-3.5 py-1.5 text-xs font-semibold text-[#17372E] hover:bg-[#DCE6DA]/50"
                      >
                        {lang === 'ur' ? 'پروفائل کھولیں' : 'Open Record'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="lg:col-span-5 rounded-xl border border-[#CED6CC] bg-[#FAF7F0] p-6 space-y-4">
          {selectedFamilyDetail ? (
            <>
              <div className="flex items-center justify-between border-b border-[#CED6CC] pb-3">
                <div>
                  <p className="text-xs text-[#5A655D]">Authorized Family Profile</p>
                  <h3 className="font-editorial text-xl font-semibold text-[#17372E]">
                    {selectedFamilyDetail.family.fullName}
                  </h3>
                </div>
                <UserCheck className="h-5 w-5 text-[#17372E]" />
              </div>
              <dl className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <dt className="text-[#5A655D]">Masked CNIC</dt>
                  <dd className="font-mono-tabular font-semibold">
                    {selectedFamilyDetail.family.cnicMasked}
                  </dd>
                </div>
                <div>
                  <dt className="text-[#5A655D]">District</dt>
                  <dd className="font-semibold">{selectedFamilyDetail.family.district}</dd>
                </div>
                <div>
                  <dt className="text-[#5A655D]">Household Size</dt>
                  <dd className="font-mono-tabular">{selectedFamilyDetail.family.householdSize}</dd>
                </div>
                <div>
                  <dt className="text-[#5A655D]">Cases on Record</dt>
                  <dd className="font-mono-tabular">{selectedFamilyDetail.applications.length}</dd>
                </div>
              </dl>
              <button
                onClick={() => onTabChange('apply')}
                className="w-full rounded-lg bg-[#17372E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E473C]"
              >
                {lang === 'ur'
                  ? `${selectedFamilyDetail.family.fullName} کے لیے نئی درخواست دیں`
                  : `Apply on behalf of ${selectedFamilyDetail.family.fullName}`}
              </button>
            </>
          ) : (
            <p className="text-sm text-[#5A655D]">
              Select an assigned family to inspect their profile. Attempting to open a family without active consent will be rejected by the server and logged.
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
