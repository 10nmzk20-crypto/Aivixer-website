import type { NormalizedInput } from "../metrics";
import type { ComparisonResult } from "./compare";
import { computeDerived, totalBookings, totalJoins, type DerivedKpi } from "./derived";

/**
 * 担当 5 人分の「現状・傾向・問題点・改善案」を、入力された数字から組み立てる。
 *
 * 判定はすべてここで行う。外部 AI は使わない。
 * 同じ数字を入れれば毎回同じ結果になり、なぜそう言えるのかを後から説明できる。
 *
 * 各担当の判断の目安は src/employees/guides.ts に書いてあるものと同じ。
 */

export type Verdict = "good" | "watch" | "problem" | "no_data";

export interface Finding {
  /** 問題点（何が起きているか） */
  problem: string;
  /** 改善案（次に何をするか） */
  fix: string;
  /** 深刻さ。大きいほど優先。総合レポートの並び替えに使う */
  weight: number;
}

export interface ToolReview {
  /** 担当の id（search / site / behavior / map / booking） */
  id: string;
  name: string;
  tool: string;
  question: string;
  verdict: Verdict;
  /** 現状: いま何がどれだけか。入力値と計算値だけ */
  current: string[];
  /** 傾向: 前月と比べてどうか */
  trend: string[];
  /** 問題点と改善案 */
  findings: Finding[];
  /** 入力が足りず判断できなかったこと */
  missing: string[];
}

const has = (v: Record<string, number>, ...ids: string[]) => ids.every((id) => v[id] !== undefined);
const fmt = (n: number | null | undefined, unit = "") => (n === null || n === undefined ? "データなし" : `${n.toLocaleString("ja-JP")}${unit}`);
const pct = (n: number | null | undefined) => (n === null || n === undefined ? "データなし" : `${n}%`);

/** 前月比の文。比較できなければ null */
function delta(cmp: ComparisonResult | null, id: string, label: string): string | null {
  const row = cmp?.rows.find((r) => r.id === id);
  if (!row || row.delta === null) return null;
  const sign = row.delta > 0 ? "+" : "";
  const p = row.deltaPct !== null ? `（${sign}${row.deltaPct}%）` : "";
  return `${label}: ${row.current}${row.unit} ← 前月 ${row.previous}${row.unit} / ${sign}${row.delta}${row.unit}${p}`;
}

/** 前月比の変化率。比較できなければ null */
function changeRate(cmp: ComparisonResult | null, id: string): number | null {
  const row = cmp?.rows.find((r) => r.id === id);
  return row?.deltaPct ?? null;
}

/** 判定は「問題点の重さ」で決める */
function verdictOf(findings: Finding[], hasData: boolean): Verdict {
  if (!hasData) return "no_data";
  const max = findings.reduce((m, f) => Math.max(m, f.weight), 0);
  return max >= 3 ? "problem" : max >= 1 ? "watch" : "good";
}

// ============================================================
// 1. Search Console 担当
// ============================================================
function reviewSearch(v: Record<string, number>, kpi: Map<string, DerivedKpi>, input: NormalizedInput, cmp: ComparisonResult | null): ToolReview {
  const current: string[] = [];
  const trend: string[] = [];
  const findings: Finding[] = [];
  const missing: string[] = [];
  const ctr = kpi.get("gsc_ctr_calc")?.value ?? null;

  if (v.gsc_impressions !== undefined) current.push(`検索結果に出た回数: ${fmt(v.gsc_impressions, " 回")}`);
  if (v.gsc_clicks !== undefined) current.push(`そこから押された回数: ${fmt(v.gsc_clicks, " 回")}`);
  if (ctr !== null) current.push(`押された割合（CTR）: ${pct(ctr)}`);
  if (v.gsc_position !== undefined) current.push(`平均掲載順位: ${fmt(v.gsc_position, " 位")}`);
  if (input.keywords.length > 0) current.push(`入力されたキーワード: ${input.keywords.length} 件`);

  for (const [id, label] of [["gsc_impressions", "検索表示回数"], ["gsc_clicks", "検索クリック数"], ["gsc_position", "平均掲載順位"]] as const) {
    const t = delta(cmp, id, label);
    if (t) trend.push(t);
  }

  const impRate = changeRate(cmp, "gsc_impressions");
  const clickRate = changeRate(cmp, "gsc_clicks");

  // 表示は増えたのにクリックが増えていない → 検索結果での見え方の問題
  if (impRate !== null && clickRate !== null && impRate >= 5 && clickRate <= 0) {
    findings.push({
      weight: 3,
      problem: `検索結果に出た回数は ${impRate > 0 ? "+" : ""}${impRate}% 増えているのに、押された回数は ${clickRate}% と増えていません。見られてはいるが選ばれていません。`,
      fix: "検索結果に出るタイトルと説明文を見直す。「高知」「24時間」「見学無料」など、探している人が知りたい言葉を先頭に入れる。一度直せば、その後もずっと効き続けます。",
    });
  }
  if (ctr !== null && ctr < 2) {
    findings.push({
      weight: 3,
      problem: `押された割合（CTR）が ${pct(ctr)} です。検索結果に出ても、ほとんど選ばれていません。`,
      fix: "上位に出ているページのタイトルと説明文を書き直す。競合の検索結果と並べて見比べ、選ばれる理由が一目で分かる文にする。",
    });
  } else if (ctr !== null && ctr < 4) {
    findings.push({ weight: 1, problem: `押された割合（CTR）が ${pct(ctr)} で、やや低めです。`, fix: "主要ページのタイトルと説明文を、探している人の言葉に寄せて見直す。" });
  }
  if (v.gsc_position !== undefined && v.gsc_position > 10) {
    findings.push({
      weight: 3,
      problem: `平均掲載順位が ${fmt(v.gsc_position, " 位")}。検索結果の 2 ページ目以降が中心で、ほとんど見られていません。`,
      fix: "検索されている言葉に正面から答えるページを作る。「高知 ジム 初心者」「24時間 ジム 高知」など、1 つの言葉に 1 ページを当てる。記事は一度書けば働き続けます。",
    });
  }
  if (impRate !== null && impRate <= -10) {
    findings.push({ weight: 2, problem: `検索結果に出た回数が前月比 ${impRate}% と落ちています。`, fix: "順位が下がったページを特定し、情報が古くなっていないか確認して書き足す。" });
  }

  // キーワードごとの順位
  const lowRank = input.keywords.filter((k) => k.position !== null && k.position > 10);
  if (lowRank.length > 0) {
    const names = lowRank.slice(0, 3).map((k) => `「${k.keyword}」${k.position} 位`).join("、");
    findings.push({
      weight: 2,
      problem: `${names}${lowRank.length > 3 ? " ほか" : ""}が 10 位より下です。表示はされていても、ほぼ見られていません。`,
      fix: "この言葉で探している人が知りたいことを 1 ページにまとめて公開する。まず 11〜20 位のものから手を付けると、上がりやすいです。",
    });
  }

  if (!has(v, "gsc_impressions", "gsc_clicks")) missing.push("検索表示回数と検索クリック数（CTR を出すのに必要）");
  if (v.gsc_position === undefined) missing.push("平均掲載順位");
  if (input.keywords.length === 0) missing.push("検索キーワードごとの表示回数・クリック数・順位");
  if (!cmp?.previousPeriod) missing.push("前月の数字（傾向を見るのに必要）");

  return {
    id: "search", name: "Search Console 担当", tool: "Google Search Console", question: "どんな言葉で検索され、何位だったか",
    verdict: verdictOf(findings, v.gsc_impressions !== undefined || v.gsc_clicks !== undefined),
    current, trend, findings, missing,
  };
}

// ============================================================
// 2. GA4 担当
// ============================================================
function reviewSite(v: Record<string, number>, kpi: Map<string, DerivedKpi>, cmp: ComparisonResult | null): ToolReview {
  const current: string[] = [];
  const trend: string[] = [];
  const findings: Finding[] = [];
  const missing: string[] = [];
  const toTrial = kpi.get("hp_trial_page_rate")?.value ?? null;
  const ctaRate = kpi.get("hp_cta_rate")?.value ?? null;

  if (v.ga4_users !== undefined) current.push(`サイトに来た人: ${fmt(v.ga4_users, " 人")}`);
  if (v.ga4_pv_top !== undefined) current.push(`トップページ閲覧: ${fmt(v.ga4_pv_top, " 回")}`);
  if (v.ga4_pv_price !== undefined) current.push(`料金ページ閲覧: ${fmt(v.ga4_pv_price, " 回")}`);
  if (v.ga4_pv_trial !== undefined) current.push(`見学・体験ページ閲覧: ${fmt(v.ga4_pv_trial, " 回")}`);
  if (v.ga4_cta_trial !== undefined) current.push(`見学・体験ボタンが押された回数: ${fmt(v.ga4_cta_trial, " 回")}`);
  if (toTrial !== null) current.push(`来た人のうち見学ページまで進んだ割合: ${pct(toTrial)}`);
  if (ctaRate !== null) current.push(`見学ページを見た人がボタンを押した割合: ${pct(ctaRate)}`);

  for (const [id, label] of [["ga4_users", "ユーザー数"], ["ga4_pv_trial", "見学・体験ページ閲覧数"], ["ga4_cta_trial", "見学・体験 CTA クリック数"]] as const) {
    const t = delta(cmp, id, label);
    if (t) trend.push(t);
  }

  const usersRate = changeRate(cmp, "ga4_users");
  const trialRate = changeRate(cmp, "ga4_pv_trial");

  if (toTrial !== null && toTrial < 10) {
    findings.push({
      weight: 3,
      problem: `サイトに来た人のうち、見学・体験ページまで進んだのは ${pct(toTrial)} だけです。ほとんどの人が入口で終わっています。`,
      fix: "トップページの目立つ位置に「見学・体験はこちら」を置く。料金ページの本文の最後にも同じ案内を置く。1 回作れば、その後ずっと働きます。",
    });
  } else if (toTrial !== null && toTrial < 20) {
    findings.push({ weight: 1, problem: `見学・体験ページまで進んだのは ${pct(toTrial)} です。`, fix: "トップと料金ページから見学ページへの案内を、もう 1 か所増やす。" });
  }
  if (ctaRate !== null && ctaRate < 10) {
    findings.push({
      weight: 3,
      problem: `見学・体験ページは見られているのに、ボタンを押したのは ${pct(ctaRate)} だけです。ページを読んだあとで止まっています。`,
      fix: "ページの中で不安が解消されていない可能性が高い。料金・持ち物・当日の流れ・辞め方をボタンの手前に書き、ボタンはページの上と下の 2 か所に置く。",
    });
  }
  if (usersRate !== null && trialRate !== null && usersRate >= 5 && trialRate <= -5) {
    findings.push({
      weight: 2,
      problem: `来た人は ${usersRate > 0 ? "+" : ""}${usersRate}% 増えたのに、見学ページの閲覧は ${trialRate}% と減っています。入口から先の案内が届いていません。`,
      fix: "増えた人がどのページから入っているかを確認し、そのページから見学ページへの案内を足す。",
    });
  }
  if (usersRate !== null && usersRate <= -10) {
    findings.push({ weight: 2, problem: `サイトに来た人が前月比 ${usersRate}% と減っています。`, fix: "検索担当と地図担当の数字を合わせて見る。見つけてもらう段階が落ちていないか確認する。" });
  }
  if (v.ga4_pv_price !== undefined && v.ga4_pv_trial !== undefined && v.ga4_pv_price > v.ga4_pv_trial * 2) {
    findings.push({
      weight: 2,
      problem: `料金ページ（${fmt(v.ga4_pv_price, " 回")}）が見学・体験ページ（${fmt(v.ga4_pv_trial, " 回")}）の 2 倍以上見られています。料金を見たあとで進んでいない人が多い可能性があります。`,
      fix: "料金ページの本文の最後に「まず見学だけでも大丈夫です」と、見学への案内を置く。金額の近くに、何が含まれるかを並べて書く。",
    });
  }

  if (v.ga4_users === undefined) missing.push("ユーザー数");
  if (v.ga4_pv_trial === undefined) missing.push("見学・体験ページ閲覧数");
  if (v.ga4_cta_trial === undefined) missing.push("見学・体験 CTA クリック数");
  if (!cmp?.previousPeriod) missing.push("前月の数字（傾向を見るのに必要）");

  return {
    id: "site", name: "GA4 担当", tool: "Google Analytics 4", question: "何人来て、どこを見て、何を押したか",
    verdict: verdictOf(findings, v.ga4_users !== undefined),
    current, trend, findings, missing,
  };
}

// ============================================================
// 3. Clarity 担当
// ============================================================
function reviewBehavior(v: Record<string, number>, input: NormalizedInput, cmp: ComparisonResult | null): ToolReview {
  const current: string[] = [];
  const trend: string[] = [];
  const findings: Finding[] = [];
  const missing: string[] = [];

  if (v.clarity_scroll !== undefined) current.push(`平均でページのどこまで読まれたか: ${pct(v.clarity_scroll)}`);
  if (v.clarity_cta_reach !== undefined) current.push(`ボタンの位置まで届いた割合: ${pct(v.clarity_cta_reach)}`);
  if (v.clarity_cta_clicks !== undefined) current.push(`主要ボタンが押された回数: ${fmt(v.clarity_cta_clicks, " 回")}`);
  if (v.clarity_dead_clicks !== undefined) current.push(`押しても何も起きなかった回数: ${fmt(v.clarity_dead_clicks, " 回")}`);
  if (v.clarity_rage_clicks !== undefined) current.push(`いらだって連打された回数: ${fmt(v.clarity_rage_clicks, " 回")}`);
  const note = (input.notes.heatmap ?? "").trim();
  if (note) current.push(`録画を見て気づいたこと: ${note}`);

  for (const [id, label] of [["clarity_scroll", "平均スクロール率"], ["clarity_cta_reach", "CTA 到達率"]] as const) {
    const t = delta(cmp, id, label);
    if (t) trend.push(t);
  }

  if (v.clarity_cta_reach !== undefined && v.clarity_cta_reach < 40) {
    findings.push({
      weight: 3,
      problem: `見学・体験ボタンの位置まで届いたのは ${pct(v.clarity_cta_reach)} だけです。多くの人は、ボタンがあることに気づかないまま離れています。`,
      fix: "ボタンをページの上の方（最初の画面に入る位置）にも置く。1 か所増やすだけで、届く人数が変わります。",
    });
  }
  if (v.clarity_scroll !== undefined && v.clarity_scroll < 50) {
    findings.push({
      weight: 2,
      problem: `平均でページの ${pct(v.clarity_scroll)} までしか読まれていません。下に書いてある内容は、ほぼ読まれていないと考えられます。`,
      fix: "いちばん伝えたいこと（料金・見学の案内・ViXer の強み）を、ページの上半分に移す。",
    });
  }
  // 少数のデッドクリックはどのサイトにもある。本物のボタンが押された回数と比べて多いときだけ問題にする
  if (v.clarity_dead_clicks !== undefined) {
    const cta = v.clarity_cta_clicks;
    const heavy = cta !== undefined && cta > 0 && v.clarity_dead_clicks >= cta;
    const notable = cta !== undefined && cta > 0 ? v.clarity_dead_clicks >= cta * 0.3 : v.clarity_dead_clicks >= 20;
    if (heavy || notable) {
      findings.push({
        weight: heavy ? 3 : 1,
        problem: `押しても何も起きなかった箇所が ${fmt(v.clarity_dead_clicks, " 回")} あります。${heavy ? "本物のボタンが押された回数と同じかそれ以上で、ボタンが分かりにくくなっています。" : ""}`,
        fix: "押されている場所を確認し、そこを本物のリンクにするか、押せないと分かる見た目に直す。",
      });
    }
  }
  // 連打も少数なら通常の範囲。まとまった数のときだけ拾う
  if (v.clarity_rage_clicks !== undefined && v.clarity_rage_clicks >= 5) {
    findings.push({
      weight: 2,
      problem: `いらだって連打された箇所が ${fmt(v.clarity_rage_clicks, " 回")} あります。反応が無い、または遅い場所があります。`,
      fix: "連打されている場所を開いて動作を確認する。読み込みが遅い画像があれば軽くする。",
    });
  }
  if (note && findings.length === 0) {
    findings.push({ weight: 1, problem: `録画の所見: ${note}`, fix: "気づいた箇所を 1 つだけ選び、直したあと翌月の数字で確かめる。" });
  }

  if (v.clarity_scroll === undefined) missing.push("平均スクロール率");
  if (v.clarity_cta_reach === undefined) missing.push("CTA 到達率（ボタンの位置まで届いた割合）");
  if (!note) missing.push("録画を見て気づいたこと（メモ）");

  const hasData = ["clarity_scroll", "clarity_cta_reach", "clarity_cta_clicks", "clarity_dead_clicks", "clarity_rage_clicks"].some((id) => v[id] !== undefined) || !!note;
  return {
    id: "behavior", name: "Clarity 担当", tool: "Microsoft Clarity（ヒートマップ・録画）", question: "なぜそこで止まったか",
    verdict: verdictOf(findings, hasData),
    current, trend, findings, missing,
  };
}

// ============================================================
// 4. Google ビジネスプロフィール担当
// ============================================================
function reviewMap(v: Record<string, number>, kpi: Map<string, DerivedKpi>, cmp: ComparisonResult | null): ToolReview {
  const current: string[] = [];
  const trend: string[] = [];
  const findings: Finding[] = [];
  const missing: string[] = [];
  const clickRate = kpi.get("gbp_click_rate")?.value ?? null;

  if (v.gbp_impressions !== undefined) current.push(`地図・検索で表示された回数: ${fmt(v.gbp_impressions, " 回")}`);
  if (v.gbp_website_clicks !== undefined) current.push(`サイトが押された回数: ${fmt(v.gbp_website_clicks, " 回")}`);
  if (v.gbp_calls !== undefined) current.push(`電話された回数: ${fmt(v.gbp_calls, " 回")}`);
  if (v.gbp_directions !== undefined) current.push(`ルート検索された回数: ${fmt(v.gbp_directions, " 回")}`);
  if (clickRate !== null) current.push(`表示された人がサイトを押した割合: ${pct(clickRate)}`);
  if (v.gbp_reviews_total !== undefined) current.push(`口コミ件数（累計）: ${fmt(v.gbp_reviews_total, " 件")}`);
  if (v.gbp_rating !== undefined) current.push(`口コミ平均評価: ${fmt(v.gbp_rating)}`);
  if (v.gbp_reviews_new !== undefined) current.push(`今月の新しい口コミ: ${fmt(v.gbp_reviews_new, " 件")}`);

  for (const [id, label] of [["gbp_impressions", "プロフィール表示回数"], ["gbp_website_clicks", "Web サイトクリック数"], ["gbp_directions", "ルート検索数"]] as const) {
    const t = delta(cmp, id, label);
    if (t) trend.push(t);
  }

  if (clickRate !== null && clickRate < 3) {
    findings.push({
      weight: 3,
      problem: `地図で表示された人のうち、サイトを見に来たのは ${pct(clickRate)} だけです。見つけてはもらえているのに、次に進まれていません。`,
      fix: "プロフィールの写真を増やし（館内・マシン・入口）、営業時間と説明文を埋める。「24時間」「見学無料」など、その場で知りたいことを説明文の先頭に書く。一度埋めれば、ずっと効きます。",
    });
  }
  if (v.gbp_rating !== undefined && v.gbp_rating < 4.0) {
    findings.push({
      weight: 3,
      problem: `口コミの平均評価が ${fmt(v.gbp_rating)} です。近くのジムと並べて比較されたときに、外される可能性があります。`,
      fix: "低い評価の内容を読み、同じ指摘が続いているなら現場で直す。そのうえで、満足している会員に口コミをお願いする仕組み（退会時ではなく、続いている人への館内掲示）を用意する。",
    });
  } else if (v.gbp_reviews_total !== undefined && v.gbp_reviews_total < 20) {
    findings.push({
      weight: 2,
      problem: `口コミが ${fmt(v.gbp_reviews_total, " 件")}しかありません。比較の段階で判断材料が少ない状態です。`,
      fix: "口コミをお願いする QR コードを館内に掲示する。スタッフが毎回声をかけるのではなく、置いておく形にする。",
    });
  }
  const impRate = changeRate(cmp, "gbp_impressions");
  const clickChange = changeRate(cmp, "gbp_website_clicks");
  if (impRate !== null && clickChange !== null && impRate >= 5 && clickChange <= -5) {
    findings.push({
      weight: 2,
      problem: `表示は ${impRate > 0 ? "+" : ""}${impRate}% 増えたのに、サイトを押した人は ${clickChange}% と減っています。`,
      fix: "プロフィールの写真と説明文を更新する。新しい写真を数枚足すだけでも、見られ方が変わります。",
    });
  }
  if (impRate !== null && impRate <= -10) {
    findings.push({ weight: 2, problem: `地図・検索での表示が前月比 ${impRate}% と落ちています。`, fix: "営業時間・写真・説明文が古くなっていないか確認して更新する。情報が新しいほど表示されやすくなります。" });
  }

  if (v.gbp_impressions === undefined) missing.push("プロフィール表示回数");
  if (v.gbp_website_clicks === undefined) missing.push("Web サイトクリック数");
  if (v.gbp_rating === undefined) missing.push("口コミ平均評価");
  if (!cmp?.previousPeriod) missing.push("前月の数字（傾向を見るのに必要）");

  return {
    id: "map", name: "Google ビジネスプロフィール担当", tool: "Google ビジネスプロフィール", question: "地図で見つけてもらえたか",
    verdict: verdictOf(findings, v.gbp_impressions !== undefined),
    current, trend, findings, missing,
  };
}

// ============================================================
// 5. hacomono 担当
// ============================================================
function reviewBooking(v: Record<string, number>, kpi: Map<string, DerivedKpi>, cmp: ComparisonResult | null): ToolReview {
  const current: string[] = [];
  const trend: string[] = [];
  const findings: Finding[] = [];
  const missing: string[] = [];
  const bookings = totalBookings(v);
  const joins = totalJoins(v);
  const showRate = kpi.get("show_rate")?.value ?? null;
  const visitJoin = kpi.get("visit_join_rate")?.value ?? null;
  const trialRate = kpi.get("trial_rate")?.value ?? null;
  const trialJoin = kpi.get("trial_join_rate")?.value ?? null;
  const churnRate = kpi.get("churn_rate")?.value ?? null;

  if (v.inquiries !== undefined) current.push(`問い合わせ: ${fmt(v.inquiries, " 件")}`);
  if (bookings !== undefined) current.push(`見学・体験の予約: ${fmt(bookings, " 件")}`);
  if (v.visits !== undefined) current.push(`実際に来た人: ${fmt(v.visits, " 人")}`);
  if (showRate !== null) current.push(`予約した人が実際に来た割合: ${pct(showRate)}`);
  if (v.trials !== undefined) current.push(`30日お試しを始めた人: ${fmt(v.trials, " 人")}`);
  if (joins !== undefined) current.push(`本入会: ${fmt(joins, " 人")}`);
  if (visitJoin !== null) current.push(`見学した人が入会した割合: ${pct(visitJoin)}`);
  if (v.new_members !== undefined) current.push(`新規入会: ${fmt(v.new_members, " 人")}`);
  if (v.churn !== undefined) current.push(`退会: ${fmt(v.churn, " 人")}`);
  if (v.members !== undefined) current.push(`月末会員数: ${fmt(v.members, " 人")}`);

  for (const [id, label] of [["visits", "実来館人数"], ["new_members", "新規入会"], ["churn", "退会"], ["members", "月末会員数"]] as const) {
    const t = delta(cmp, id, label);
    if (t) trend.push(t);
  }
  const net = kpi.get("net_change")?.value ?? null;
  if (net !== null) trend.push(`会員の純増減: ${net > 0 ? "+" : ""}${net} 人`);

  if (showRate !== null && showRate < 70) {
    findings.push({
      weight: 3,
      problem: `予約した人のうち実際に来たのは ${pct(showRate)} です。予約から当日までの間に、かなり抜けています。`,
      fix: "予約の確認メールに、当日の流れ・持ち物・駐車場・所要時間を書いて自動で送る。1 回作れば、以後すべての予約に効きます。",
    });
  }
  if (visitJoin !== null && visitJoin < 30) {
    findings.push({
      weight: 3,
      problem: `見学に来た人のうち入会したのは ${pct(visitJoin)} です。来てもらえているのに、そこで決まっていません。`,
      fix: "見学のときに渡す 1 枚（料金・辞め方・初日の流れ・混む時間帯）を作り、同じ内容を Web にも置く。その場で決めきれない人が、持ち帰って読めるようにする。",
    });
  }
  if (trialRate !== null && trialJoin !== null && trialJoin < 50) {
    findings.push({
      weight: 2,
      problem: `30日お試しから本入会に進んだのは ${pct(trialJoin)} です。お試し期間中に続ける理由ができていない可能性があります。`,
      fix: "目的別のセルフメニュー（20 分 / 30 分 / 45 分）を用意し、お試し初日に渡す。何をすればいいか分からないまま終わるのを防ぐ。",
    });
  }
  if (net !== null && net < 0) {
    findings.push({
      weight: 3,
      problem: `退会が新規入会を上回り、会員数が ${net} 人の純減です。`,
      fix: "入り口を増やす前に、まず辞める理由を分類する。1 か月だけ退会理由を記録し、いちばん多い理由を 1 つ仕組みで潰す。",
    });
  } else if (churnRate !== null && churnRate > 5) {
    findings.push({ weight: 2, problem: `月間の退会率が ${pct(churnRate)} です。`, fix: "退会理由を記録して分類する。最も多い理由から、人手をかけずに減らせる形を考える。" });
  }
  if (v.inquiries !== undefined && bookings !== undefined && v.inquiries > 0 && bookings / v.inquiries < 0.5) {
    findings.push({
      weight: 2,
      problem: `問い合わせ ${fmt(v.inquiries, " 件")}に対して予約は ${fmt(bookings, " 件")}です。問い合わせたあとで止まっている人がいます。`,
      fix: "問い合わせへの返信に、予約ページへの直リンクと候補日時を最初から入れる。やり取りの往復を減らす。",
    });
  }

  if (v.visits === undefined) missing.push("実際の見学・体験人数");
  if (bookings === undefined) missing.push("見学・体験予約数");
  if (joins === undefined) missing.push("本入会の人数");
  if (v.churn === undefined) missing.push("退会者数");

  return {
    id: "booking", name: "hacomono 担当", tool: "hacomono（予約・会員管理）", question: "実際に予約・入会したか",
    verdict: verdictOf(findings, v.visits !== undefined || bookings !== undefined || v.members !== undefined),
    current, trend, findings, missing,
  };
}

// ============================================================
// 総合
// ============================================================
export interface MonthlyAction {
  rank: number;
  /** 何をするか */
  action: string;
  /** なぜ今これか（どの担当のどの数字から） */
  why: string;
  /** どの担当の指摘か */
  from: string;
}

export interface OverallReview {
  reviews: ToolReview[];
  /** 一番詰まっている段階の担当。判断できなければ null */
  weakest: string | null;
  /** 総合の一言 */
  headline: string;
  /** 今月やるべきこと（最大 3 つ） */
  actions: MonthlyAction[];
  /** 入力が無く分析できなかった担当 */
  noDataOwners: string[];
}

/** 集客の流れ順。上流から詰まりを直す */
const ORDER = ["search", "map", "site", "behavior", "booking"];

export function reviewAll(input: NormalizedInput, cmp: ComparisonResult | null): OverallReview {
  const v = input.values;
  const kpi = new Map(computeDerived(input).map((k) => [k.id, k]));
  const reviews: ToolReview[] = [
    reviewSearch(v, kpi, input, cmp),
    reviewMap(v, kpi, cmp),
    reviewSite(v, kpi, cmp),
    reviewBehavior(v, input, cmp),
    reviewBooking(v, kpi, cmp),
  ];

  const withData = reviews.filter((r) => r.verdict !== "no_data");
  const noDataOwners = reviews.filter((r) => r.verdict === "no_data").map((r) => r.name);

  // 一番上流で「問題あり」の担当を、いちばん詰まっている場所とみなす
  const problems = withData.filter((r) => r.verdict === "problem");
  const weakest = problems.length > 0 ? ORDER.filter((id) => problems.some((p) => p.id === id))[0] ?? null : null;

  // 今月やるべきこと: 深刻さ順。ただし同じ担当から 2 つ以上は選ばない（1 か所に偏らせない）
  const all = reviews.flatMap((r) => r.findings.map((f) => ({ ...f, owner: r.name, ownerId: r.id })));
  all.sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return ORDER.indexOf(a.ownerId) - ORDER.indexOf(b.ownerId); // 同じ重さなら上流を先に
  });
  const actions: MonthlyAction[] = [];
  const used = new Set<string>();
  for (const f of all) {
    if (actions.length >= 3) break;
    if (used.has(f.ownerId)) continue;
    used.add(f.ownerId);
    actions.push({ rank: actions.length + 1, action: f.fix, why: f.problem, from: f.owner });
  }
  // 3 つに満たなければ、同じ担当の 2 つ目以降も入れる
  if (actions.length < 3) {
    for (const f of all) {
      if (actions.length >= 3) break;
      if (actions.some((a) => a.action === f.fix)) continue;
      actions.push({ rank: actions.length + 1, action: f.fix, why: f.problem, from: f.owner });
    }
  }

  let headline: string;
  if (withData.length === 0) headline = "数字が入力されていないため、分析できません。分かるものだけでも入力してください。";
  else if (actions.length === 0) headline = `${withData.length} 人分の数字を見ましたが、目立った問題は見つかりませんでした。今の形を続けてください。`;
  else {
    const w = reviews.find((r) => r.id === weakest);
    headline = w
      ? `いちばん詰まっているのは「${w.question}」の段階です（${w.name}）。ここを直さないまま先を直しても効きません。`
      : `${withData.length} 人分の数字から、${actions.length} 件の改善点が見つかりました。`;
  }

  return { reviews, weakest, headline, actions, noDataOwners };
}
