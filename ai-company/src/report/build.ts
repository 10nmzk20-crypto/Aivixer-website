import type { ProjectRow, KnowledgeRow, TaskRow, KpiRow } from "../db/repo";
import { METRIC_GROUPS, SOURCE_LABEL, normalizeInputData, type NormalizedInput } from "../metrics";
import { bookingShares, channelShares, computeDerived, totalBookings, totalJoins, type DerivedKpi } from "../analysis/derived";
import type { ComparisonResult } from "../analysis/compare";
import { FUNNEL_STATUS_JA, type FunnelResult } from "../analysis/funnel";

/**
 * ChatGPT に貼り付けるレポートを組み立てる。
 * 数字はすべて入力値とアプリ内の計算結果だけを使う。入っていない項目は「データなし」と書く。
 */

const NA = "データなし";
const num = (n: number | null | undefined, unit = ""): string => (n === null || n === undefined ? NA : `${n.toLocaleString("ja-JP")}${unit}`);
const pct = (n: number | null | undefined): string => (n === null || n === undefined ? NA : `${n}%`);

/** 前月比・前年比の表記。比較できなければ空文字 */
function comparisonSuffix(cmp: ComparisonResult | null, id: string): string {
  const row = cmp?.rows.find((r) => r.id === id);
  if (!row) return "";
  const parts: string[] = [];
  if (row.delta !== null) {
    const sign = row.delta > 0 ? "+" : "";
    parts.push(`前月比 ${sign}${row.delta}${row.deltaPct !== null ? `（${sign}${row.deltaPct}%）` : ""}`);
  }
  if (row.yoyDelta !== null) {
    const sign = row.yoyDelta > 0 ? "+" : "";
    parts.push(`前年同月比 ${sign}${row.yoyDelta}${row.yoyPct !== null ? `（${sign}${row.yoyPct}%）` : ""}`);
  }
  return parts.length ? `（${parts.join(" / ")}）` : "";
}

export interface ReportSources {
  project: ProjectRow;
  derived: { kpis: DerivedKpi[]; comparison: ComparisonResult } | null;
  funnel: FunnelResult | null;
  /** 過去に実施した施策（完了・実行中・却下） */
  pastTasks: Array<TaskRow & { project_title: string; kpis: KpiRow[] }>;
  /** ナレッジ（成功・失敗・学び） */
  knowledge: KnowledgeRow[];
}

export function buildReport(src: ReportSources): string {
  const { project, funnel } = src;
  const input: NormalizedInput = normalizeInputData(project.input_data_json ? JSON.parse(project.input_data_json) : null);
  const v = input.values;
  const kpis = src.derived?.kpis ?? computeDerived(input);
  const kpiMap = new Map(kpis.map((k) => [k.id, k]));
  const cmp = src.derived?.comparison ?? null;
  const L: string[] = [];

  const line = (label: string, value: string) => L.push(`${label}: ${value}`);
  const metric = (id: string, label: string, unit = "") => line(label, v[id] === undefined ? NA : `${num(v[id], unit)}${comparisonSuffix(cmp, id)}`);
  const kpi = (id: string, label: string) => {
    const k = kpiMap.get(id);
    if (!k || k.value === null) return line(label, `${NA}（${k?.missing ?? "必要な数字が未入力"}）`);
    line(label, `${k.unit === "名" ? num(k.value, " 名") : pct(k.value)}${comparisonSuffix(cmp, id)}`);
  };

  // ---------- 見出し ----------
  L.push("# Life Design ViXer 経営データ", "");
  line("対象期間", project.period_label || NA);
  line("案件名", project.title);
  line("作成日", new Date().toISOString().slice(0, 10));
  if (cmp) {
    line("前月比較の対象", cmp.previousPeriod ?? `${NA}（前月の入力がありません）`);
    line("前年比較の対象", cmp.lastYearPeriod ?? `${NA}（前年同月の入力がありません）`);
  }
  L.push("");

  // ---------- 基本の数字 ----------
  L.push("## 1. 基本の数字", "");
  metric("sales", "売上", " 円");
  metric("members", "月末会員数", " 名");
  metric("new_members", "新規入会", " 名");
  metric("churn", "退会", " 名");
  kpi("net_change", "純増減");
  metric("inquiries", "問い合わせ", " 件");
  const bookings = totalBookings(v);
  line("見学・体験予約数（合計）", bookings === undefined ? NA : `${num(bookings, " 件")}`);
  metric("visits", "実際の見学・体験人数", " 名");
  metric("trials", "30日お試し 開始", " 名");
  metric("direct_joins", "見学から直接 本入会", " 名");
  metric("trial_joins", "30日お試しから 本入会", " 名");
  const joins = totalJoins(v);
  line("本入会（合計）", joins === undefined ? NA : num(joins, " 名"));
  L.push("");

  // ---------- 転換率 ----------
  L.push("## 2. 各転換率（アプリが計算。AI は計算しないこと）", "");
  kpi("inquiry_booking_rate", "問い合わせ → 見学率");
  kpi("show_rate", "見学予約 → 実来館率");
  kpi("trial_rate", "見学 → 30日お試し率");
  kpi("direct_join_rate", "見学 → 直接 本入会率");
  kpi("visit_join_rate", "見学 → 本入会率（直接 + お試し経由）");
  kpi("visit_conversion_rate", "見学 → お試しまたは本入会 移行率");
  kpi("trial_join_rate", "30日お試し → 本入会率");
  kpi("join_rate", "新規入会率");
  kpi("churn_rate", "退会率");
  L.push("");
  for (const k of kpis) {
    if (k.value !== null) L.push(`  ${k.label} の計算式: ${k.formula}`);
  }
  L.push("");

  // ---------- 前月比較 ----------
  L.push("## 3. 前月比較", "");
  if (!cmp || !cmp.previousPeriod) {
    L.push(`${NA}（前月の入力がないため比較できません。単月の数字だけで判断してください）`);
  } else {
    const changed = cmp.rows.filter((r) => r.delta !== null);
    if (changed.length === 0) L.push(NA);
    for (const r of changed) {
      const sign = r.delta! > 0 ? "+" : "";
      const avg = r.avg3 !== null ? ` / 過去3か月平均 ${r.avg3}` : "";
      L.push(`${r.label}: ${r.current}${r.unit} ← 前月 ${r.previous}${r.unit} / 増減 ${sign}${r.delta}${r.deltaPct !== null ? `（${sign}${r.deltaPct}%）` : ""}${avg}`);
    }
  }
  L.push("");

  // ---------- 前年比 ----------
  L.push("## 4. 前年同月比", "");
  if (!cmp || !cmp.lastYearPeriod) {
    L.push(`${NA}（前年同月の入力がありません）`);
  } else {
    const yoy = cmp.rows.filter((r) => r.yoyDelta !== null);
    if (yoy.length === 0) L.push(NA);
    for (const r of yoy) {
      const sign = r.yoyDelta! > 0 ? "+" : "";
      L.push(`${r.label}: ${r.current}${r.unit} ← 前年 ${r.lastYear}${r.unit} / 増減 ${sign}${r.yoyDelta}${r.yoyPct !== null ? `（${sign}${r.yoyPct}%）` : ""}`);
    }
  }
  L.push("");

  // ---------- 集客の数字（ブロックごと） ----------
  const blocks: Array<[string, string]> = [
    ["gbp", "5. Google ビジネスプロフィール"],
    ["gsc", "6. Google Search Console"],
    ["ga4", "7. Google Analytics 4"],
    ["clarity", "8. ヒートマップ・行動分析"],
  ];
  for (const [groupId, heading] of blocks) {
    const group = METRIC_GROUPS.find((g) => g.id === groupId)!;
    L.push(`## ${heading}（出どころ: ${SOURCE_LABEL[group.source]}）`, "");
    const rows = group.metrics.filter((m) => v[m.id] !== undefined);
    if (rows.length === 0) L.push(NA);
    for (const m of rows) L.push(`${m.label}: ${num(v[m.id])} ${m.unit}${comparisonSuffix(cmp, m.id)}`);
    if (groupId === "gbp") {
      const k = kpiMap.get("gbp_click_rate");
      L.push(`表示 → Web クリック率: ${k?.value === null || k === undefined ? NA : pct(k.value)}`);
    }
    if (groupId === "gsc") {
      const k = kpiMap.get("gsc_ctr_calc");
      L.push(`CTR: ${k?.value === null || k === undefined ? NA : pct(k.value)}`);
      L.push("", "重要検索キーワード:");
      if (input.keywords.length === 0) L.push(`  ${NA}`);
      for (const kw of input.keywords) {
        L.push(`  ${kw.keyword}: 表示 ${num(kw.impressions)} / クリック ${num(kw.clicks)} / CTR ${pct(kw.ctr)} / 平均掲載順位 ${num(kw.position)}`);
      }
    }
    if (groupId === "ga4") {
      for (const id of ["hp_trial_page_rate", "hp_cta_rate", "hp_booking_rate"]) {
        const k = kpiMap.get(id);
        if (k) L.push(`${k.label}: ${k.value === null ? `${NA}（${k.missing}）` : pct(k.value)}`);
      }
    }
    if (groupId === "clarity") {
      L.push("", "ヒートマップで分かったこと（人が書いた所見）:");
      L.push(input.notes.heatmap ? input.notes.heatmap : `  ${NA}`);
    }
    L.push("");
  }

  // ---------- 認知経路と流入チャネル ----------
  L.push("## 9. 認知経路（見学・体験者に聞いた「何で知りましたか」）", "");
  const aw = channelShares(v);
  if (aw.rows.length === 0) L.push(NA);
  else {
    for (const r of aw.rows) L.push(`${r.label}: ${num(r.count, " 名")}${r.share !== null ? `（${r.share}%）` : ""}`);
    L.push(`合計: ${num(aw.total, " 名")}`);
  }
  L.push("");
  L.push("## 10. 見学・体験予約の経路別", "");
  const bk = bookingShares(v);
  if (bk.rows.length === 0) L.push(NA);
  else {
    for (const r of bk.rows) L.push(`${r.label}: ${num(r.count, " 件")}${r.share !== null ? `（${r.share}%）` : ""}`);
    L.push(`合計: ${num(bk.total, " 件")}`);
  }
  L.push("");

  // ---------- ファネル判定 ----------
  L.push("## 11. 集客ファネルの判定（アプリが数字から機械的に判定）", "");
  if (!funnel) L.push(NA);
  else {
    for (const st of funnel.stages) L.push(`${st.label}: ${FUNNEL_STATUS_JA[st.status]} — ${st.reason}`);
    if (funnel.weakest) {
      const w = funnel.stages.find((s) => s.id === funnel.weakest);
      L.push(`最も詰まっている可能性が高い段階: ${w?.label ?? funnel.weakest}`);
    }
  }
  L.push("");

  // ---------- 現場で感じていること ----------
  L.push("## 12. 現場で感じていること（代表・スタッフの記述）", "");
  L.push(project.input_text?.trim() || NA);
  if (project.extra_text?.trim()) L.push("", "追加データ（貼り付け）:", project.extra_text.trim());
  L.push("");

  // ---------- 過去に実施した施策と結果 ----------
  L.push("## 13. 過去に実施した施策とその結果", "");
  if (src.pastTasks.length === 0) L.push(NA);
  else {
    const statusJa: Record<string, string> = { completed: "完了", in_progress: "実行中", awaiting_verification: "検証待ち", rejected: "却下", producing: "成果物作成中", awaiting_approval: "承認待ち" };
    for (const t of src.pastTasks) {
      const k = t.kpis
        .map((x) => `${x.name}: 施策前 ${num(x.baseline_value)} → 目標 ${num(x.target_value)} → 実績 ${num(x.actual_value)}${x.verdict ? ` / 判断 ${{ continue: "続行", improve: "改善して再実施", stop: "中止" }[x.verdict] ?? x.verdict}` : ""}`)
        .join(" / ");
      L.push(`- [${statusJa[t.status] ?? t.status}] ${t.title}（${t.project_title} / ${t.updated_at.slice(0, 10)}）`);
      if (t.what_to_do) L.push(`    内容: ${t.what_to_do.replace(/\n/g, " ").slice(0, 200)}`);
      L.push(`    KPI: ${k || NA}`);
    }
  }
  L.push("");

  // ---------- ナレッジ ----------
  L.push("## 14. 過去の学び（ナレッジ）", "");
  if (src.knowledge.length === 0) L.push(NA);
  else {
    const kindJa: Record<string, string> = { success: "成功", failure: "失敗", idea: "却下・案", analysis: "分析", learning: "学び" };
    for (const k of src.knowledge) {
      const d = k.data_json ? (JSON.parse(k.data_json) as Record<string, unknown>) : null;
      L.push(`- [${kindJa[k.kind] ?? k.kind}] ${k.title}（${k.created_at.slice(0, 10)}）`);
      if (d?.lesson) L.push(`    学び: ${d.lesson}`);
      if (d?.next_time) L.push(`    次回は: ${d.next_time}`);
    }
  }
  L.push("");

  // ---------- 現在の KPI 目標 ----------
  L.push("## 15. 現在追いかけている KPI（実行中・検証待ちの施策）", "");
  const active = src.pastTasks.filter((t) => t.status === "in_progress" || t.status === "awaiting_verification" || t.status === "producing");
  if (active.length === 0) L.push(NA);
  else {
    for (const t of active) {
      for (const x of t.kpis) L.push(`- ${x.name}: 現在値 ${num(x.baseline_value)} → 目標 ${num(x.target_value)}${x.measure_by ? `（期日 ${x.measure_by}）` : ""} ／ 施策「${t.title}」`);
    }
  }
  L.push("");

  // ---------- 不足データ ----------
  L.push("## 16. 不足データ（入力されていない項目）", "");
  const missingKpis = kpis.filter((k) => k.value === null);
  const missingBlocks: string[] = [];
  for (const g of METRIC_GROUPS) {
    const filled = g.metrics.filter((m) => v[m.id] !== undefined).length;
    if (filled === 0) missingBlocks.push(`${g.label}（${g.metrics.length} 項目すべて未入力）`);
    else if (filled < g.metrics.length) {
      const lack = g.metrics.filter((m) => v[m.id] === undefined).map((m) => m.label);
      missingBlocks.push(`${g.label}: ${lack.join("、")}`);
    }
  }
  if (missingBlocks.length === 0) L.push("未入力の項目はありません。");
  for (const b of missingBlocks) L.push(`- ${b}`);
  if (missingKpis.length > 0) {
    L.push("", "そのため計算できなかった KPI:");
    for (const k of missingKpis) L.push(`- ${k.label}: ${k.missing ?? "必要な数字が未入力"}`);
  }
  L.push("");

  L.push(INSTRUCTION);
  return L.join("\n");
}

/** レポートの最後に必ず付ける、ChatGPT への依頼文 */
export const INSTRUCTION = `---

このデータをLife Design ViXerの経営補佐として分析してください。

事実と仮説を明確に分けて、

①現状
②最大の問題
③原因仮説
④不足しているデータ
⑤最優先施策3つ以内
⑥今やらなくていいこと
⑦次回確認するKPI
⑧必要なら担当AI社員
⑨具体的な実行案

を出してください。

施策は『インパクト ÷ 必要時間』を重視して優先順位を決めてください。
入力されていない数字を事実として補完しないでください。`;
