import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, RotateCcw, Send, Square, Volume2, VolumeX, X } from 'lucide-react';
import { apiFetch } from '../lib/apiClient.ts';
import { Lang } from '../lib/i18n.ts';

type VoiceState = 'idle' | 'listening' | 'processing' | 'responding' | 'error';

interface VoiceAssistantProps {
  lang: Lang;
  onToggleLang: (next: Lang) => void;
  onNavigateTab: (tab: string) => void;
  externalSpeakRequest?: { text: string; lang: Lang; nonce: number } | null;
}

const QUICK_PROMPTS: Record<Lang, string[]> = {
  ur: [
    'میری درخواست چیک کریں',
    'کون سے کاغذات چاہئیں؟',
    'جعلی میسج کیسے پہچانیں؟',
  ],
  en: [
    'Check my application',
    'What documents do I need?',
    'How do I spot a fake SMS?',
  ],
};

function base64ToBlobUrl(base64: string, mimeType: string): string {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType || 'audio/wav' });
  return URL.createObjectURL(blob);
}

export const VoiceAssistant: React.FC<VoiceAssistantProps> = ({
  lang,
  onToggleLang,
  onNavigateTab,
  externalSpeakRequest,
}) => {
  const [open, setOpen] = useState(false);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [consentGranted, setConsentGranted] = useState(false);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState('');
  const [reply, setReply] = useState('');
  const [citations, setCitations] = useState<Array<{ code: string; titleEn: string; titleUr: string }>>([]);
  const [replyLang, setReplyLang] = useState<Lang>(lang);
  const [textInput, setTextInput] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [levels, setLevels] = useState<number[]>([0.15, 0.2, 0.15, 0.25, 0.15, 0.2, 0.15]);
  const [supportNote, setSupportNote] = useState('');

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioUrlRef = useRef<string | null>(null);
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const stopAudioPlayback = () => {
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch {
      // ignore
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setVoiceState((prev) => (prev === 'responding' ? 'idle' : prev));
  };

  const cleanupMic = () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setLevels([0.15, 0.2, 0.15, 0.25, 0.15, 0.2, 0.15]);
  };

  const speakText = async (textToSpeak: string, targetLang: Lang) => {
    if (muted || !textToSpeak.trim()) return;
    stopAudioPlayback();
    setErrorMsg('');
    setSupportNote('');
    setReplyLang(targetLang);
    setVoiceState('responding');

    try {
      // Fast local speech only for English when a real local English voice exists
      if (targetLang === 'en' && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        const enVoice = voices.find((v) => /^en/i.test(v.lang));
        if (enVoice) {
          const utter = new SpeechSynthesisUtterance(textToSpeak);
          utter.voice = enVoice;
          utter.lang = enVoice.lang;
          utter.rate = 0.96;
          utter.onend = () => setVoiceState('idle');
          utter.onerror = () => setVoiceState('idle');
          window.speechSynthesis.speak(utter);
          return;
        }
      }

      // Always synthesize Urdu (and English fallback) via Gemini TTS WAV endpoint
      const res = await apiFetch<{ audioBase64: string; mimeType: string }>('/api/ai/voice/tts', {
        method: 'POST',
        body: JSON.stringify({ text: textToSpeak, lang: targetLang }),
      });

      const objectUrl = base64ToBlobUrl(res.audioBase64, res.mimeType || 'audio/wav');
      audioUrlRef.current = objectUrl;
      const audio = new Audio(objectUrl);
      audioRef.current = audio;

      audio.onended = () => {
        setVoiceState('idle');
      };
      audio.onerror = () => {
        setVoiceState('error');
        setErrorMsg(
          targetLang === 'ur'
            ? 'آڈیو چلانے میں مسئلہ آیا۔ دوبارہ سنیں بٹن دبائیں۔'
            : 'Audio playback error. Please tap Repeat to listen.'
        );
      };

      try {
        await audio.play();
      } catch {
        setVoiceState('idle');
        setSupportNote(
          targetLang === 'ur'
            ? 'آواز سننے کے لیے نیچے "دوبارہ سنیں" بٹن دبائیں۔'
            : 'Browser blocked autoplay. Tap the Repeat icon below to listen.'
        );
      }
    } catch (err: any) {
      // Fallback to browser SpeechSynthesis ONLY if browser has an Urdu voice for ur
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        const prefix = targetLang === 'ur' ? /^ur/i : /^en/i;
        const matched = voices.find((v) => prefix.test(v.lang));
        if (matched) {
          const utter = new SpeechSynthesisUtterance(textToSpeak);
          utter.voice = matched;
          utter.lang = matched.lang;
          utter.onend = () => setVoiceState('idle');
          window.speechSynthesis.speak(utter);
          setSupportNote(
            targetLang === 'ur'
              ? 'سرور آڈیو دستیاب نہ ہونے پر براؤزر کی اردو آواز استعمال کی جا رہی ہے۔'
              : 'Using browser speech synthesis.'
          );
          return;
        }
      }

      setVoiceState('error');
      setErrorMsg(
        err?.message ||
          (targetLang === 'ur'
            ? 'اردو آواز تیار نہیں ہو سکی۔ براہ کرم انٹرنیٹ یا سرور چیک کریں۔'
            : 'Could not synthesize voice audio.')
      );
    }
  };

  useEffect(() => {
    if (externalSpeakRequest?.text) {
      setOpen(true);
      setReply(externalSpeakRequest.text);
      speakText(externalSpeakRequest.text, externalSpeakRequest.lang);
    }
  }, [externalSpeakRequest?.nonce]);

  useEffect(() => {
    return () => {
      cleanupMic();
      stopAudioPlayback();
    };
  }, []);

  const processQuery = async (spokenOrTyped: string, detectedLang: Lang = lang) => {
    const clean = spokenOrTyped.trim();
    if (!clean) return;
    setTranscript(clean);
    setVoiceState('processing');
    setErrorMsg('');
    setSupportNote('');

    try {
      const hasUrduChars = /[\u0600-\u06FF]/.test(clean);
      const effectiveLang: Lang = hasUrduChars ? 'ur' : detectedLang;

      const res = await apiFetch<{
        reply: string;
        detectedIntent: string;
        groundedInSystemRecords: boolean;
        citations?: Array<{ code: string; titleEn: string; titleUr: string }>;
      }>('/api/ai/assistant', {
        method: 'POST',
        body: JSON.stringify({ message: clean, lang: effectiveLang }),
      });

      setReply(res.reply);
      setCitations(Array.isArray(res.citations) ? res.citations : []);
      if (res.detectedIntent === 'navigate_apply') onNavigateTab('apply');
      else if (res.detectedIntent === 'navigate_cases') onNavigateTab('cases');
      else if (res.detectedIntent === 'navigate_scam') onNavigateTab('scam');
      else if (res.detectedIntent === 'navigate_data') onNavigateTab('data');
      else if (res.detectedIntent === 'switch_lang_ur') onToggleLang('ur');
      else if (res.detectedIntent === 'switch_lang_en') onToggleLang('en');

      const replyHasUrdu = /[\u0600-\u06FF]/.test(res.reply);
      const speakLang: Lang =
        res.detectedIntent === 'switch_lang_ur' || replyHasUrdu
          ? 'ur'
          : res.detectedIntent === 'switch_lang_en'
            ? 'en'
            : effectiveLang;

      await speakText(res.reply, speakLang);
    } catch (err: any) {
      setVoiceState('error');
      setErrorMsg(err.message || 'Voice assistant could not reach the AI service.');
    }
  };

  const startLiveWaveform = (stream: MediaStream) => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 32;
      source.connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteFrequencyData(data);
        const bars = Array.from({ length: 7 }, (_, i) => {
          const val = data[i * 2] || 0;
          return Math.max(0.15, Math.min(1, val / 180));
        });
        setLevels(bars);
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch {
      // waveform visualization unsupported
    }
  };

  const startMediaRecorder = (stream: MediaStream, targetLang: Lang) => {
    if (typeof MediaRecorder === 'undefined') {
      cleanupMic();
      setVoiceState('error');
      setErrorMsg(
        targetLang === 'ur'
          ? 'آڈیو ریکارڈنگ اس براؤزر میں دستیاب نہیں۔ براہ کرم نیچے ٹائپ کریں۔'
          : 'Audio recording is not supported in this browser. Please use text input.'
      );
      return;
    }

    setSupportNote(
      targetLang === 'ur'
        ? 'سرور اردو اسپیچ ٹرانسکرپشن فعال ہے — بولنے کے بعد "رک جائیں" دبائیں۔'
        : 'Using server audio transcription — press Stop Listening when finished speaking.'
    );
    const recorder = new MediaRecorder(stream);
    mediaRecorderRef.current = recorder;
    const chunks: Blob[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunks.push(e.data);
    };
    recorder.onstop = async () => {
      cleanupMic();
      setVoiceState('processing');
      try {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        const buf = await blob.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let bin = '';
        for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
        const base64 = btoa(bin);
        const tr = await apiFetch<{ transcript: string; detectedLang: 'ur' | 'en' }>(
          '/api/ai/voice/transcribe',
          {
            method: 'POST',
            body: JSON.stringify({
              audioBase64: base64,
              mimeType: blob.type || 'audio/webm',
              langHint: targetLang,
            }),
          }
        );
        if (tr.transcript) {
          await processQuery(tr.transcript, tr.detectedLang);
        } else {
          setVoiceState('idle');
        }
      } catch (err: any) {
        setVoiceState('error');
        setErrorMsg(err.message || 'Audio transcription failed.');
      }
    };
    recorder.start();
  };

  const startListening = async () => {
    if (!consentGranted) {
      setErrorMsg(
        lang === 'ur'
          ? 'مائیکروفون استعمال کرنے سے پہلے براہ کرم نیچے اجازت دیں۔'
          : 'Please confirm microphone consent below before recording.'
      );
      return;
    }

    stopAudioPlayback();
    setErrorMsg('');
    setSupportNote('');
    setVoiceState('listening');

    const SpeechRec =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      startLiveWaveform(stream);

      if (SpeechRec) {
        const rec = new SpeechRec();
        recognitionRef.current = rec;
        rec.lang = lang === 'ur' ? 'ur-PK' : 'en-US';
        rec.interimResults = true;
        rec.maxAlternatives = 1;

        let finalTranscript = '';
        let fellBackToRecorder = false;

        rec.onresult = (event: any) => {
          let interim = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const txt = event.results[i][0].transcript;
            if (event.results[i].isFinal) finalTranscript += txt + ' ';
            else interim += txt;
          }
          setTranscript((finalTranscript + interim).trim());
        };
        rec.onerror = (evt: any) => {
          const code = evt?.error || '';
          if (
            (code === 'language-not-supported' ||
              code === 'network' ||
              code === 'service-not-allowed') &&
            streamRef.current &&
            !fellBackToRecorder
          ) {
            fellBackToRecorder = true;
            startMediaRecorder(streamRef.current, lang);
            return;
          }
          cleanupMic();
          setVoiceState('error');
          setErrorMsg(
            lang === 'ur'
              ? 'آواز سنائی نہیں دی۔ براہ کرم دوبارہ بولیں یا نیچے ٹائپ کریں۔'
              : 'Could not capture speech clearly. Try again or type below.'
          );
        };
        rec.onend = () => {
          if (fellBackToRecorder) return;
          cleanupMic();
          if (finalTranscript.trim()) {
            processQuery(finalTranscript.trim(), lang);
          } else {
            setVoiceState((prev) => (prev === 'listening' ? 'idle' : prev));
          }
        };
        rec.start();
      } else {
        startMediaRecorder(stream, lang);
      }
    } catch {
      cleanupMic();
      setVoiceState('error');
      setErrorMsg(
        lang === 'ur'
          ? 'مائیکروفون کی اجازت مسترد کر دی گئی۔ براہ کرم ٹائپ کر کے پوچھیں۔'
          : 'Microphone permission denied. Please allow access or use the text input.'
      );
    }
  };

  const stopListening = () => {
    try {
      recognitionRef.current?.stop();
    } catch {
      // ignore
    }
    try {
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    } catch {
      // ignore
    }
  };

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 end-5 z-40 flex items-center gap-2.5 rounded-full bg-[#17372E] px-5 py-3.5 text-sm font-semibold text-[#F4EFE5] shadow-lg hover:bg-[#1E473C] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B77B50]"
        aria-label={lang === 'ur' ? 'وائس اسسٹنٹ کھولیں' : 'Open Voice Assistant'}
      >
        <Mic className="h-5 w-5 text-[#B77B50]" />
        <span>{lang === 'ur' ? 'آواز سے مدد' : 'Voice Help'}</span>
      </button>
    );
  }

  return (
    <div
      dir={lang === 'ur' ? 'rtl' : 'ltr'}
      className="fixed bottom-5 end-5 z-40 w-[min(94vw,420px)] rounded-xl border border-[#CED6CC] bg-[#FAF7F0] text-[#202923] shadow-2xl overflow-hidden"
      role="region"
      aria-label="Voice Assistant"
    >
      <div className="flex items-center justify-between border-b border-[#CED6CC] bg-[#17372E] px-4 py-3 text-[#F4EFE5]">
        <div className="flex items-center gap-2">
          <Mic className="h-4 w-4 text-[#B77B50]" />
          <span className="text-sm font-semibold">
            {lang === 'ur' ? 'مدد ڈیسک وائس اسسٹنٹ' : 'Madad Desk Voice Assistant'}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              if (!muted) stopAudioPlayback();
              setMuted(!muted);
            }}
            className="rounded p-1.5 hover:bg-white/10"
            title={muted ? 'Unmute' : 'Mute'}
            aria-label={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
          </button>
          <button
            onClick={() => {
              stopListening();
              stopAudioPlayback();
              setOpen(false);
            }}
            className="rounded p-1.5 hover:bg-white/10"
            aria-label="Close voice assistant"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        <div className="flex items-center justify-between text-xs text-[#5A655D]">
          <span>
            {lang === 'ur' ? 'حالت:' : 'State:'}{' '}
            <strong className="text-[#17372E] capitalize">{voiceState}</strong>
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onToggleLang('ur')}
              className={`px-2.5 py-1 rounded text-xs font-medium ${
                lang === 'ur' ? 'bg-[#17372E] text-white' : 'bg-[#DCE6DA] text-[#17372E]'
              }`}
            >
              اردو
            </button>
            <button
              onClick={() => onToggleLang('en')}
              className={`px-2.5 py-1 rounded text-xs font-medium ${
                lang === 'en' ? 'bg-[#17372E] text-white' : 'bg-[#DCE6DA] text-[#17372E]'
              }`}
            >
              EN
            </button>
          </div>
        </div>

        {/* Live Microphone Waveform */}
        <div className="flex h-12 items-center justify-center gap-1.5 rounded-lg border border-[#CED6CC] bg-white px-4">
          {levels.map((lv, idx) => (
            <div
              key={idx}
              style={{ height: `${Math.round(lv * 36)}px` }}
              className={`w-1.5 rounded-full transition-all duration-75 ${
                voiceState === 'listening'
                  ? 'bg-[#B77B50]'
                  : voiceState === 'responding'
                    ? 'bg-[#17372E]'
                    : 'bg-[#CED6CC]'
              }`}
            />
          ))}
        </div>

        {!consentGranted && (
          <label className="flex items-start gap-2 rounded-lg border border-[#CED6CC] bg-[#DCE6DA]/35 p-3 text-xs text-[#202923] cursor-pointer">
            <input
              type="checkbox"
              checked={consentGranted}
              onChange={(e) => setConsentGranted(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              {lang === 'ur'
                ? 'میں صرف اس سوال کے لیے مائیکروفون آڈیو پروسیس کرنے کی اجازت دیتا ہوں (کوئی مستقل ریکارڈنگ محفوظ نہیں ہوتی)۔'
                : 'I consent to process microphone audio for this request (audio is not retained permanently).'}
            </span>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {voiceState === 'listening' ? (
            <button
              onClick={stopListening}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#A94F40] px-4 py-2.5 text-sm font-semibold text-white"
            >
              <Square className="h-4 w-4" />
              <span>{lang === 'ur' ? 'رک جائیں' : 'Stop Listening'}</span>
            </button>
          ) : (
            <button
              onClick={startListening}
              disabled={voiceState === 'processing'}
              className="flex-1 flex items-center justify-center gap-2 rounded-lg bg-[#17372E] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1E473C] disabled:opacity-50"
            >
              {consentGranted ? <Mic className="h-4 w-4" /> : <MicOff className="h-4 w-4" />}
              <span>
                {voiceState === 'processing'
                  ? lang === 'ur'
                    ? 'سمجھ رہا ہوں...'
                    : 'Processing...'
                  : lang === 'ur'
                    ? 'بولیں'
                    : 'Tap to Speak'}
              </span>
            </button>
          )}

          {voiceState === 'responding' && (
            <button
              onClick={stopAudioPlayback}
              className="rounded-lg border border-[#CED6CC] bg-white px-3 py-2.5 text-xs font-semibold text-[#202923]"
            >
              {lang === 'ur' ? 'آواز بند' : 'Stop Audio'}
            </button>
          )}

          {reply && voiceState !== 'responding' && (
            <button
              onClick={() => speakText(reply, replyLang)}
              className="flex items-center gap-1 rounded-lg border border-[#CED6CC] bg-white px-2.5 py-2.5 text-xs font-semibold text-[#17372E]"
              title={lang === 'ur' ? 'دوبارہ سنیں' : 'Repeat'}
              aria-label="Repeat response"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{lang === 'ur' ? 'سنیں' : 'Listen'}</span>
            </button>
          )}
        </div>

        {/* Quick prompts */}
        <div className="flex flex-wrap gap-1.5">
          {QUICK_PROMPTS[lang].map((qp) => (
            <button
              key={qp}
              type="button"
              disabled={voiceState === 'processing'}
              onClick={() => processQuery(qp, lang)}
              className="rounded-lg border border-[#CED6CC] bg-white px-2.5 py-1 text-[11px] font-medium text-[#17372E] hover:bg-[#DCE6DA]/50 disabled:opacity-50"
            >
              {qp}
            </button>
          ))}
        </div>

        {supportNote && <p className="text-[11px] text-[#5A655D]">{supportNote}</p>}
        {errorMsg && (
          <p className="rounded bg-[#A94F40]/10 p-2 text-xs text-[#A94F40]">{errorMsg}</p>
        )}

        {transcript && (
          <div className="rounded-lg border border-[#CED6CC] bg-white p-2.5 text-xs">
            <span className="text-[#5A655D] block mb-0.5">
              {lang === 'ur' ? 'آپ نے کہا:' : 'Transcript:'}
            </span>
            <p className="text-[#202923] font-medium">{transcript}</p>
          </div>
        )}

        {reply && (
          <div className="rounded-lg border border-[#17372E]/25 bg-[#DCE6DA]/35 p-3 text-sm leading-relaxed text-[#202923] space-y-2">
            <p>{reply}</p>
            {citations.length > 0 && (
              <div className="border-t border-[#17372E]/15 pt-2 space-y-1">
                <span className="block text-[10px] font-semibold uppercase tracking-wide text-[#5A655D]">
                  {replyLang === 'ur' ? 'پالیسی حوالہ جات (RAG):' : 'Policy RAG Citations:'}
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {citations.slice(0, 3).map((c) => (
                    <span
                      key={c.code}
                      className="rounded border border-[#CED6CC] bg-white px-2 py-0.5 text-[10px] font-mono-tabular text-[#17372E]"
                    >
                      {c.code}: {replyLang === 'ur' ? c.titleUr : c.titleEn}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!textInput.trim()) return;
            const msg = textInput;
            setTextInput('');
            processQuery(msg, lang);
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={
              lang === 'ur'
                ? 'ٹائپ کریں: مثلاً "میری درخواست چیک کریں"'
                : 'Type e.g. "Check my application" or "What documents do I need?"'
            }
            className="flex-1 rounded-lg border border-[#CED6CC] bg-white px-3 py-2 text-xs focus:outline-none focus:border-[#17372E]"
          />
          <button
            type="submit"
            disabled={voiceState === 'processing' || !textInput.trim()}
            className="rounded-lg bg-[#B77B50] px-3 py-2 text-white hover:bg-[#a06942] disabled:opacity-50"
            aria-label="Send question"
          >
            <Send className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
};
