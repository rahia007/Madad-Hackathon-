import React, { useEffect, useState } from 'react';
import { signOut } from 'firebase/auth';
import {
  Bell,
  Download,
  LogOut,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { auth } from './lib/firebase.ts';
import { apiFetch, setMemoryAuthToken } from './lib/apiClient.ts';
import { COPY, Lang, t } from './lib/i18n.ts';
import { useOnlineStatus, usePWAInstall } from './lib/usePWAInstall.ts';
import { AuthGate, AuthenticatedUser } from './components/AuthGate.tsx';
import { NotificationDrawer } from './components/NotificationDrawer.tsx';
import { VoiceAssistant } from './components/VoiceAssistant.tsx';
import { CitizenPortal } from './components/portals/CitizenPortal.tsx';
import { HelperPortal } from './components/portals/HelperPortal.tsx';
import { OfficerPortal } from './components/portals/OfficerPortal.tsx';
import { AdminPortal } from './components/portals/AdminPortal.tsx';
import { AuditorPortal } from './components/portals/AuditorPortal.tsx';

const ROLE_TABS: Record<AuthenticatedUser['role'], string[]> = {
  citizen: ['apply', 'cases', 'scam', 'policy', 'data'],
  helper: ['families', 'apply', 'cases', 'scam'],
  officer: ['queue'],
  admin: ['analytics', 'evaluation', 'rules', 'policy', 'services'],
  auditor: ['audit'],
};

export default function App() {
  const [user, setUser] = useState<AuthenticatedUser | null>(null);
  const [lang, setLang] = useState<Lang>('en');
  const [activeTab, setActiveTab] = useState<string>('apply');
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [speakRequest, setSpeakRequest] = useState<{
    text: string;
    lang: Lang;
    nonce: number;
  } | null>(null);
  const [showIOSInstall, setShowIOSInstall] = useState(false);

  const isOnline = useOnlineStatus();
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'ur' ? 'rtl' : 'ltr';
  }, [lang]);

  useEffect(() => {
    if (!user) return;
    const defaultTab = ROLE_TABS[user.role][0];
    setActiveTab(defaultTab);
    if (user.preferredLang === 'ur' || user.preferredLang === 'en') {
      setLang(user.preferredLang);
    }
    apiFetch<{ notifications: any[] }>('/api/notifications')
      .then((res) => {
        setUnreadCount((res.notifications || []).filter((n) => !n.isRead).length);
      })
      .catch(() => {});
  }, [user?.id]);

  const handleToggleLang = async (next: Lang) => {
    setLang(next);
    if (user) {
      try {
        await apiFetch('/api/auth/me', {
          method: 'PATCH',
          body: JSON.stringify({ preferredLang: next }),
        });
      } catch {
        // ignore if offline
      }
    }
  };

  const handleSignOut = async () => {
    setMemoryAuthToken(null);
    setUser(null);
    try {
      await signOut(auth);
    } catch {
      // ignore if session-based auth
    }
  };

  if (!user) {
    return (
      <AuthGate
        lang={lang}
        onToggleLang={handleToggleLang}
        onAuthenticated={(u) => setUser(u)}
      />
    );
  }

  const tabs = ROLE_TABS[user.role];
  const isWorkspaceSidebarRole =
    user.role === 'officer' || user.role === 'admin' || user.role === 'auditor';
  const effectiveOffline = !isOnline || simulatedOffline;

  return (
    <div className="min-h-screen bg-[#F4EFE5] text-[#202923] flex flex-col">
      {/* Top Bar (Strict 3-Zone Contract) */}
      <header className="sticky top-0 z-30 border-b border-[#CED6CC] bg-[#FAF7F0] px-4 sm:px-8 py-3.5 flex items-center justify-between gap-6">
        {/* Zone 1: Brand wordmark */}
        <span className="font-editorial text-xl font-bold text-[#17372E] whitespace-nowrap shrink-0">
          {t(COPY.brand, lang)}
        </span>

        {/* Zone 2: Concise single-line navigation links */}
        {!isWorkspaceSidebarRole && (
          <nav className="hidden md:flex items-center gap-6 text-sm font-medium text-[#4A554E]">
            {tabs.map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`whitespace-nowrap shrink-0 pb-0.5 transition-colors ${
                  activeTab === tab
                    ? 'text-[#17372E] font-semibold border-b-2 border-[#17372E]'
                    : 'hover:text-[#17372E]'
                }`}
              >
                {t(COPY.nav[tab as keyof typeof COPY.nav], lang)}
              </button>
            ))}
          </nav>
        )}

        {/* Zone 3: Account & Utility Controls */}
        <div className="flex items-center gap-2.5 shrink-0">
          <button
            onClick={() => setSimulatedOffline(!simulatedOffline)}
            className={`hidden sm:inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap ${
              effectiveOffline
                ? 'border-[#B77B50] bg-[#B77B50]/15 text-[#B77B50]'
                : 'border-[#CED6CC] bg-white text-[#4A554E]'
            }`}
            title="Toggle offline simulation to test IndexedDB queue"
          >
            {effectiveOffline ? <WifiOff className="h-3.5 w-3.5" /> : <Wifi className="h-3.5 w-3.5" />}
            <span>{effectiveOffline ? 'Offline' : 'Online'}</span>
          </button>

          {!isInstalled && isInstallable && (
            <button
              onClick={install}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-[#17372E] bg-white px-3 py-1.5 text-xs font-semibold text-[#17372E] whitespace-nowrap"
            >
              <Download className="h-3.5 w-3.5" />
              <span>Install App</span>
            </button>
          )}

          {!isInstalled && !isInstallable && isIOS && (
            <button
              onClick={() => setShowIOSInstall(true)}
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-[#CED6CC] bg-white px-3 py-1.5 text-xs font-medium text-[#17372E] whitespace-nowrap"
            >
              Install iOS
            </button>
          )}

          <button
            onClick={() => setShowNotifications(true)}
            className="relative rounded-lg border border-[#CED6CC] bg-white p-2 text-[#17372E] hover:bg-[#DCE6DA]/40"
            aria-label="Notifications"
          >
            <Bell className="h-4 w-4" />
            {unreadCount > 0 && (
              <span className="absolute -top-1.5 -end-1.5 rounded bg-[#A94F40] px-1 text-[10px] font-bold text-white tabular-nums">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            onClick={() => handleToggleLang(lang === 'ur' ? 'en' : 'ur')}
            className="rounded-lg border border-[#CED6CC] bg-white px-3 py-1.5 text-xs font-semibold text-[#17372E] whitespace-nowrap"
          >
            {lang === 'ur' ? 'English' : 'اردو'}
          </button>

          <button
            onClick={handleSignOut}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#17372E] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#1E473C] whitespace-nowrap"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>{lang === 'ur' ? 'خارج ہوں' : 'Sign Out'}</span>
          </button>
        </div>
      </header>

      {/* Mobile horizontal nav for Citizen/Helper */}
      {!isWorkspaceSidebarRole && (
        <div className="md:hidden border-b border-[#CED6CC] bg-[#FAF7F0] px-4 py-2 flex gap-2 overflow-x-auto">
          {tabs.map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`whitespace-nowrap shrink-0 rounded-lg px-3.5 py-2 text-xs font-semibold ${
                activeTab === tab
                  ? 'bg-[#17372E] text-white'
                  : 'border border-[#CED6CC] bg-white text-[#4A554E]'
              }`}
            >
              {t(COPY.nav[tab as keyof typeof COPY.nav], lang)}
            </button>
          ))}
        </div>
      )}

      {/* Offline Banner */}
      {effectiveOffline && (
        <div className="border-b border-[#B77B50]/40 bg-[#B77B50]/15 px-6 py-2.5 text-xs font-medium text-[#202923] flex items-center justify-center gap-2">
          <WifiOff className="h-4 w-4 text-[#B77B50]" />
          <span>
            {lang === 'ur'
              ? 'آف لائن موڈ: درخواستیں اس ڈیوائس پر محفوظ ہوں گی اور انٹرنیٹ آتے ہی سرور پر بھیجی جائیں گی۔'
              : 'Offline Mode — Submissions are queued locally in IndexedDB and will sync automatically when connectivity returns.'}
          </span>
        </div>
      )}

      {/* Role-Specific Workspace Body */}
      {isWorkspaceSidebarRole ? (
        <div className="flex-1 flex flex-col lg:flex-row">
          <aside className="lg:w-64 border-b lg:border-b-0 lg:border-e border-[#CED6CC] bg-[#FAF7F0] p-4 sm:p-6 space-y-6 shrink-0">
            <div className="space-y-1 border-b border-[#CED6CC] pb-4">
              <p className="text-xs text-[#5A655D]">Signed in ({user.role})</p>
              <p className="font-semibold text-sm text-[#17372E] truncate">{user.displayName}</p>
              <p className="text-[11px] font-mono-tabular text-[#5A655D] truncate">{user.email}</p>
            </div>
            <nav className="flex lg:flex-col gap-1.5 overflow-x-auto">
              {tabs.map((tab) => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`text-start whitespace-nowrap shrink-0 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${
                    activeTab === tab
                      ? 'bg-[#17372E] text-white font-semibold'
                      : 'text-[#4A554E] hover:bg-[#DCE6DA]/50 hover:text-[#17372E]'
                  }`}
                >
                  {t(COPY.nav[tab as keyof typeof COPY.nav], lang)}
                </button>
              ))}
            </nav>
            <p className="text-[11px] text-[#5A655D] leading-relaxed hidden lg:block">
              {t(COPY.prototypeNotice, lang)}
            </p>
          </aside>
          <main className="flex-1 p-6 sm:p-8 max-w-6xl w-full mx-auto">
            {user.role === 'officer' && <OfficerPortal lang={lang} />}
            {user.role === 'admin' && <AdminPortal activeTab={activeTab} lang={lang} />}
            {user.role === 'auditor' && <AuditorPortal lang={lang} />}
          </main>
        </div>
      ) : (
        <main className="flex-1 px-4 sm:px-8 py-8">
          <div className="max-w-5xl mx-auto mb-6 flex flex-wrap items-center justify-between gap-2 text-xs text-[#5A655D]">
            <span>
              {user.displayName} · {user.role === 'helper' ? 'Community Helper' : 'Citizen'}
            </span>
            <span>{t(COPY.prototypeNotice, lang)}</span>
          </div>

          {user.role === 'citizen' && (
            <CitizenPortal
              activeTab={activeTab}
              onTabChange={setActiveTab}
              lang={lang}
              isOnline={isOnline}
              simulatedOffline={simulatedOffline}
              onSpeakText={(txt) =>
                setSpeakRequest({ text: txt, lang, nonce: Date.now() })
              }
            />
          )}

          {user.role === 'helper' && (
            <HelperPortal
              activeTab={activeTab}
              onTabChange={setActiveTab}
              lang={lang}
              isOnline={isOnline}
              simulatedOffline={simulatedOffline}
              onSpeakText={(txt) =>
                setSpeakRequest({ text: txt, lang, nonce: Date.now() })
              }
            />
          )}
        </main>
      )}

      {/* Persistent Floating Voice Assistant */}
      <VoiceAssistant
        lang={lang}
        onToggleLang={handleToggleLang}
        onNavigateTab={(tab) => {
          if (tabs.includes(tab)) setActiveTab(tab);
        }}
        externalSpeakRequest={speakRequest}
      />

      {showNotifications && (
        <NotificationDrawer
          lang={lang}
          onClose={() => setShowNotifications(false)}
          onUnreadCountChange={setUnreadCount}
        />
      )}

      {showIOSInstall && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 space-y-3">
            <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
              Install Madad Desk on iPhone / iPad
            </h3>
            <p className="text-sm text-[#4A554E]">
              1. Tap the <strong>Share</strong> button in Safari.<br />
              2. Scroll down and tap <strong>Add to Home Screen</strong>.
            </p>
            <button
              onClick={() => setShowIOSInstall(false)}
              className="w-full rounded-lg bg-[#17372E] py-2 text-sm font-semibold text-white"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
