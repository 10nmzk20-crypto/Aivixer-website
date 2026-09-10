import type { NormalizedInput } from "../metrics";

/**
 * 入力された数字から KPI を計算する。AI には計算させない（数字の捏造を防ぐため）。
 * 分母が 0 か、必要な数字が入っていない場合は計算しない（null を返す）。
 */

export interface DerivedKpi {
  id: string;
  label: string;
  /** 計算結果。計算できなければ null */
  value: number | null;
  unit: "%" | "回" | "名";
  /** どう計算したか（画面と AI に見せる） */
  formula: string;
  /** 計算できなかった理由 */
  missing?: string;
  group: "google" | "hp" | "sales" | "member";
}

/** 割り算。分母が 0 か未入力なら null */
function ratio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (numerator === undefined || denominator === undefined) return null;
  if (denominator === 0) return null;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function missingOf(v: Record<string, number>, ids: string[], labels: Record<string, string>): string | undefined {
  const lack = ids.filter((id) => v[id] === undefined);
  if (lack.length === 0) return undefined;
  return `${lack.map((id) => labels[id] ?? id).join("・")}が未入力`;
}

const L: Record<string, string> = {
  gsc_impressions: "検索表示回数",
  gsc_clicks: "検索クリック数",
  gbp_impressions: "プロフィール表示回数",
  gbp_website_clicks: "Web サイトクリック数",
  ga4_users: "ユーザー数",
  ga4_pv_trial: "見学・体験ページ閲覧数",
  ga4_cta_trial: "見学・体験 CTA クリック数",
  visits: "実際の見学・体験人数",
  trials: "30日お試し 開始人数",
  direct_joins: "見学から直接 本入会",
  trial_joins: "30日お試しから 本入会",
  new_members: "新規入会者数",
  churn: "退会者数",
  members: "月末会員数",
  book_web: "Web からの予約数",
  book_tel: "電話からの予約数",
  book_line: "LINE からの予約数",
  book_other: "その他からの予約数",
};

/** 見学・体験の予約数の合計。1 つでも入力があれば合計する */
export function totalBookings(v: Record<string, number>): number | undefined {
  const ids = ["book_web", "book_tel", "book_line", "book_other"];
  const present = ids.filter((id) => v[id] !== undefined);
  if (present.length === 0) return undefined;
  return present.reduce((sum, id) => sum + v[id], 0);
}

/** 本入会の合計（直接 + お試し経由） */
export function totalJoins(v: Record<string, number>): number | undefined {
  const ids = ["direct_joins", "trial_joins"];
  const present = ids.filter((id) => v[id] !== undefined);
  if (present.length === 0) return v.new_members;
  return present.reduce((sum, id) => sum + v[id], 0);
}

export function computeDerived(input: NormalizedInput): DerivedKpi[] {
  const v = input.values;
  const bookings = totalBookings(v);
  const kpis: DerivedKpi[] = [];

  const add = (id: string, label: string, group: DerivedKpi["group"], value: number | null, formula: string, needed: string[], unit: DerivedKpi["unit"] = "%") => {
    kpis.push({ id, label, group, value, unit, formula, missing: value === null ? missingOf(v, needed, L) ?? "分母が 0" : undefined });
  };

  // ---------- Google 関連 ----------
  add(
    "gsc_ctr_calc",
    "Search Console CTR",
    "google",
    v.gsc_ctr !== undefined ? v.gsc_ctr : ratio(v.gsc_clicks, v.gsc_impressions),
    v.gsc_ctr !== undefined ? "入力値" : "検索クリック数 ÷ 検索表示回数",
    ["gsc_clicks", "gsc_impressions"],
  );
  add("gbp_click_rate", "GBP 表示 → Web クリック率", "google", ratio(v.gbp_website_clicks, v.gbp_impressions), "Web サイトクリック数 ÷ プロフィール表示回数", ["gbp_website_clicks", "gbp_impressions"]);

  // ---------- ホームページ関連 ----------
  add("hp_trial_page_rate", "HP ユーザー → 見学ページ到達率", "hp", ratio(v.ga4_pv_trial, v.ga4_users), "見学・体験ページ閲覧数 ÷ ユーザー数", ["ga4_pv_trial", "ga4_users"]);
  add("hp_cta_rate", "見学ページ → CTA クリック率", "hp", ratio(v.ga4_cta_trial, v.ga4_pv_trial), "見学・体験 CTA クリック数 ÷ 見学・体験ページ閲覧数", ["ga4_cta_trial", "ga4_pv_trial"]);
  add("hp_booking_rate", "HP ユーザー → 見学予約率", "hp", ratio(v.book_web, v.ga4_users), "Web からの予約数 ÷ ユーザー数", ["book_web", "ga4_users"]);

  // ---------- 営業関連 ----------
  kpis.push({
    id: "show_rate",
    label: "見学予約 → 実来館率",
    group: "sales",
    value: ratio(v.visits, bookings),
    unit: "%",
    formula: "実際の見学・体験人数 ÷ 見学・体験予約数（Web・電話・LINE・その他の合計）",
    missing: ratio(v.visits, bookings) === null ? (bookings === undefined ? "見学・体験予約数が未入力" : v.visits === undefined ? "実際の見学・体験人数が未入力" : "分母が 0") : undefined,
  });
  add("trial_rate", "見学 → 30日お試し 移行率", "sales", ratio(v.trials, v.visits), "30日お試し 開始人数 ÷ 実際の見学・体験人数", ["trials", "visits"]);
  add("direct_join_rate", "見学 → 直接 本入会率", "sales", ratio(v.direct_joins, v.visits), "見学から直接 本入会 ÷ 実際の見学・体験人数", ["direct_joins", "visits"]);

  const trialsOrJoins = v.trials !== undefined || v.direct_joins !== undefined ? (v.trials ?? 0) + (v.direct_joins ?? 0) : undefined;
  kpis.push({
    id: "visit_conversion_rate",
    label: "見学 → お試しまたは本入会 移行率",
    group: "sales",
    value: ratio(trialsOrJoins, v.visits),
    unit: "%",
    formula: "（30日お試し 開始人数 + 見学から直接 本入会）÷ 実際の見学・体験人数",
    missing: ratio(trialsOrJoins, v.visits) === null ? missingOf(v, ["visits"], L) ?? "30日お試しと直接本入会がどちらも未入力" : undefined,
  });
  add("trial_join_rate", "30日お試し → 本入会率", "sales", ratio(v.trial_joins, v.trials), "30日お試しから 本入会 ÷ 30日お試し 開始人数", ["trial_joins", "trials"]);

  // ---------- 会員関連 ----------
  add("join_rate", "新規入会率", "member", ratio(v.new_members, v.members), "新規入会者数 ÷ 月末会員数", ["new_members", "members"]);
  add("churn_rate", "月間退会率", "member", ratio(v.churn, v.members), "退会者数 ÷ 月末会員数", ["churn", "members"]);

  return kpis;
}

/** 検索キーワードごとの CTR を補う（入力が無ければ表示回数とクリック数から計算） */
export function withKeywordCtr(keywords: NormalizedInput["keywords"]): NormalizedInput["keywords"] {
  return keywords.map((k) => ({
    ...k,
    ctr: k.ctr !== null ? k.ctr : k.impressions !== null && k.clicks !== null && k.impressions > 0 ? Math.round((k.clicks / k.impressions) * 1000) / 10 : null,
  }));
}
