import type { NormalizedInput } from "../metrics";
import type { ComparisonResult } from "./compare";
import { computeDerived, totalBookings } from "./derived";

/**
 * 集客ファネルを 8 段階で判定する。
 * 判定はすべてコードで行う（AI に判定させると数字を作る恐れがあるため）。
 *
 * Google 検索 → GBP → HP 流入 → HP 内行動 → 見学予約 → 実来館 → 30日お試し → 本入会
 */

export type FunnelStatus = "good" | "watch" | "problem" | "no_data";

export interface FunnelStage {
  id: string;
  label: string;
  status: FunnelStatus;
  /** 判定の根拠（数字を含む）。データ不足のときは何が足りないか */
  reason: string;
  /** この段階を見るのに使った数字 */
  metrics: Array<{ label: string; value: string; delta?: string }>;
  /** 悪化の大きさ（前月比の下落幅・%）。大きいほど深刻。比較できなければ 0 */
  severity: number;
}

export interface FunnelResult {
  stages: FunnelStage[];
  /** 最も問題がある段階（「問題あり」の中で悪化が最も大きいもの）。無ければ null */
  weakest: string | null;
  /** データが足りない段階の数 */
  noDataCount: number;
}

const STAGES: Array<{ id: string; label: string }> = [
  { id: "search", label: "Google 検索" },
  { id: "gbp", label: "Google ビジネスプロフィール" },
  { id: "hp_traffic", label: "HP 流入" },
  { id: "hp_behavior", label: "HP 内行動" },
  { id: "booking", label: "見学予約" },
  { id: "show", label: "実来館" },
  { id: "trial", label: "30日お試し" },
  { id: "join", label: "本入会" },
];

const fmt = (n: number | null | undefined, unit = "") => (n === null || n === undefined ? "データなし" : `${n.toLocaleString("ja-JP")}${unit}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "データなし" : `${n}%`);

/** 増減の表示（前月比）。前月データが無ければ undefined */
function deltaText(cmp: ComparisonResult, id: string): string | undefined {
  const row = cmp.rows.find((r) => r.id === id);
  if (!row || row.delta === null) return undefined;
  const sign = row.delta > 0 ? "+" : "";
  return row.deltaPct !== null ? `前月比 ${sign}${row.delta}（${sign}${row.deltaPct}%）` : `前月比 ${sign}${row.delta}`;
}

/** 前月比の方向。改善なら 1、悪化なら -1、横ばい（±3% 未満）なら 0、比較できなければ null */
function trend(cmp: ComparisonResult, id: string, higherIsBetter = true): number | null {
  const row = cmp.rows.find((r) => r.id === id);
  if (!row || row.delta === null) return null;
  const base = row.deltaPct !== null ? row.deltaPct : row.delta;
  if (Math.abs(base) < 3) return 0;
  const dir = base > 0 ? 1 : -1;
  return higherIsBetter ? dir : -dir;
}

/** 前月比の下落幅（%）。改善または比較できなければ 0 */
function decline(cmp: ComparisonResult, id: string, higherIsBetter = true): number {
  const row = cmp.rows.find((r) => r.id === id);
  if (!row || row.deltaPct === null) return 0;
  const drop = higherIsBetter ? -row.deltaPct : row.deltaPct;
  return drop > 0 ? drop : 0;
}

/**
 * 1 段階の判定。
 * - 数字が無ければ「データ不足」
 * - 前月比で悪化していれば「問題あり」、横ばい or 改善なら「良好」
 * - 前月が無い場合は、率の目安と比べる。目安が無い項目は「注意」（単月では判断しきれないため）
 */
function judge(opts: {
  values: Array<number | null | undefined>;
  trends: Array<number | null>;
  /** 率と、その目安（下回ると問題）。単月判定に使う */
  rate?: { value: number | null; warn: number; good: number };
}): { status: FunnelStatus; note: string } {
  const hasData = opts.values.some((v) => v !== null && v !== undefined);
  if (!hasData) return { status: "no_data", note: "数字が入力されていないため判断できません" };

  const known = opts.trends.filter((t): t is number => t !== null);
  if (known.length > 0) {
    const worst = Math.min(...known);
    if (worst < 0) return { status: "problem", note: "前月より悪化しています" };
    const best = Math.max(...known);
    if (best > 0) return { status: "good", note: "前月より改善しています" };
    return { status: "good", note: "前月とほぼ同じです" };
  }

  if (opts.rate && opts.rate.value !== null) {
    if (opts.rate.value < opts.rate.warn) return { status: "problem", note: "率が低いため詰まっている可能性があります" };
    if (opts.rate.value >= opts.rate.good) return { status: "good", note: "率は十分です" };
    return { status: "watch", note: "率がやや低めです" };
  }
  return { status: "watch", note: "前月データが無いため、単月では良し悪しを判断できません" };
}

export function diagnoseFunnel(input: NormalizedInput, cmp: ComparisonResult): FunnelResult {
  const v = input.values;
  const derived = new Map(computeDerived(input).map((k) => [k.id, k.value]));
  const bookings = totalBookings(v);
  const stages: FunnelStage[] = [];

  const push = (id: string, metrics: FunnelStage["metrics"], j: { status: FunnelStatus; note: string }, detail: string, declines: number[] = []) => {
    const label = STAGES.find((s) => s.id === id)!.label;
    stages.push({ id, label, status: j.status, reason: j.status === "no_data" ? j.note : `${j.note}。${detail}`, metrics, severity: declines.length ? Math.round(Math.max(...declines, 0) * 10) / 10 : 0 });
  };

  // ① Google 検索（Search Console）
  push(
    "search",
    [
      { label: "検索表示回数", value: fmt(v.gsc_impressions, " 回"), delta: deltaText(cmp, "gsc_impressions") },
      { label: "検索クリック数", value: fmt(v.gsc_clicks, " 回"), delta: deltaText(cmp, "gsc_clicks") },
      { label: "CTR", value: pct(derived.get("gsc_ctr_calc") ?? null), delta: deltaText(cmp, "gsc_ctr_calc") },
      { label: "平均掲載順位", value: fmt(v.gsc_position, " 位"), delta: deltaText(cmp, "gsc_position") },
    ],
    judge({
      values: [v.gsc_impressions, v.gsc_clicks],
      trends: [trend(cmp, "gsc_impressions"), trend(cmp, "gsc_clicks"), trend(cmp, "gsc_position", false)],
      rate: { value: derived.get("gsc_ctr_calc") ?? null, warn: 1.5, good: 3 },
    }),
    `表示 ${fmt(v.gsc_impressions)} / クリック ${fmt(v.gsc_clicks)} / CTR ${pct(derived.get("gsc_ctr_calc") ?? null)}`,
    [decline(cmp, "gsc_impressions"), decline(cmp, "gsc_clicks"), decline(cmp, "gsc_ctr_calc"), decline(cmp, "gsc_position", false)],
  );

  // ② Google ビジネスプロフィール
  push(
    "gbp",
    [
      { label: "プロフィール表示回数", value: fmt(v.gbp_impressions, " 回"), delta: deltaText(cmp, "gbp_impressions") },
      { label: "Web クリック", value: fmt(v.gbp_website_clicks, " 回"), delta: deltaText(cmp, "gbp_website_clicks") },
      { label: "電話", value: fmt(v.gbp_calls, " 件"), delta: deltaText(cmp, "gbp_calls") },
      { label: "表示 → Web クリック率", value: pct(derived.get("gbp_click_rate") ?? null), delta: deltaText(cmp, "gbp_click_rate") },
      { label: "新規口コミ", value: fmt(v.gbp_reviews_new, " 件"), delta: deltaText(cmp, "gbp_reviews_new") },
    ],
    judge({
      values: [v.gbp_impressions, v.gbp_website_clicks, v.gbp_calls],
      trends: [trend(cmp, "gbp_impressions"), trend(cmp, "gbp_website_clicks"), trend(cmp, "gbp_click_rate")],
      rate: { value: derived.get("gbp_click_rate") ?? null, warn: 2, good: 5 },
    }),
    `表示 ${fmt(v.gbp_impressions)} / Web クリック ${fmt(v.gbp_website_clicks)} / 電話 ${fmt(v.gbp_calls)}`,
    [decline(cmp, "gbp_impressions"), decline(cmp, "gbp_website_clicks"), decline(cmp, "gbp_click_rate")],
  );

  // ③ HP 流入（GA4）
  push(
    "hp_traffic",
    [
      { label: "ユーザー数", value: fmt(v.ga4_users, " 人"), delta: deltaText(cmp, "ga4_users") },
      { label: "自然検索から", value: fmt(v.ga4_organic_users, " 人"), delta: deltaText(cmp, "ga4_organic_users") },
      { label: "新規ユーザー", value: fmt(v.ga4_new_users, " 人"), delta: deltaText(cmp, "ga4_new_users") },
    ],
    judge({ values: [v.ga4_users, v.ga4_sessions], trends: [trend(cmp, "ga4_users"), trend(cmp, "ga4_organic_users")] }),
    `ユーザー ${fmt(v.ga4_users)} / 自然検索 ${fmt(v.ga4_organic_users)}`,
    [decline(cmp, "ga4_users"), decline(cmp, "ga4_organic_users")],
  );

  // ④ HP 内行動（ページ閲覧・CTA・ヒートマップ）
  push(
    "hp_behavior",
    [
      { label: "見学ページ閲覧", value: fmt(v.ga4_pv_trial, " 回"), delta: deltaText(cmp, "ga4_pv_trial") },
      { label: "料金ページ閲覧", value: fmt(v.ga4_pv_price, " 回"), delta: deltaText(cmp, "ga4_pv_price") },
      { label: "見学ページ到達率", value: pct(derived.get("hp_trial_page_rate") ?? null), delta: deltaText(cmp, "hp_trial_page_rate") },
      { label: "CTA クリック率", value: pct(derived.get("hp_cta_rate") ?? null), delta: deltaText(cmp, "hp_cta_rate") },
      { label: "LINE クリック", value: fmt(v.ga4_cta_line, " 回"), delta: deltaText(cmp, "ga4_cta_line") },
    ],
    judge({
      values: [v.ga4_pv_trial, v.ga4_cta_trial, v.clarity_cta_reach],
      trends: [trend(cmp, "hp_trial_page_rate"), trend(cmp, "hp_cta_rate"), trend(cmp, "ga4_cta_trial")],
      rate: { value: derived.get("hp_cta_rate") ?? null, warn: 5, good: 15 },
    }),
    `見学ページ到達率 ${pct(derived.get("hp_trial_page_rate") ?? null)} / CTA クリック率 ${pct(derived.get("hp_cta_rate") ?? null)}`,
    [decline(cmp, "hp_cta_rate"), decline(cmp, "ga4_cta_trial"), decline(cmp, "hp_trial_page_rate")],
  );

  // ⑤ 見学予約
  push(
    "booking",
    [
      { label: "予約数（合計）", value: fmt(bookings, " 件"), delta: deltaText(cmp, "book_web") },
      { label: "Web から", value: fmt(v.book_web, " 件"), delta: deltaText(cmp, "book_web") },
      { label: "電話から", value: fmt(v.book_tel, " 件"), delta: deltaText(cmp, "book_tel") },
      { label: "LINE から", value: fmt(v.book_line, " 件"), delta: deltaText(cmp, "book_line") },
      { label: "問い合わせ", value: fmt(v.inquiries, " 件"), delta: deltaText(cmp, "inquiries") },
    ],
    judge({ values: [bookings, v.inquiries], trends: [trend(cmp, "book_web"), trend(cmp, "book_tel"), trend(cmp, "inquiries")] }),
    `予約 ${fmt(bookings)} 件（Web ${fmt(v.book_web)} / 電話 ${fmt(v.book_tel)} / LINE ${fmt(v.book_line)}）`,
    [decline(cmp, "book_web"), decline(cmp, "book_tel"), decline(cmp, "inquiries")],
  );

  // ⑥ 実来館
  push(
    "show",
    [
      { label: "実際の見学・体験人数", value: fmt(v.visits, " 名"), delta: deltaText(cmp, "visits") },
      { label: "予約 → 実来館率", value: pct(derived.get("show_rate") ?? null), delta: deltaText(cmp, "show_rate") },
    ],
    judge({
      values: [v.visits],
      trends: [trend(cmp, "visits"), trend(cmp, "show_rate")],
      rate: { value: derived.get("show_rate") ?? null, warn: 70, good: 85 },
    }),
    `見学 ${fmt(v.visits)} 名 / 実来館率 ${pct(derived.get("show_rate") ?? null)}`,
    [decline(cmp, "visits"), decline(cmp, "show_rate")],
  );

  // ⑦ 30日お試し
  push(
    "trial",
    [
      { label: "お試し開始", value: fmt(v.trials, " 名"), delta: deltaText(cmp, "trials") },
      { label: "見学 → お試し移行率", value: pct(derived.get("trial_rate") ?? null), delta: deltaText(cmp, "trial_rate") },
      { label: "見学 → お試しまたは本入会", value: pct(derived.get("visit_conversion_rate") ?? null), delta: deltaText(cmp, "visit_conversion_rate") },
    ],
    judge({
      values: [v.trials],
      trends: [trend(cmp, "trials"), trend(cmp, "trial_rate"), trend(cmp, "visit_conversion_rate")],
      rate: { value: derived.get("visit_conversion_rate") ?? null, warn: 30, good: 50 },
    }),
    `お試し ${fmt(v.trials)} 名 / 移行率 ${pct(derived.get("trial_rate") ?? null)}`,
    [decline(cmp, "trials"), decline(cmp, "trial_rate"), decline(cmp, "visit_conversion_rate")],
  );

  // ⑧ 本入会
  push(
    "join",
    [
      { label: "お試しから本入会", value: fmt(v.trial_joins, " 名"), delta: deltaText(cmp, "trial_joins") },
      { label: "見学から直接本入会", value: fmt(v.direct_joins, " 名"), delta: deltaText(cmp, "direct_joins") },
      { label: "お試し → 本入会率", value: pct(derived.get("trial_join_rate") ?? null), delta: deltaText(cmp, "trial_join_rate") },
      { label: "新規入会者数", value: fmt(v.new_members, " 名"), delta: deltaText(cmp, "new_members") },
    ],
    judge({
      values: [v.trial_joins, v.direct_joins, v.new_members],
      trends: [trend(cmp, "trial_joins"), trend(cmp, "trial_join_rate"), trend(cmp, "new_members")],
      rate: { value: derived.get("trial_join_rate") ?? null, warn: 40, good: 60 },
    }),
    `お試しから ${fmt(v.trial_joins)} 名 / 直接 ${fmt(v.direct_joins)} 名 / お試し → 本入会率 ${pct(derived.get("trial_join_rate") ?? null)}`,
    [decline(cmp, "trial_joins"), decline(cmp, "trial_join_rate"), decline(cmp, "new_members")],
  );

  // 「問題あり」の中で悪化が最も大きい段階を選ぶ。同じなら上流（Google 側）を優先する
  const problems = stages.filter((s) => s.status === "problem");
  const pool = problems.length > 0 ? problems : stages.filter((s) => s.status === "watch");
  const weakest = pool.length > 0 ? pool.reduce((a, b) => (b.severity > a.severity ? b : a)).id : null;
  return { stages, weakest, noDataCount: stages.filter((s) => s.status === "no_data").length };
}

export const FUNNEL_STATUS_JA: Record<FunnelStatus, string> = {
  good: "良好",
  watch: "注意",
  problem: "問題あり",
  no_data: "データ不足",
};
