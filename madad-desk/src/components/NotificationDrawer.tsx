import React, { useEffect, useState } from 'react';
import { Bell, Check, X } from 'lucide-react';
import { apiFetch } from '../lib/apiClient.ts';
import { Lang } from '../lib/i18n.ts';

interface NotificationDrawerProps {
  lang: Lang;
  onClose: () => void;
  onUnreadCountChange: (count: number) => void;
}

export const NotificationDrawer: React.FC<NotificationDrawerProps> = ({
  lang,
  onClose,
  onUnreadCountChange,
}) => {
  const [items, setItems] = useState<any[]>([]);
  const [prefs, setPrefs] = useState({ inApp: true, smsMock: true, emailMock: false });
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/notifications');
      setItems(res.notifications || []);
      setPrefs(res.preferences || { inApp: true, smsMock: true, emailMock: false });
      onUnreadCountChange((res.notifications || []).filter((n: any) => !n.isRead).length);
    } catch {
      // handled silently
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const markRead = async (id: number) => {
    await apiFetch(`/api/notifications/${id}/read`, { method: 'POST' });
    const next = items.map((i) => (i.id === id ? { ...i, isRead: true } : i));
    setItems(next);
    onUnreadCountChange(next.filter((n) => !n.isRead).length);
  };

  const togglePref = async (key: 'inApp' | 'smsMock' | 'emailMock') => {
    const next = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    await apiFetch('/api/notifications/preferences', {
      method: 'PATCH',
      body: JSON.stringify(next),
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-[#202923]/50"
      role="dialog"
      aria-modal="true"
      aria-label="Notifications"
    >
      <div className="w-full max-w-md bg-[#FAF7F0] h-full border-s border-[#CED6CC] flex flex-col">
        <div className="flex items-center justify-between border-b border-[#CED6CC] px-6 py-4">
          <div className="flex items-center gap-2">
            <Bell className="h-5 w-5 text-[#17372E]" />
            <h3 className="font-editorial text-lg font-semibold text-[#17372E]">
              {lang === 'ur' ? 'اطلاعات کا مرکز' : 'Notification Center'}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg border border-[#CED6CC] p-2 hover:bg-[#DCE6DA]/50"
            aria-label="Close notifications"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-[#CED6CC] bg-[#DCE6DA]/30 px-6 py-4 space-y-2 text-xs">
          <p className="font-semibold text-[#17372E]">
            {lang === 'ur' ? 'ترجیحات (ایس ایم ایس اور ای میل ماک ہیں)' : 'Delivery Preferences'}
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={prefs.inApp} onChange={() => togglePref('inApp')} />
              <span>In-App Alerts</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={prefs.smsMock} onChange={() => togglePref('smsMock')} />
              <span>SMS Gateway (Mock / Unavailable if unconfigured)</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={prefs.emailMock} onChange={() => togglePref('emailMock')} />
              <span>Email (Mock)</span>
            </label>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {loading ? (
            <p className="text-sm text-[#5A655D]">Loading notifications...</p>
          ) : items.length === 0 ? (
            <p className="text-sm text-[#5A655D]">
              {lang === 'ur' ? 'ابھی کوئی اطلاع نہیں ہے۔' : 'No notifications yet.'}
            </p>
          ) : (
            items.map((n) => (
              <div
                key={n.id}
                className={`rounded-lg border p-4 space-y-1.5 ${
                  n.isRead ? 'border-[#CED6CC] bg-white/70' : 'border-[#17372E]/40 bg-white'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h4 className="text-sm font-semibold text-[#17372E]">
                    {lang === 'ur' ? n.titleUr : n.titleEn}
                  </h4>
                  {!n.isRead && (
                    <button
                      onClick={() => markRead(n.id)}
                      className="text-xs text-[#17372E] hover:underline flex items-center gap-1 shrink-0"
                    >
                      <Check className="h-3.5 w-3.5" />
                      {lang === 'ur' ? 'پڑھ لیا' : 'Mark read'}
                    </button>
                  )}
                </div>
                <p className="text-sm text-[#313D35]">
                  {lang === 'ur' ? n.bodyUr : n.bodyEn}
                </p>
                <p className="text-[11px] font-mono-tabular text-[#5A655D]">
                  {new Date(n.createdAt).toLocaleString()} · {n.category}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
