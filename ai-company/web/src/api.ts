/** API 呼び出しのまとめ。認証エラーは ApiError(status=401) として投げる。 */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public mode?: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { message: text }; }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? "error", data?.message ?? `エラーが発生しました（${res.status}）`, data?.mode);
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  put: <T>(path: string, body?: unknown) => request<T>("PUT", path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body ?? {}),
};

// ---------- 型（API の返り値） ----------
export interface Employee { id: string; name: string; department: "analysis" | "command" | "execution" | "verification"; role_summary: string; watches: string[]; sort_order: number; current?: string | null }
export interface Leverage {
  type: "A" | "B" | "C" | null;
  type_note?: string | null;
  initial_hours?: number | null;
  ongoing_hours?: number | null;
  automation?: number | null;
  asset?: number | null;
  self_service?: number | null;
  staff_dependency?: number | null;
  owner_dependency?: number | null;
  human_work_change?: "decrease" | "same" | "increase" | null;
  human_work_note?: string | null;
  manual_reason?: string | null;
  score: number | null;
  formula?: string | null;
  warning?: string | null;
}

/** 経営判断の 3 軸。アプリが計算した記号と、その理由 */
export type FrameMark = "◎" | "○" | "△" | "×";
export interface Frame {
  label: string;
  summary: string;
  mark: FrameMark;
  met: string[];
  missed: string[];
  cap: string | null;
}
export interface Frames {
  laozi: Frame;
  sunzi: Frame;
  confucius: Frame;
  total: number;
  hasReject: boolean;
  /** AI が書いた補足（競合との位置関係・信頼への影響） */
  sunzi_note?: string | null;
  confucius_note?: string | null;
  warning?: string | null;
}
export interface Task {
  id: string; project_id: string; rank: number; title: string; objective: string; reasoning: string; impact_score: number; effort_hours: number;
  executor_employee_id: string; executor_name: string; assignment_reason: string; restricted_actions: string[]; status: string; due_date: string | null;
  what_to_do: string | null; human_owner: string | null; duration_days: number | null; difficulty: number | null; cost_estimate: string | null;
  plan_version: number; plan_change_note: string | null; production_error: string | null; adopted_at: string | null;
  leverage: Leverage;
  frames: Frames | null;
  created_at: string; updated_at: string;
}
export interface Output { id: string; task_id: string; employee_id: string; version: number; kind: string; title: string; content_md: string; revision_note: string | null; model: string | null; input_tokens: number | null; output_tokens: number | null; created_at: string }
export interface Approval { id: string; decision: string; note: string | null; decided_by: string; decided_at: string }
export interface Kpi { id: string; task_id: string; name: string; unit: string | null; baseline_value: number | null; target_value: number | null; actual_value: number | null; measure_by: string | null; confirmed: number; verdict: string | null; verdict_note: string | null; verified_at: string | null }
export interface Verification {
  id: string; version: number; achievement: "achieved" | "partial" | "missed"; achievement_reason: string; effect_likelihood: string; other_factors: string;
  recommendation: "continue" | "improve" | "stop"; recommendation_reason: string; next_step: string; lesson: string; next_time: string;
  kpis_snapshot: Array<{ name: string; unit: string | null; baseline_value: number | null; target_value: number | null; actual_value: number | null }>; model: string | null; created_at: string;
}
export interface TaskFull extends Task { outputs: Output[]; approvals: Approval[]; kpis: Kpi[]; verification: Verification | null }
export interface ActiveTask { id: string; project_id: string; project_title: string; title: string; status: string; executor_name: string; due_date: string | null; human_owner: string | null }
export interface Evidence { label: string; value: string; source: string }
export interface Hypothesis { hypothesis: string; rationale: string }
export interface Analysis { id: string; employee_id: string; employee_name: string; status: string; conclusion: string | null; facts: string[]; hypotheses: Hypothesis[]; evidence: Evidence[]; missing_data: string[]; actions: string[]; unverified_numbers: string[]; findings_md: string | null; model: string | null }
export interface Decision { id: string; version: number; top_issue: string; reasoning_md: string; evidence: Evidence[]; needed_data: string[]; not_now: Array<{ item: string; reason: string }>; created_at: string }
export interface RosterEntry { id: string; name: string }

/** 担当 1 人分の分析。アプリが数字から組み立てる */
export interface Finding { problem: string; fix: string; basis: string; weight: number }
export interface ToolReview {
  id: string; name: string; tool: string; question: string;
  verdict: "good" | "watch" | "problem" | "no_data";
  current: string[]; trend: string[]; findings: Finding[]; missing: string[];
}
export interface MonthlyAction { rank: number; action: string; why: string; from: string }
export interface OverallReview {
  reviews: ToolReview[];
  weakest: string | null;
  headline: string;
  actions: MonthlyAction[];
  noDataOwners: string[];
}
export interface Project {
  id: string; title: string; period_label: string | null; period_key: string | null; input_text: string; input_data: NormalizedInput | null; extra_text: string | null; analyst_mode: string;
  derived: { kpis: DerivedKpi[]; comparison: Comparison } | null; funnel: Funnel | null;
  review: OverallReview | null;
  selected_analysts: string[] | null; selection_reason: string | null; status: string; error: string | null; created_at: string; updated_at: string;
}
export interface ProjectBundle { project: Project; analyses: Analysis[]; decision: Decision | null; tasks: TaskFull[]; roster: { analysts: RosterEntry[]; commander: RosterEntry; executors: RosterEntry[] } }
export interface Dashboard {
  today: string;
  latest_project: { id: string; title: string; status: string; created_at: string } | null;
  recent_projects: Array<{ id: string; title: string; period_label: string | null; status: string; created_at: string }>;
  employees: Employee[];
  totals: { projects: number };
}
export interface KnowledgeData {
  issue?: string; period?: string | null; numbers_at_the_time?: Record<string, number | string> | null; hypotheses?: string[];
  action?: { title?: string; what_to_do?: string | null; executor?: string; human_owner?: string | null; duration_days?: number | null; effort_hours?: number; cost?: string | null };
  kpis?: Array<{ name: string; unit: string | null; baseline_value: number | null; target_value: number | null; actual_value: number | null }>;
  achievement?: string | null; result?: string; outcome?: string; lesson?: string | null; next_time?: string | null; other_factors?: string | null; reason?: string | null; date?: string;
}
export interface Report { id: string; project_id: string; version: number; period_label: string | null; content: string; char_count: number; created_at: string }
export interface Knowledge { id: string; kind: string; title: string; body_md: string; tags: string[]; source_type: string | null; source_id: string | null; outcome: string | null; data: KnowledgeData | null; created_at: string }
export interface Metric { id: string; label: string; unit: string; source: string; hint?: string; optional?: boolean }
export interface MetricGroup { id: string; label: string; description: string; source: string; open: boolean; metrics: Metric[]; owner?: string | null; owner_name?: string }
export interface NoteField { id: string; label: string; placeholder: string; group: string }
export interface KeywordRow { keyword: string; impressions: number | null; clicks: number | null; ctr: number | null; position: number | null }
export interface NormalizedInput { values: Record<string, number>; keywords: KeywordRow[]; notes: Record<string, string> }
export interface DerivedKpi { id: string; label: string; value: number | null; unit: string; formula: string; missing?: string; group: "google" | "hp" | "sales" | "member" }
export interface ComparisonRow { id: string; label: string; unit: string; current: number | null; previous: number | null; delta: number | null; deltaPct: number | null; avg3: number | null; avg6: number | null; kind: "input" | "derived" }
export interface Comparison { previousPeriod: string | null; rows: ComparisonRow[] }
export type FunnelStatus = "good" | "watch" | "problem" | "no_data";
export interface FunnelStage { id: string; label: string; status: FunnelStatus; reason: string; metrics: Array<{ label: string; value: string; delta?: string }>; severity: number }
export interface Funnel { stages: FunnelStage[]; weakest: string | null; noDataCount: number }
