import React, { useState } from 'react';
import { signInWithPopup } from 'firebase/auth';
import { ArrowRight, ShieldCheck, Users } from 'lucide-react';
import { auth, googleAuthProvider } from '../lib/firebase.ts';
import { apiFetch, setMemoryAuthToken } from '../lib/apiClient.ts';
import { COPY, Lang, t } from '../lib/i18n.ts';

export interface AuthenticatedUser {
  id: number;
  email: string;
  displayName: string;
  role: 'citizen' | 'helper' | 'officer' | 'admin' | 'auditor';
  preferredLang: string;
  isDemoAccount?: boolean;
}

interface AuthGateProps {
  lang: Lang;
  onToggleLang: (next: Lang) => void;
  onAuthenticated: (user: AuthenticatedUser) => void;
}

export const AuthGate: React.FC<AuthGateProps> = ({
  lang,
  onToggleLang,
  onAuthenticated,
}) => {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [district, setDistrict] = useState('Karachi South');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [imgFailed, setImgFailed] = useState(false);

  const handleGoogleSignIn = async () => {
    setError('');
    setLoading(true);
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const idToken = await cred.user.getIdToken();
      setMemoryAuthToken(idToken);
      const me = await apiFetch<{ user: AuthenticatedUser }>('/api/auth/me');
      onAuthenticated(me.user);
    } catch (err: any) {
      setError(err.message || 'Google Sign-In did not complete.');
    } finally {
      setLoading(false);
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'register') {
        const res = await apiFetch<{ token: string; user: AuthenticatedUser }>(
          '/api/auth/register',
          {
            method: 'POST',
            body: JSON.stringify({
              email,
              password,
              displayName,
              district,
              preferredLang: lang,
            }),
          }
        );
        setMemoryAuthToken(res.token);
        onAuthenticated(res.user);
      } else {
        const res = await apiFetch<{ token: string; user: AuthenticatedUser }>(
          '/api/auth/login',
          {
            method: 'POST',
            body: JSON.stringify({ email, password }),
          }
        );
        setMemoryAuthToken(res.token);
        onAuthenticated(res.user);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleDemoLogin = async (
    role: 'citizen' | 'helper' | 'officer' | 'admin' | 'auditor'
  ) => {
    setError('');
    setLoading(true);
    try {
      const res = await apiFetch<{ token: string; user: AuthenticatedUser }>(
        '/api/auth/demo-login',
        {
          method: 'POST',
          body: JSON.stringify({ role }),
        }
      );
      setMemoryAuthToken(res.token);
      onAuthenticated(res.user);
    } catch (err: any) {
      setError(err.message || 'Demo login failed.');
    } finally {
      setLoading(false);
    }
  };

  const demoAccounts = [
    {
      role: 'citizen' as const,
      title: lang === 'ur' ? 'شہری (فاطمہ بی بی)' : 'Citizen Portal',
      sub: 'citizen.demo@madaddesk.pk · Apply, voice help, scam check, consent',
    },
    {
      role: 'helper' as const,
      title: lang === 'ur' ? 'کمیونٹی ہیلپر (نسرین)' : 'Community Helper',
      sub: 'helper.demo@madaddesk.pk · Shared phone, consent-gated families',
    },
    {
      role: 'officer' as const,
      title: lang === 'ur' ? 'محکمانہ افسر (طارق)' : 'Department Officer',
      sub: 'officer.demo@madaddesk.pk · Review queue, approve/reject, escalate',
    },
    {
      role: 'admin' as const,
      title: lang === 'ur' ? 'ایڈمنسٹریٹر (عائشہ)' : 'Administrator',
      sub: 'admin.demo@madaddesk.pk · Rule versions, Digital Twin, analytics',
    },
    {
      role: 'auditor' as const,
      title: lang === 'ur' ? 'آڈیٹر (کامران)' : 'Independent Auditor',
      sub: 'auditor.demo@madaddesk.pk · Read-only audit trail & CSV export',
    },
  ];

  return (
    <div className="min-h-screen bg-[#F4EFE5] text-[#202923] flex flex-col">
      <header className="border-b border-[#CED6CC] bg-[#FAF7F0] px-6 py-4 flex items-center justify-between gap-6">
        <span className="font-editorial text-xl font-bold text-[#17372E] whitespace-nowrap">
          {t(COPY.brand, lang)}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => onToggleLang(lang === 'ur' ? 'en' : 'ur')}
            className="rounded-lg border border-[#CED6CC] bg-white px-3.5 py-2 text-sm font-medium text-[#17372E] hover:bg-[#DCE6DA]/50 whitespace-nowrap"
          >
            {lang === 'ur' ? 'English' : 'اردو'}
          </button>
        </div>
      </header>

      <main className="flex-1 mx-auto w-full max-w-6xl px-6 py-10 grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
        <div className="lg:col-span-7 space-y-6">
          <div className="space-y-3">
            <p className="text-xs font-semibold tracking-wide text-[#B77B50]">
              {lang === 'ur'
                ? 'عوامی فلاحی پلیٹ فارم · پروٹوٹائپ ڈیمو'
                : 'Public Service Digital Infrastructure · Prototype Demonstration'}
            </p>
            <h1 className="font-editorial text-4xl sm:text-5xl font-semibold text-[#17372E] leading-tight">
              {t(COPY.tagline, lang)}
            </h1>
            <p className="text-base text-[#4A554E] leading-relaxed max-w-2xl">
              {t(COPY.prototypeNotice, lang)}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-[#CED6CC] bg-[#DCE6DA]/40 aspect-video">
            {!imgFailed ? (
              <img
                src="/src/assets/images/citizen_civic_banner_1795329992401.jpg"
                alt="Pakistani community digital service desk illustration"
                referrerPolicy="no-referrer"
                onError={() => setImgFailed(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              <div className="h-full w-full flex flex-col items-center justify-center p-8 text-center bg-gradient-to-br from-[#DCE6DA] to-[#F4EFE5]">
                <ShieldCheck className="h-12 w-12 text-[#17372E] mb-3" />
                <p className="font-editorial text-xl text-[#17372E]">
                  Madad Desk Civic Service Center
                </p>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-[#CED6CC] bg-[#FAF7F0] p-6 space-y-4">
            <div className="flex items-center gap-2 text-[#17372E]">
              <Users className="h-5 w-5 text-[#B77B50]" />
              <h2 className="font-editorial text-lg font-semibold">
                {lang === 'ur'
                  ? 'ڈیمو اکاؤنٹس (صرف آزمائش اور فرضی ڈیٹا کے لیے)'
                  : 'Demonstration Accounts (Synthetic Data Only)'}
              </h2>
            </div>
            <p className="text-xs text-[#5A655D]">
              {lang === 'ur'
                ? 'ہر بٹن سرور سے حقیقی کردار پر مبنی ٹوکن جاری کرتا ہے اور تمام اجازتیں بیک اینڈ پر چیک ہوتی ہیں۔'
                : 'Each button authenticates with a server-issued signed Bearer token bound to that role in PostgreSQL.'}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {demoAccounts.map((acc) => (
                <button
                  key={acc.role}
                  onClick={() => handleDemoLogin(acc.role)}
                  disabled={loading}
                  className="text-start rounded-lg border border-[#CED6CC] bg-white p-3.5 hover:border-[#17372E] hover:bg-[#DCE6DA]/25 transition-colors disabled:opacity-50"
                >
                  <div className="flex items-center justify-between font-semibold text-sm text-[#17372E]">
                    <span>{acc.title}</span>
                    <ArrowRight className="h-4 w-4 text-[#B77B50]" />
                  </div>
                  <p className="text-xs text-[#5A655D] mt-1">{acc.sub}</p>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-5 rounded-xl border border-[#CED6CC] bg-white p-6 sm:p-8 space-y-6">
          <div className="flex items-center gap-2 border-b border-[#CED6CC] pb-3">
            <button
              onClick={() => setMode('login')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg ${
                mode === 'login' ? 'bg-[#17372E] text-white' : 'text-[#5A655D] hover:text-[#17372E]'
              }`}
            >
              {lang === 'ur' ? 'سائن ان' : 'Sign In'}
            </button>
            <button
              onClick={() => setMode('register')}
              className={`px-3 py-1.5 text-sm font-semibold rounded-lg ${
                mode === 'register' ? 'bg-[#17372E] text-white' : 'text-[#5A655D] hover:text-[#17372E]'
              }`}
            >
              {lang === 'ur' ? 'شہری رجسٹریشن' : 'Citizen Register'}
            </button>
          </div>

          {error && (
            <div className="rounded-lg border border-[#A94F40]/40 bg-[#A94F40]/10 p-3 text-sm text-[#A94F40]">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 rounded-lg border border-[#17372E] bg-[#FAF7F0] px-4 py-3 text-sm font-semibold text-[#17372E] hover:bg-[#DCE6DA]/50 transition-colors disabled:opacity-50"
          >
            <span>{lang === 'ur' ? 'گوگل کے ذریعے سائن ان کریں' : 'Continue with Google'}</span>
          </button>

          <div className="relative flex items-center justify-center text-xs text-[#5A655D]">
            <span className="bg-white px-3">
              {lang === 'ur' ? 'یا ای میل اور پاس ورڈ' : 'or email & password'}
            </span>
            <div className="absolute inset-x-0 h-px bg-[#CED6CC] -z-10" />
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {mode === 'register' && (
              <>
                <div>
                  <label className="block text-sm font-medium text-[#202923] mb-1">
                    {lang === 'ur' ? 'پورا نام' : 'Full Name'}
                  </label>
                  <input
                    type="text"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="e.g. Zainab Khatoon"
                    className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#17372E]"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-[#202923] mb-1">
                    {lang === 'ur' ? 'ضلع' : 'District'}
                  </label>
                  <input
                    type="text"
                    value={district}
                    onChange={(e) => setDistrict(e.target.value)}
                    className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#17372E]"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-sm font-medium text-[#202923] mb-1">
                {lang === 'ur' ? 'ای میل' : 'Email'}
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="citizen@example.pk"
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#17372E]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#202923] mb-1">
                {lang === 'ur' ? 'پاس ورڈ' : 'Password'}
              </label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimum 8 characters"
                className="w-full rounded-lg border border-[#CED6CC] bg-[#FAF7F0] px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#17372E]"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-lg bg-[#17372E] px-4 py-3 text-sm font-semibold text-white hover:bg-[#1E473C] transition-colors disabled:opacity-50"
            >
              {loading
                ? lang === 'ur'
                  ? 'انتظار کریں...'
                  : 'Please wait...'
                : mode === 'register'
                  ? lang === 'ur'
                    ? 'شہری اکاؤنٹ بنائیں'
                    : 'Create Citizen Account'
                  : lang === 'ur'
                    ? 'لاگ ان کریں'
                    : 'Sign In'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
};
