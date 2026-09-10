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
export interface Employee { id: string; name: string; department: "analysis" | "command" | "execution"; role_summary: string; watches: string[]; sort_order: number; current?: string | null }
export interface Task {
  id: string; project_id: string; rank: number; title: string; objective: string; reasoning: string; impact_score: number; effort_hours: number;
  executor_employee_id: string; executor_name: string; assignment_reason: string; restricted_actions: string[]; status: string; due_date: string | null; created_at: string; updated_at: string;
}
export interface Output { id: string; task_id: string; employee_id: string; version: number; kind: string; title: string; content_md: string; revision_note: string | null; model: string | null; input_tokens: number | null; output_tokens: number | null; created_at: string }
export interface Approval { id: string; decision: string; note: string | null; decided_by: string; decided_at: string }
export interface Kpi { id: string; task_id: string; name: string; unit: string | null; baseline_value: number | null; target_value: number | null; actual_value: number | null; measure_by: string | null; confirmed: number; verdict: string | null; verdict_note: string | null; verified_at: string | null }
export interface TaskFull extends Task { outputs: Output[]; approvals: Approval[]; kpis: Kpi[] }
export interface Evidence { label: string; value: string; source: string }
export interface Analysis { id: string; employee_id: string; employee_name: string; status: string; headline: string | null; facts: string[]; hypotheses: string[]; evidence: Evidence[]; needed_data: string[]; findings_md: string | null; model: string | null }
export interface Decision { id: string; version: number; summary_md: string; facts: string[]; hypotheses: string[]; evidence: Evidence[]; needed_data: string[]; not_now: Array<{ item: string; reason: string }>; created_at: string }
export interface Project {
  id: string; title: string; period_label: string | null; input_text: string; input_data: Record<string, string | number> | null; extra_text: string | null; analyst_mode: string;
  selected_analysts: string[] | null; selection_reason: string | null; status: string; error: string | null; created_at: string; updated_at: string;
}
export interface ProjectBundle { project: Project; analyses: Analysis[]; decision: Decision | null; tasks: TaskFull[] }
export interface Dashboard {
  today: string;
  counts: { analyzing: number; awaiting_approval: number; in_progress: number; awaiting_verification: number };
  running_project: { id: string; title: string; status: string } | null;
  latest_project: { id: string; title: string; status: string; created_at: string } | null;
  priorities: Task[];
  employees: Employee[];
  totals: { projects: number; knowledge: number };
}
export interface Knowledge { id: string; kind: string; title: string; body_md: string; tags: string[]; source_type: string | null; source_id: string | null; created_at: string }
export interface Metric { id: string; label: string; unit: string }
