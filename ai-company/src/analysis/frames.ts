import { FRAMES, FRAME_KEYS, FRAME_MARKS, type FrameKey, type FrameMark, type TaskType } from "../principles";

/**
 * 施策を 老子 / 孫子 / 孔子 の 3 軸で評価する。
 *
 * 評価はすべてここで計算する。AI に「◎です」と言わせない。
 * AI が答えるのは材料となる数字だけで、記号を決めるのはコード。
 * こうしておくと、同じ数字なら誰が見ても同じ評価になり、後から理由を説明できる。
 *
 *   老子軸 … 既存の数字（工数・資産性・自動化・自己解決・依存度）だけで判定できる
 *   孫子軸 … 競合との位置関係が必要なので、AI に 4 項目を答えさせる
 *   孔子軸 … 信頼に関わる 4 項目を AI に答えさせる
 */

export interface FrameInput {
  // ---- 老子軸（既存の数字を使う） ----
  taskType: TaskType;
  ongoingHoursPerMonth: number;
  asset: number;
  automation: number;
  selfService: number;
  staffDependency: number;
  ownerDependency: number;
  initialHours: number;

  // ---- 孫子軸 ----
  /** 大手と同じ土俵で戦っている度合い 1〜5（低いほど良い） */
  headOnCompetition: number;
  /** ViXer の強みを使えているか 1〜5 */
  usesStrength: number;
  /** 勝ちやすい顧客層を選べているか 1〜5 */
  winnableSegment: number;
  /** 価格競争になっているか */
  priceCompetition: boolean;

  // ---- 孔子軸 ----
  /** 顧客に誠実か・不安を減らすか 1〜5 */
  customerTrust: number;
  /** 社員の負担 1〜5（低いほど良い） */
  staffBurden: number;
  /** 長期的にブランド価値が上がるか 1〜5 */
  brandLongTerm: number;
  /** 短期利益偏重になっているか */
  shortTermBias: boolean;
}

export interface FrameResult {
  key: FrameKey;
  /** 軸の名前（老子 / 孫子 / 孔子） */
  label: string;
  /** その軸が何を見ているか */
  summary: string;
  mark: FrameMark;
  /** 満たしている条件 */
  met: string[];
  /** 満たしていない条件 */
  missed: string[];
  /** 上限をかけた理由。かけていなければ null */
  cap: string | null;
}

export interface FramesResult {
  laozi: FrameResult;
  sunzi: FrameResult;
  confucius: FrameResult;
  /** 3 軸の合計点（◎3 / ○2 / △1 / ×0。最大 9） */
  total: number;
  /** どれか 1 軸でも × があるか */
  hasReject: boolean;
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** 条件の並びから、満たした数で記号を決める */
function grade(conditions: Array<{ label: string; ok: boolean }>, thresholds: { good: number; ok: number; watch: number }): { mark: FrameMark; met: string[]; missed: string[] } {
  const met = conditions.filter((c) => c.ok).map((c) => c.label);
  const missed = conditions.filter((c) => !c.ok).map((c) => c.label);
  const n = met.length;
  const mark: FrameMark = n >= thresholds.good ? "◎" : n >= thresholds.ok ? "○" : n >= thresholds.watch ? "△" : "×";
  return { mark, met, missed };
}

/** 上限をかける。すでにそれ以下なら何もしない */
function capMark(mark: FrameMark, max: FrameMark): FrameMark {
  return FRAME_MARKS[mark].points > FRAME_MARKS[max].points ? max : mark;
}

/** 老子軸: 人が頑張らなくても自然に回るか */
function evaluateLaozi(i: FrameInput): FrameResult {
  const ongoing = Math.max(0, Number(i.ongoingHoursPerMonth) || 0);
  const conditions = [
    { label: "人が毎回動かなくてよい（継続工数が月 2 時間未満・スタッフ依存 2 以下）", ok: ongoing < 2 && clamp(i.staffDependency, 1, 5) <= 2 },
    { label: "一度作れば何度も働く（資産性 4 以上）", ok: clamp(i.asset, 1, 5) >= 4 },
    { label: "自動化できる（自動化 3 以上）", ok: clamp(i.automation, 1, 5) >= 3 },
    { label: "会員が自己解決できる（自己解決 4 以上）", ok: clamp(i.selfService, 1, 5) >= 4 },
    { label: "代表の判断を毎回必要としない（代表依存 2 以下）", ok: clamp(i.ownerDependency, 1, 5) <= 2 },
  ];
  const { mark, met, missed } = grade(conditions, { good: 5, ok: 4, watch: 2 });

  // C 分類は「毎回人が動く」ことが前提なので、数字が良くても老子軸には合わない
  let cap: string | null = null;
  let final = mark;
  if (i.taskType === "C") {
    final = capMark(mark, "△");
    if (final !== mark) cap = "毎回人が動く C 分類のため、△ を上限にしています。";
  }
  return { key: "laozi", label: FRAMES.laozi.label, summary: FRAMES.laozi.summary, mark: final, met, missed, cap };
}

/** 孫子軸: 競合と正面衝突せず、勝ちやすい場所を選べているか */
function evaluateSunzi(i: FrameInput): FrameResult {
  const headOn = clamp(i.headOnCompetition, 1, 5);
  const conditions = [
    { label: "大手と同じ土俵で戦っていない（正面衝突度 2 以下）", ok: headOn <= 2 },
    { label: "ViXer の強みを使えている（4 以上）", ok: clamp(i.usesStrength, 1, 5) >= 4 },
    { label: "勝ちやすい顧客層を選べている（4 以上）", ok: clamp(i.winnableSegment, 1, 5) >= 4 },
    { label: "価格競争になっていない", ok: !i.priceCompetition },
    { label: "広告費や人員の大量投入が要らない（初期工数 40 時間以下）", ok: Math.max(0, Number(i.initialHours) || 0) <= 40 },
  ];
  const { mark, met, missed } = grade(conditions, { good: 5, ok: 4, watch: 2 });

  let cap: string | null = null;
  let final = mark;
  if (i.priceCompetition) {
    final = capMark(mark, "△");
    if (final !== mark) cap = "価格競争になっているため、△ を上限にしています。";
  }
  if (headOn >= 4) {
    const capped = capMark(final, "△");
    if (capped !== final) cap = "大手と同じ土俵で戦っているため、△ を上限にしています。";
    final = capped;
  }
  return { key: "sunzi", label: FRAMES.sunzi.label, summary: FRAMES.sunzi.summary, mark: final, met, missed, cap };
}

/** 孔子軸: 短期の売上より、信頼が積み上がるか */
function evaluateConfucius(i: FrameInput): FrameResult {
  const burden = clamp(i.staffBurden, 1, 5);
  const conditions = [
    { label: "顧客に誠実で、不安を減らす（4 以上）", ok: clamp(i.customerTrust, 1, 5) >= 4 },
    { label: "社員の負担が過大でない（3 以下）", ok: burden <= 3 },
    { label: "長期的にブランド価値が上がる（4 以上）", ok: clamp(i.brandLongTerm, 1, 5) >= 4 },
    { label: "短期利益偏重になっていない", ok: !i.shortTermBias },
  ];
  const { mark, met, missed } = grade(conditions, { good: 4, ok: 3, watch: 2 });

  let cap: string | null = null;
  let final = mark;
  if (i.shortTermBias) {
    final = capMark(mark, "△");
    if (final !== mark) cap = "短期利益に偏っているため、△ を上限にしています。";
  }
  if (burden >= 4) {
    const capped = capMark(final, "△");
    if (capped !== final) cap = "社員の負担が大きいため、△ を上限にしています。";
    final = capped;
  }
  return { key: "confucius", label: FRAMES.confucius.label, summary: FRAMES.confucius.summary, mark: final, met, missed, cap };
}

export function evaluateFrames(input: FrameInput): FramesResult {
  const laozi = evaluateLaozi(input);
  const sunzi = evaluateSunzi(input);
  const confucius = evaluateConfucius(input);
  const all = [laozi, sunzi, confucius];
  return {
    laozi,
    sunzi,
    confucius,
    total: all.reduce((sum, f) => sum + FRAME_MARKS[f.mark].points, 0),
    hasReject: all.some((f) => f.mark === "×"),
  };
}

/**
 * 施策の並び順を決める。仕組みスコアだけで並べると、
 * 「人は楽だが大手と正面衝突する」「効率は良いが信頼を損なう」施策が上に来てしまう。
 *
 *   1. どれか 1 軸でも × がある施策は、いちばん下に落とす
 *   2. 残りは 3 軸の合計点が高い順
 *   3. 同点なら仕組みスコアが高い順
 */
export function compareForRanking(a: { frames: FramesResult; leverageScore: number }, b: { frames: FramesResult; leverageScore: number }): number {
  if (a.frames.hasReject !== b.frames.hasReject) return a.frames.hasReject ? 1 : -1;
  if (a.frames.total !== b.frames.total) return b.frames.total - a.frames.total;
  return b.leverageScore - a.leverageScore;
}

/** 画面とレポートに出す一行の理由。なぜその記号になったかを短くまとめる */
export function frameReason(f: FrameResult): string {
  const parts: string[] = [];
  if (f.met.length) parts.push(`満たしている: ${f.met.join(" / ")}`);
  if (f.missed.length) parts.push(`満たしていない: ${f.missed.join(" / ")}`);
  if (f.cap) parts.push(f.cap);
  return parts.join("　");
}

/** × が付いた軸の注意文。無ければ null */
export function frameWarning(r: FramesResult): string | null {
  const rejected = FRAME_KEYS.map((k) => r[k]).filter((f) => f.mark === "×");
  if (rejected.length === 0) return null;
  return rejected.map((f) => `${f.label}軸に反しています（${f.summary}）: ${f.missed.join(" / ")}`).join("　");
}
