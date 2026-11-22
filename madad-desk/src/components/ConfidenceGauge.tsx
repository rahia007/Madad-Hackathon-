import React from 'react';
import { Lang } from '../lib/i18n.ts';

interface ConfidenceGaugeProps {
  confidence: number;
  askBelow: number;
  autoThreshold: number;
  costWrong?: number;
  costSlow?: number;
  lang: Lang;
}

export const ConfidenceGauge: React.FC<ConfidenceGaugeProps> = ({
  confidence,
  askBelow,
  autoThreshold,
  costWrong = 10,
  costSlow = 1,
  lang,
}) => {
  const pct = Math.max(0, Math.min(100, Math.round(confidence * 100)));
  const floorPct = Math.max(5, Math.min(90, Math.round(askBelow * 100)));
  const autoPct = Math.max(floorPct + 5, Math.min(98, Math.round(autoThreshold * 100)));

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between text-xs text-[#4A554E]">
        <span>
          {lang === 'ur' ? 'اعتماد کا اسکور اور حدود' : 'Confidence Score & Routing Thresholds'}
        </span>
        <span className="font-mono-tabular font-semibold text-[#17372E]">
          {(confidence * 100).toFixed(0)}% ({confidence.toFixed(2)})
        </span>
      </div>

      <div
        className="relative h-6 w-full overflow-hidden rounded border border-[#17372E]/30 bg-[#FAF7F0] flex"
        role="img"
        aria-label={`Confidence ${pct}%`}
      >
        <div
          style={{ width: `${floorPct}%` }}
          className="h-full bg-[#A94F40]/30 border-e border-[#17372E]/20"
          title="Human Review Zone"
        />
        <div
          style={{ width: `${autoPct - floorPct}%` }}
          className="h-full bg-[#B77B50]/35 border-e border-[#17372E]/20"
          title="Request Proof Zone"
        />
        <div
          style={{ width: `${100 - autoPct}%` }}
          className="h-full bg-[#17372E]/25"
          title="Auto-Approval Zone"
        />
        <div
          style={{ left: `calc(${pct}% - 2px)` }}
          className="absolute top-0 bottom-0 w-1 bg-[#17372E] transition-all duration-300"
        />
      </div>

      <div className="flex justify-between text-[11px] text-[#556159] tabular-nums">
        <span>
          {lang === 'ur'
            ? `انسانی جائزہ (< ${(askBelow * 100).toFixed(0)}%)`
            : `Officer Review (< ${(askBelow * 100).toFixed(0)}%)`}
        </span>
        <span>
          {lang === 'ur' ? 'ثبوت درکار' : 'Ask Proof'}
        </span>
        <span>
          {lang === 'ur'
            ? `خودکار (≥ ${(autoThreshold * 100).toFixed(1)}%)`
            : `Auto (≥ ${(autoThreshold * 100).toFixed(1)}%)`}
        </span>
      </div>

      <p className="text-xs text-[#5A655D] leading-relaxed">
        {lang === 'ur'
          ? `حساب: غلط منظوری کا نقصان (${costWrong}) ÷ (${costWrong} + تاخیر ${costSlow}) = ${(autoThreshold * 100).toFixed(1)}%۔ زیادہ اعتماد اہلیت کا ثبوت نہیں؛ اہلیت الگ اصولوں سے طے ہوتی ہے۔`
          : `Formula: ${costWrong} ÷ (${costWrong} + ${costSlow}) = ${(autoThreshold * 100).toFixed(1)}%. Confidence measures record match certainty only—it never overrides policy eligibility or auto-rejects.`}
      </p>
    </div>
  );
};
