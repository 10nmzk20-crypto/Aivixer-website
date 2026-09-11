import { DISCOURAGED_PATTERNS, type TaskType } from "../principles";

/**
 * 施策の「仕組みスコア」を計算する。AI には計算させない。
 *
 *   （期待効果 × 資産性 × 自動化可能性）÷（初期工数 + 継続工数 × 12 か月 + 人的依存度）
 *
 * 分子は「将来も働き続ける度合い」、分母は「人間のエネルギー」。
 * スコアが大きいほど「人の仕事を増やさず、将来も働き続ける仕組み」に近い。
 */

export interface LeverageInput {
  /** 期待効果 1〜5 */
  impact: number;
  /** 資産性 1〜5（作ったものが残り続けるか） */
  asset: number;
  /** 自動化可能性 1〜5 */
  automation: number;
  /** 初期工数（時間） */
  initialHours: number;
  /** 継続工数（月あたりの時間） */
  ongoingHoursPerMonth: number;
  /** スタッフ依存度 1〜5 */
  staffDependency: number;
  /** 代表依存度 1〜5 */
  ownerDependency: number;
}

export interface LeverageResult {
  /** 仕組みスコア（大きいほど良い） */
  score: number;
  /** 1 年で人が使う時間（初期 + 継続 × 12） */
  yearHours: number;
  /** 人的依存度（スタッフ + 代表の平均） */
  dependency: number;
  /** 計算の内訳（画面と ChatGPT に見せる） */
  formula: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

export function computeLeverage(input: LeverageInput): LeverageResult {
  const impact = clamp(input.impact, 1, 5);
  const asset = clamp(input.asset, 1, 5);
  const automation = clamp(input.automation, 1, 5);
  const initial = Math.max(0, Number(input.initialHours) || 0);
  const ongoing = Math.max(0, Number(input.ongoingHoursPerMonth) || 0);
  const dependency = (clamp(input.staffDependency, 1, 5) + clamp(input.ownerDependency, 1, 5)) / 2;

  const yearHours = Math.round((initial + ongoing * 12) * 10) / 10;
  // 分母が 0 にならないよう 1 を足す。人的依存度は時間と同じ重みで効かせる
  const denominator = yearHours + dependency * 2 + 1;
  const score = Math.round(((impact * asset * automation) / denominator) * 100) / 100;

  return {
    score,
    yearHours,
    dependency: Math.round(dependency * 10) / 10,
    formula: `（効果 ${impact} × 資産性 ${asset} × 自動化 ${automation}）÷（初期 ${initial}h + 継続 ${ongoing}h × 12 + 人的依存 ${dependency} × 2 + 1）`,
  };
}

/**
 * 分類が入力と食い違っていないかを見る。
 * 継続工数が多いのに A（一度作れば働く）になっている、などを拾う。
 */
export function checkType(declared: TaskType, input: LeverageInput): { type: TaskType; note: string | null } {
  const ongoing = Math.max(0, Number(input.ongoingHoursPerMonth) || 0);
  // 月 4 時間以上（週 1 時間以上）人が動くなら、一度作れば働く仕組みとは言えない
  if (declared === "A" && ongoing >= 4) {
    return { type: "B", note: `継続工数が月 ${ongoing} 時間あるため、A ではなく B として扱います。` };
  }
  if (declared === "A" && input.staffDependency >= 4) {
    return { type: "B", note: "スタッフ依存度が高いため、A ではなく B として扱います。" };
  }
  if (declared === "B" && ongoing >= 12) {
    return { type: "C", note: `継続工数が月 ${ongoing} 時間あるため、B ではなく C として扱います。` };
  }
  return { type: declared, note: null };
}

/**
 * 憲法で「安易な第一提案にしない」としている内容が含まれていないかを見る。
 * 含まれていて、C 分類でも理由の記載も無い場合は注意を返す。
 */
export interface DiscouragedHit {
  id: string;
  label: string;
}

/**
 * 「〜より」「〜ではなく」のように、その手法をやらないと言っている文は数えない。
 * 「声かけを増やすより、自分で選べる状態を作る」を人手の施策と誤判定しないため。
 */
const NEGATION_RE = /(より|ではなく|では無く|でなく|ではない|しない|せずに|せず|増やさ|やめ|代わりに|避け|控え|不要|なくても|なしで|聞かなくて|安易に|前提にしない)/;

/** 文単位に切る。句点と改行で区切る */
function sentences(text: string): string[] {
  return text
    .split(/[。\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function findDiscouraged(text: string): DiscouragedHit[] {
  const hits = new Map<string, string>();
  for (const line of sentences(text)) {
    if (NEGATION_RE.test(line)) continue; // その手法を否定している文は対象外
    for (const p of DISCOURAGED_PATTERNS) {
      if (p.re.test(line)) hits.set(p.id, p.label);
    }
  }
  return [...hits].map(([id, label]) => ({ id, label }));
}

/** 画面に出す注意文。問題が無ければ null */
export function leverageWarning(opts: { type: TaskType; text: string; manualReason: string | null; ongoingHoursPerMonth: number }): string | null {
  const hits = findDiscouraged(opts.text);
  if (hits.length === 0) return null;
  const names = hits.map((h) => h.label).join("、");
  if (opts.type === "C" && opts.manualReason) return null; // C に分類し、理由も書かれていれば問題なし
  if (opts.type === "C") return `人が毎回動く内容（${names}）ですが、なぜ仕組み化できないかの説明がありません。`;
  return `人が毎回動く内容（${names}）が含まれていますが、${opts.type} に分類されています。分類と理由を確認してください。`;
}
