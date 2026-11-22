export interface EligibilityRuleConfig {
  version: number;
  maxIncome: number;
  minAge: number;
  costWrong: number;
  costSlow: number;
  askBelow: number;
}

export interface RegistryCandidate {
  id?: number;
  fullName: string;
  cnicMasked: string;
  cnicHash: string;
  age: number;
  monthlyIncome: number;
  district?: string;
}

export interface ApplicationInput {
  name: string;
  cnicHash?: string;
  cnicMasked?: string;
  age?: number | null;
  monthlyIncome?: number | null;
}

export type DecisionRoute = 'auto' | 'docs' | 'human';

export interface ConfidenceFactor {
  label: string;
  delta: number;
  detail: string;
}

export interface EligibilityDecisionResult {
  route: DecisionRoute;
  confidence: number;
  autoThreshold: number;
  deterministicEligible: boolean;
  ruleVersion: number;
  matchedRegistryName: string | null;
  duplicateAmbiguity: boolean;
  missingFields: string[];
  trace: string[];
  factors: ConfidenceFactor[];
  whyEn: string;
  whyUr: string;
  msgEn: string;
  msgUr: string;
  urgencyScore: number;
}

export function computeAutoThreshold(rule: Pick<EligibilityRuleConfig, 'costWrong' | 'costSlow'>): number {
  const denom = rule.costWrong + rule.costSlow;
  if (denom <= 0) return 0.9;
  return Number((rule.costWrong / denom).toFixed(4));
}

export function normalizeName(name: string): string {
  return String(name || '')
    .toLowerCase()
    .replace(/\b(mohd|muhammed|mohammad|muhammad|mohamed|mohammed|md)\b/g, 'muhammad')
    .replace(/[^a-z ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function levenshtein(a: string, b: string): number {
  const m: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      m[i][j] = Math.min(
        m[i - 1][j] + 1,
        m[i][j - 1] + 1,
        m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
    }
  }
  return m[a.length][b.length];
}

export function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  return 1 - levenshtein(na, nb) / Math.max(na.length, nb.length);
}

export function evaluateEligibility(
  input: ApplicationInput,
  rule: EligibilityRuleConfig,
  registry: RegistryCandidate[]
): EligibilityDecisionResult {
  const autoThreshold = computeAutoThreshold(rule);
  const missingFields: string[] = [];
  if (!input.name || !input.name.trim()) missingFields.push('name');
  if (!input.cnicHash) missingFields.push('cnic');
  if (input.age === undefined || input.age === null || Number.isNaN(input.age)) missingFields.push('age');
  if (input.monthlyIncome === undefined || input.monthlyIncome === null || Number.isNaN(input.monthlyIncome)) {
    missingFields.push('income');
  }

  const trace: string[] = [
    `Rule v${rule.version}: monthly income ≤ Rs ${rule.maxIncome.toLocaleString()}, age ≥ ${rule.minAge}`,
    `Auto-approval requires confidence ≥ ${autoThreshold.toFixed(3)} (false approval cost ${rule.costWrong} vs delay cost ${rule.costSlow})`,
  ];
  const factors: ConfidenceFactor[] = [];

  if (missingFields.length > 0) {
    trace.push(`Missing fields: ${missingFields.join(', ')}`);
  }

  let matched: RegistryCandidate | undefined = input.cnicHash
    ? registry.find((r) => r.cnicHash === input.cnicHash)
    : undefined;
  let baseSim = 0;
  let duplicateAmbiguity = false;

  if (matched) {
    baseSim = input.name ? nameSimilarity(input.name, matched.fullName) : 0.7;
    trace.push(`CNIC hash matched mock registry record (${matched.cnicMasked}); name similarity ${baseSim.toFixed(2)}`);
    factors.push({
      label: 'Identity record match',
      delta: Number(baseSim.toFixed(2)),
      detail: `Exact ID match with ${matched.fullName} (name similarity ${(baseSim * 100).toFixed(0)}%)`,
    });
  } else if (input.name && input.name.trim()) {
    const candidates = registry
      .map((r) => ({ record: r, score: nameSimilarity(input.name, r.fullName) }))
      .filter((c) => c.score >= 0.8)
      .sort((a, b) => b.score - a.score);

    if (candidates.length > 1) {
      duplicateAmbiguity = true;
      trace.push(`Fuzzy name matched ${candidates.length} distinct registry records; refusing to guess`);
      factors.push({
        label: 'Duplicate identity ambiguity',
        delta: -0.35,
        detail: `${candidates.length} records share similar spelling without CNIC disambiguation`,
      });
    }
    if (candidates[0]) {
      matched = candidates[0].record;
      baseSim = candidates[0].score * 0.8;
      trace.push(`Fuzzy name candidate: ${matched.fullName} (adjusted match ${baseSim.toFixed(2)})`);
      if (!duplicateAmbiguity) {
        factors.push({
          label: 'Fuzzy name match (no CNIC)',
          delta: Number(baseSim.toFixed(2)),
          detail: `Matched ${matched.fullName} with 20% unverified-ID penalty`,
        });
      }
    } else {
      trace.push('No matching record found in mock identity registry');
      factors.push({
        label: 'No registry match',
        delta: 0,
        detail: 'No matching CNIC or high-similarity name found',
      });
    }
  }

  let conf = baseSim;
  if (missingFields.length > 0) {
    const penalty = 0.12 * missingFields.length;
    conf = conf * (1 - penalty);
    factors.push({
      label: 'Missing input fields',
      delta: -Number((baseSim * penalty).toFixed(2)),
      detail: `Penalty for missing: ${missingFields.join(', ')}`,
    });
  }

  if (
    matched &&
    input.monthlyIncome !== undefined &&
    input.monthlyIncome !== null &&
    matched.monthlyIncome > 0 &&
    Math.abs(input.monthlyIncome - matched.monthlyIncome) / matched.monthlyIncome > 0.2
  ) {
    conf -= 0.25;
    trace.push(
      `Reported income (Rs ${input.monthlyIncome.toLocaleString()}) differs >20% from registry record (Rs ${matched.monthlyIncome.toLocaleString()})`
    );
    factors.push({
      label: 'Income mismatch',
      delta: -0.25,
      detail: `Declared Rs ${input.monthlyIncome.toLocaleString()} vs registry Rs ${matched.monthlyIncome.toLocaleString()}`,
    });
  }

  if (duplicateAmbiguity) {
    conf = Math.min(conf, 0.45);
  }

  conf = Math.max(0, Math.min(1, Number(conf.toFixed(4))));

  const effectiveIncome = matched ? matched.monthlyIncome : (input.monthlyIncome ?? Number.MAX_SAFE_INTEGER);
  const effectiveAge = matched ? matched.age : (input.age ?? 0);
  const deterministicEligible =
    Boolean(matched) && effectiveIncome <= rule.maxIncome && effectiveAge >= rule.minAge;

  let route: DecisionRoute;
  if (!matched || duplicateAmbiguity || conf < rule.askBelow) {
    route = 'human';
  } else if (conf < autoThreshold) {
    route = 'docs';
  } else {
    route = deterministicEligible ? 'auto' : 'human';
  }

  if (matched && !deterministicEligible) {
    trace.push(
      `Record falls outside policy threshold (income Rs ${effectiveIncome.toLocaleString()} vs max Rs ${rule.maxIncome.toLocaleString()}, age ${effectiveAge} vs min ${rule.minAge}). Rejections are never automatic; routed to officer.`
    );
  }

  let whyEn: string;
  let whyUr: string;
  if (!matched) {
    whyEn = 'No matching identity record was found in the mock registry. An officer will review manually.';
    whyUr = 'شناختی ریکارڈ میں آپ کی معلومات نہیں ملیں۔ ایک افسر دستی طور پر جائزہ لے گا۔';
  } else if (duplicateAmbiguity) {
    whyEn = 'This name matches multiple people on record without a CNIC. Handed to an officer to prevent a wrong match.';
    whyUr = 'شناختی کارڈ نمبر کے بغیر یہ نام ایک سے زیادہ افراد سے ملتا ہے۔ غلط فیصلے سے بچنے کے لیے افسر جائزہ لے گا۔';
  } else if (!deterministicEligible) {
    whyEn = 'Income or age is outside the active rule limits. Automatic rejections are prohibited; an officer will verify.';
    whyUr = 'آمدن یا عمر موجودہ اصولوں کے مطابق نہیں۔ خودکار مستردگی نہیں ہوتی؛ افسر تصدیق کرے گا۔';
  } else if (conf < rule.askBelow) {
    whyEn = 'Record confidence is below the human-review threshold due to missing or conflicting details.';
    whyUr = 'نامکمل یا مختلف معلومات کے باعث اعتماد کم ہے۔ افسر آپ کے کیس کی جانچ کرے گا۔';
  } else if (conf < autoThreshold) {
    whyEn = 'Name or declared figures differ slightly from the registry. Please upload a clear CNIC or income proof.';
    whyUr = 'نام یا تفصیلات ریکارڈ سے تھوڑی مختلف ہیں۔ براہ کرم شناختی کارڈ یا آمدن کا واضح ثبوت اپ لوڈ کریں۔';
  } else {
    whyEn = 'Identity, income, and age match the active eligibility rule with high confidence.';
    whyUr = 'آپ کی شناخت، آمدن اور عمر موجودہ اصولوں کے عین مطابق ہیں۔';
  }

  const msgMap: Record<DecisionRoute, { en: string; ur: string }> = {
    auto: {
      en: 'Approved under active relief policy.',
      ur: 'منظور۔ آپ امداد کے اہل ہیں۔',
    },
    docs: {
      en: 'Additional proof needed. Please upload a clear photo of your CNIC or income slip.',
      ur: 'مزید ثبوت درکار ہے۔ براہ کرم شناختی کارڈ یا آمدن کی صاف تصویر اپ لوڈ کریں۔',
    },
    human: {
      en: 'Routed to a department officer for human review. No action needed right now.',
      ur: 'ایک محکمانہ افسر آپ کے کیس کا جائزہ لے گا۔ ابھی آپ کو کچھ کرنے کی ضرورت نہیں۔',
    },
  };

  // Higher urgency for elderly, low-income, or uncertain escalations
  let urgencyScore = 50;
  if (effectiveAge >= 60) urgencyScore += 20;
  if (effectiveIncome <= 15000) urgencyScore += 15;
  if (route === 'human') urgencyScore += 10;
  urgencyScore = Math.min(100, urgencyScore);

  return {
    route,
    confidence: conf,
    autoThreshold,
    deterministicEligible,
    ruleVersion: rule.version,
    matchedRegistryName: matched ? matched.fullName : null,
    duplicateAmbiguity,
    missingFields,
    trace,
    factors,
    whyEn,
    whyUr,
    msgEn: msgMap[route].en,
    msgUr: msgMap[route].ur,
    urgencyScore,
  };
}
