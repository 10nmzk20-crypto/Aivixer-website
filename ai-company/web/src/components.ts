/** 画面共通の小さな部品 */
export const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export const PROJECT_STATUS_JA: Record<string, string> = {
  analyzing: "分析中", candidates: "施策候補", awaiting_approval: "代表承認待ち", in_progress: "実行中",
  awaiting_verification: "検証待ち", completed: "完了", rejected: "却下", failed: "エラー",
};
export const TASK_STATUS_JA: Record<string, string> = {
  candidate: "作成中", awaiting_approval: "承認待ち", revising: "修正中", in_progress: "実行中",
  awaiting_verification: "検証待ち", verifying: "検証中", completed: "完了", rejected: "却下", failed: "エラー",
};
export const DEPT_JA: Record<string, string> = { analysis: "分析部", command: "経営司令塔", execution: "実行部" };
export const RESTRICTED_JA: Record<string, string> = {
  publish_hp: "HP の本番公開", run_ads: "広告の出稿", post_sns: "SNS 投稿", send_line: "LINE の送信", change_price: "料金の変更", edit_member_data: "会員データの変更",
};
export const KNOWLEDGE_KIND_JA: Record<string, string> = { success: "成功", failure: "失敗", idea: "却下・案", analysis: "分析", learning: "学び" };
export const OUTCOME_JA: Record<string, string> = { success: "成功", failure: "失敗", hold: "保留" };
export const FUNNEL_STATUS_JA: Record<string, string> = { good: "良好", watch: "注意", problem: "問題あり", no_data: "データ不足" };
export const VERDICT_JA: Record<string, string> = { continue: "続行", improve: "改善して再実施", stop: "中止" };
export const ACHIEVEMENT_JA: Record<string, string> = { achieved: "達成", partial: "一部達成", missed: "未達" };

export const statusChip = (status: string, table: Record<string, string> = TASK_STATUS_JA) =>
  `<span class="status ${esc(status)}">${esc(table[status] ?? status)}</span>`;

export const fmtDate = (iso: string | null | undefined, withTime = false): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  const base = `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
  return withTime ? `${base} ${p(d.getHours())}:${p(d.getMinutes())}` : base;
};
export const fmtNum = (v: number | null | undefined): string => (v === null || v === undefined ? "—" : Number(v).toLocaleString("ja-JP"));

let toastTimer: number | undefined;
export function toast(message: string): void {
  const el = document.getElementById("toast")!;
  el.textContent = message;
  el.dataset.show = "1";
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.dataset.show = "0"), 3200);
}

export function errorBox(message: string, retryLabel?: string): string {
  return `<div class="error"><b>問題が起きました。</b> ${esc(message)}${retryLabel ? ` <button type="button" class="btn sm" data-retry style="margin-left:12px">${esc(retryLabel)}</button>` : ""}</div>`;
}

/** 数値入力の "4,180,000" → 4180000 */
export const parseNum = (s: string): number | null => {
  const t = s.replace(/[,，\s]/g, "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};
