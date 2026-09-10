/// <reference types="@cloudflare/workers-types" />
/** D1 の読み書きをまとめる。SQL はこのファイルにだけ書く。 */

export interface EmployeeRow { id: string; name: string; department: string; role_summary: string; watches_json: string; sort_order: number; is_active: number }
export interface ProjectRow {
  id: string; title: string; period_label: string | null; input_text: string; input_data_json: string | null; extra_text: string | null;
  analyst_mode: string; selected_analysts_json: string | null; selection_reason: string | null; status: string;
  workflow_instance_id: string | null; error: string | null; created_at: string; updated_at: string;
}
export interface AnalysisRow {
  id: string; project_id: string; employee_id: string; status: string; headline: string | null; facts_json: string | null; hypotheses_json: string | null;
  needed_data_json: string | null; findings_md: string | null; model: string | null; input_tokens: number | null; output_tokens: number | null; created_at: string;
}
export interface DecisionRow {
  id: string; project_id: string; version: number; summary_md: string; facts_json: string; hypotheses_json: string; needed_data_json: string; not_now_json: string;
  model: string | null; input_tokens: number | null; output_tokens: number | null; created_at: string;
}
export interface TaskRow {
  id: string; project_id: string; decision_id: string; rank: number; title: string; objective: string; reasoning: string; impact_score: number; effort_hours: number;
  executor_employee_id: string; assignment_reason: string; restricted_actions_json: string; status: string; due_date: string | null; created_at: string; updated_at: string;
}
export interface OutputRow {
  id: string; task_id: string; employee_id: string; version: number; kind: string; title: string; content_md: string; revision_note: string | null;
  model: string | null; input_tokens: number | null; output_tokens: number | null; created_at: string;
}
export interface ApprovalRow { id: string; task_id: string; output_id: string | null; decision: string; note: string | null; decided_by: string; decided_at: string }
export interface KpiRow {
  id: string; task_id: string; name: string; unit: string | null; baseline_value: number | null; target_value: number | null; actual_value: number | null;
  measure_by: string | null; confirmed: number; verdict: string | null; verdict_note: string | null; verified_at: string | null; created_at: string; updated_at: string;
}
export interface KnowledgeRow { id: string; kind: string; title: string; body_md: string; tags_json: string; source_type: string | null; source_id: string | null; created_at: string }

export const PROJECT_STATUSES = ["analyzing", "candidates", "awaiting_approval", "in_progress", "awaiting_verification", "completed", "rejected", "failed"] as const;
export const TASK_STATUSES = ["candidate", "awaiting_approval", "revising", "in_progress", "awaiting_verification", "completed", "rejected", "failed"] as const;

export const now = () => new Date().toISOString();
export const newId = () => crypto.randomUUID();
const json = (v: unknown) => JSON.stringify(v ?? null);

export class Repo {
  constructor(private db: D1Database) {}

  // ---------- AI 社員 ----------
  async listEmployees(): Promise<EmployeeRow[]> {
    const r = await this.db.prepare("SELECT * FROM ai_employees WHERE is_active = 1 ORDER BY sort_order").all<EmployeeRow>();
    return r.results;
  }
  async getEmployee(id: string): Promise<EmployeeRow | null> {
    return (await this.db.prepare("SELECT * FROM ai_employees WHERE id = ?").bind(id).first<EmployeeRow>()) ?? null;
  }

  // ---------- 案件 ----------
  async createProject(input: { title: string; period_label: string | null; input_text: string; input_data: unknown; extra_text: string | null; analyst_mode: string }): Promise<ProjectRow> {
    const id = newId();
    const t = now();
    await this.db
      .prepare("INSERT INTO projects (id, title, period_label, input_text, input_data_json, extra_text, analyst_mode, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'analyzing', ?, ?)")
      .bind(id, input.title, input.period_label, input.input_text, input.input_data == null ? null : json(input.input_data), input.extra_text, input.analyst_mode, t, t)
      .run();
    return (await this.getProject(id))!;
  }
  async getProject(id: string): Promise<ProjectRow | null> {
    return (await this.db.prepare("SELECT * FROM projects WHERE id = ?").bind(id).first<ProjectRow>()) ?? null;
  }
  async listProjects(opts: { status?: string; limit?: number } = {}): Promise<ProjectRow[]> {
    const limit = Math.min(opts.limit ?? 50, 200);
    const stmt = opts.status
      ? this.db.prepare("SELECT * FROM projects WHERE status = ? ORDER BY created_at DESC LIMIT ?").bind(opts.status, limit)
      : this.db.prepare("SELECT * FROM projects ORDER BY created_at DESC LIMIT ?").bind(limit);
    return (await stmt.all<ProjectRow>()).results;
  }
  async updateProject(id: string, patch: Partial<Omit<ProjectRow, "id" | "created_at">>): Promise<void> {
    const entries = Object.entries({ ...patch, updated_at: now() });
    const sets = entries.map(([k]) => `${k} = ?`).join(", ");
    await this.db.prepare(`UPDATE projects SET ${sets} WHERE id = ?`).bind(...entries.map(([, v]) => v ?? null), id).run();
  }
  async countProjectsByStatus(): Promise<Record<string, number>> {
    const r = await this.db.prepare("SELECT status, COUNT(*) AS n FROM projects GROUP BY status").all<{ status: string; n: number }>();
    return Object.fromEntries(r.results.map((x) => [x.status, x.n]));
  }
  async hasRunningAnalysis(): Promise<boolean> {
    const r = await this.db.prepare("SELECT COUNT(*) AS n FROM projects WHERE status = 'analyzing'").first<{ n: number }>();
    return (r?.n ?? 0) > 0;
  }
  async latestDecidedProject(): Promise<ProjectRow | null> {
    return (await this.db.prepare("SELECT * FROM projects WHERE status NOT IN ('analyzing','failed') ORDER BY created_at DESC LIMIT 1").first<ProjectRow>()) ?? null;
  }

  // ---------- 分析結果 ----------
  async markAnalysisRunning(projectId: string, employeeId: string): Promise<void> {
    await this.db
      .prepare("INSERT OR IGNORE INTO analyses (id, project_id, employee_id, status, created_at) VALUES (?, ?, ?, 'running', ?)")
      .bind(newId(), projectId, employeeId, now())
      .run();
  }
  async completeAnalysis(projectId: string, employeeId: string, d: { headline: string; facts: string[]; hypotheses: string[]; needed_data: string[]; findings_md: string; model: string; input_tokens: number; output_tokens: number }): Promise<void> {
    await this.db
      .prepare("UPDATE analyses SET status = 'done', headline = ?, facts_json = ?, hypotheses_json = ?, needed_data_json = ?, findings_md = ?, model = ?, input_tokens = ?, output_tokens = ?, created_at = ? WHERE project_id = ? AND employee_id = ?")
      .bind(d.headline, json(d.facts), json(d.hypotheses), json(d.needed_data), d.findings_md, d.model, d.input_tokens, d.output_tokens, now(), projectId, employeeId)
      .run();
  }
  async failAnalysis(projectId: string, employeeId: string, message: string): Promise<void> {
    await this.db.prepare("UPDATE analyses SET status = 'failed', findings_md = ? WHERE project_id = ? AND employee_id = ?").bind(message, projectId, employeeId).run();
  }
  async getAnalysis(projectId: string, employeeId: string): Promise<AnalysisRow | null> {
    return (await this.db.prepare("SELECT * FROM analyses WHERE project_id = ? AND employee_id = ?").bind(projectId, employeeId).first<AnalysisRow>()) ?? null;
  }
  async listAnalyses(projectId: string): Promise<AnalysisRow[]> {
    const r = await this.db.prepare("SELECT a.* FROM analyses a JOIN ai_employees e ON e.id = a.employee_id WHERE a.project_id = ? ORDER BY e.sort_order").bind(projectId).all<AnalysisRow>();
    return r.results;
  }
  async listAnalysesByEmployee(employeeId: string, limit = 10): Promise<Array<AnalysisRow & { project_title: string }>> {
    const r = await this.db
      .prepare("SELECT a.*, p.title AS project_title FROM analyses a JOIN projects p ON p.id = a.project_id WHERE a.employee_id = ? ORDER BY a.created_at DESC LIMIT ?")
      .bind(employeeId, limit)
      .all<AnalysisRow & { project_title: string }>();
    return r.results;
  }

  // ---------- 司令塔の判断 ----------
  async createDecision(projectId: string, d: { summary_md: string; facts: string[]; hypotheses: string[]; needed_data: string[]; not_now: unknown[]; model: string; input_tokens: number; output_tokens: number }): Promise<DecisionRow> {
    const prev = await this.db.prepare("SELECT MAX(version) AS v FROM decisions WHERE project_id = ?").bind(projectId).first<{ v: number | null }>();
    const version = (prev?.v ?? 0) + 1;
    const id = newId();
    await this.db
      .prepare("INSERT INTO decisions (id, project_id, version, summary_md, facts_json, hypotheses_json, needed_data_json, not_now_json, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, projectId, version, d.summary_md, json(d.facts), json(d.hypotheses), json(d.needed_data), json(d.not_now), d.model, d.input_tokens, d.output_tokens, now())
      .run();
    return (await this.db.prepare("SELECT * FROM decisions WHERE id = ?").bind(id).first<DecisionRow>())!;
  }
  async getLatestDecision(projectId: string): Promise<DecisionRow | null> {
    return (await this.db.prepare("SELECT * FROM decisions WHERE project_id = ? ORDER BY version DESC LIMIT 1").bind(projectId).first<DecisionRow>()) ?? null;
  }

  // ---------- 施策（タスク） ----------
  async createTask(d: { project_id: string; decision_id: string; rank: number; title: string; objective: string; reasoning: string; impact_score: number; effort_hours: number; executor_employee_id: string; assignment_reason: string; restricted_actions: string[]; due_date: string | null }): Promise<TaskRow> {
    const id = newId();
    const t = now();
    await this.db
      .prepare("INSERT INTO tasks (id, project_id, decision_id, rank, title, objective, reasoning, impact_score, effort_hours, executor_employee_id, assignment_reason, restricted_actions_json, status, due_date, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'candidate', ?, ?, ?)")
      .bind(id, d.project_id, d.decision_id, d.rank, d.title, d.objective, d.reasoning, d.impact_score, d.effort_hours, d.executor_employee_id, d.assignment_reason, json(d.restricted_actions), d.due_date, t, t)
      .run();
    return (await this.getTask(id))!;
  }
  async getTask(id: string): Promise<TaskRow | null> {
    return (await this.db.prepare("SELECT * FROM tasks WHERE id = ?").bind(id).first<TaskRow>()) ?? null;
  }
  async listTasks(projectId: string): Promise<TaskRow[]> {
    return (await this.db.prepare("SELECT * FROM tasks WHERE project_id = ? ORDER BY rank").bind(projectId).all<TaskRow>()).results;
  }
  async listTasksByStatus(statuses: string[], limit = 20): Promise<Array<TaskRow & { project_title: string }>> {
    const marks = statuses.map(() => "?").join(",");
    const r = await this.db
      .prepare(`SELECT t.*, p.title AS project_title FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.status IN (${marks}) ORDER BY t.updated_at DESC LIMIT ?`)
      .bind(...statuses, limit)
      .all<TaskRow & { project_title: string }>();
    return r.results;
  }
  async listTasksByExecutor(employeeId: string, statuses: string[] | null, limit = 10): Promise<Array<TaskRow & { project_title: string }>> {
    const where = statuses ? `AND t.status IN (${statuses.map(() => "?").join(",")})` : "";
    const r = await this.db
      .prepare(`SELECT t.*, p.title AS project_title FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.executor_employee_id = ? ${where} ORDER BY t.updated_at DESC LIMIT ?`)
      .bind(employeeId, ...(statuses ?? []), limit)
      .all<TaskRow & { project_title: string }>();
    return r.results;
  }
  async updateTask(id: string, patch: Partial<Omit<TaskRow, "id" | "created_at">>): Promise<void> {
    const entries = Object.entries({ ...patch, updated_at: now() });
    const sets = entries.map(([k]) => `${k} = ?`).join(", ");
    await this.db.prepare(`UPDATE tasks SET ${sets} WHERE id = ?`).bind(...entries.map(([, v]) => v ?? null), id).run();
  }
  async countTasksByStatus(): Promise<Record<string, number>> {
    const r = await this.db.prepare("SELECT status, COUNT(*) AS n FROM tasks GROUP BY status").all<{ status: string; n: number }>();
    return Object.fromEntries(r.results.map((x) => [x.status, x.n]));
  }

  // ---------- 成果物 ----------
  async createOutput(d: { task_id: string; employee_id: string; kind: string; title: string; content_md: string; revision_note: string | null; model: string; input_tokens: number; output_tokens: number }): Promise<OutputRow> {
    const prev = await this.db.prepare("SELECT MAX(version) AS v FROM outputs WHERE task_id = ?").bind(d.task_id).first<{ v: number | null }>();
    const version = (prev?.v ?? 0) + 1;
    const id = newId();
    await this.db
      .prepare("INSERT INTO outputs (id, task_id, employee_id, version, kind, title, content_md, revision_note, model, input_tokens, output_tokens, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, d.task_id, d.employee_id, version, d.kind, d.title, d.content_md, d.revision_note, d.model, d.input_tokens, d.output_tokens, now())
      .run();
    return (await this.db.prepare("SELECT * FROM outputs WHERE id = ?").bind(id).first<OutputRow>())!;
  }
  async listOutputs(taskId: string): Promise<OutputRow[]> {
    return (await this.db.prepare("SELECT * FROM outputs WHERE task_id = ? ORDER BY version").bind(taskId).all<OutputRow>()).results;
  }
  async latestOutput(taskId: string): Promise<OutputRow | null> {
    return (await this.db.prepare("SELECT * FROM outputs WHERE task_id = ? ORDER BY version DESC LIMIT 1").bind(taskId).first<OutputRow>()) ?? null;
  }
  async listOutputsByEmployee(employeeId: string, limit = 10): Promise<Array<OutputRow & { task_title: string; project_id: string; task_status: string }>> {
    const r = await this.db
      .prepare("SELECT o.*, t.title AS task_title, t.project_id AS project_id, t.status AS task_status FROM outputs o JOIN tasks t ON t.id = o.task_id WHERE o.employee_id = ? ORDER BY o.created_at DESC LIMIT ?")
      .bind(employeeId, limit)
      .all<OutputRow & { task_title: string; project_id: string; task_status: string }>();
    return r.results;
  }

  // ---------- 承認 ----------
  async createApproval(d: { task_id: string; output_id: string | null; decision: string; note: string | null; decided_by?: string }): Promise<ApprovalRow> {
    const id = newId();
    await this.db
      .prepare("INSERT INTO approvals (id, task_id, output_id, decision, note, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .bind(id, d.task_id, d.output_id, d.decision, d.note, d.decided_by ?? "代表", now())
      .run();
    return (await this.db.prepare("SELECT * FROM approvals WHERE id = ?").bind(id).first<ApprovalRow>())!;
  }
  async listApprovals(taskId: string): Promise<ApprovalRow[]> {
    return (await this.db.prepare("SELECT * FROM approvals WHERE task_id = ? ORDER BY decided_at").bind(taskId).all<ApprovalRow>()).results;
  }

  // ---------- KPI ----------
  async replaceKpis(taskId: string, kpis: Array<{ name: string; unit: string | null; baseline_value: number | null; target_value: number | null; measure_by: string | null }>, confirmed: boolean): Promise<KpiRow[]> {
    const t = now();
    const stmts = [this.db.prepare("DELETE FROM kpis WHERE task_id = ?").bind(taskId)];
    for (const k of kpis) {
      stmts.push(
        this.db
          .prepare("INSERT INTO kpis (id, task_id, name, unit, baseline_value, target_value, measure_by, confirmed, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
          .bind(newId(), taskId, k.name, k.unit, k.baseline_value, k.target_value, k.measure_by, confirmed ? 1 : 0, t, t),
      );
    }
    await this.db.batch(stmts);
    return this.listKpis(taskId);
  }
  async listKpis(taskId: string): Promise<KpiRow[]> {
    return (await this.db.prepare("SELECT * FROM kpis WHERE task_id = ? ORDER BY created_at, rowid").bind(taskId).all<KpiRow>()).results;
  }
  async getKpi(id: string): Promise<KpiRow | null> {
    return (await this.db.prepare("SELECT * FROM kpis WHERE id = ?").bind(id).first<KpiRow>()) ?? null;
  }
  async updateKpi(id: string, patch: Partial<Omit<KpiRow, "id" | "task_id" | "created_at">>): Promise<void> {
    const entries = Object.entries({ ...patch, updated_at: now() });
    const sets = entries.map(([k]) => `${k} = ?`).join(", ");
    await this.db.prepare(`UPDATE kpis SET ${sets} WHERE id = ?`).bind(...entries.map(([, v]) => v ?? null), id).run();
  }

  // ---------- ナレッジ ----------
  async createKnowledge(d: { kind: string; title: string; body_md: string; tags: string[]; source_type: string | null; source_id: string | null }): Promise<KnowledgeRow> {
    const id = newId();
    await this.db
      .prepare("INSERT INTO knowledge (id, kind, title, body_md, tags_json, source_type, source_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
      .bind(id, d.kind, d.title, d.body_md, json(d.tags), d.source_type, d.source_id, now())
      .run();
    return (await this.db.prepare("SELECT * FROM knowledge WHERE id = ?").bind(id).first<KnowledgeRow>())!;
  }
  async listKnowledge(opts: { kind?: string; limit?: number } = {}): Promise<KnowledgeRow[]> {
    const limit = Math.min(opts.limit ?? 100, 500);
    const stmt = opts.kind
      ? this.db.prepare("SELECT * FROM knowledge WHERE kind = ? ORDER BY created_at DESC LIMIT ?").bind(opts.kind, limit)
      : this.db.prepare("SELECT * FROM knowledge ORDER BY created_at DESC LIMIT ?").bind(limit);
    return (await stmt.all<KnowledgeRow>()).results;
  }
  async countKnowledge(): Promise<number> {
    return (await this.db.prepare("SELECT COUNT(*) AS n FROM knowledge").first<{ n: number }>())?.n ?? 0;
  }

  // ---------- 案件の状態を施策から決め直す ----------
  async recomputeProjectStatus(projectId: string): Promise<string> {
    const project = await this.getProject(projectId);
    if (!project) return "unknown";
    if (project.status === "analyzing" || project.status === "failed") return project.status;
    const s = (await this.listTasks(projectId)).map((t) => t.status);
    let status: string;
    if (s.length === 0) status = "completed";
    else if (s.some((x) => x === "candidate" || x === "failed")) status = "candidates";
    else if (s.some((x) => x === "awaiting_approval" || x === "revising")) status = "awaiting_approval";
    else if (s.some((x) => x === "in_progress")) status = "in_progress";
    else if (s.some((x) => x === "awaiting_verification")) status = "awaiting_verification";
    else if (s.every((x) => x === "rejected")) status = "rejected";
    else status = "completed";
    if (status !== project.status) await this.updateProject(projectId, { status });
    return status;
  }

  // ---------- 案件の全部を 1 回で ----------
  async getProjectBundle(id: string) {
    const project = await this.getProject(id);
    if (!project) return null;
    const [analyses, decision, tasks] = await Promise.all([this.listAnalyses(id), this.getLatestDecision(id), this.listTasks(id)]);
    const full = await Promise.all(
      tasks.map(async (t) => {
        const [outputs, approvals, kpis] = await Promise.all([this.listOutputs(t.id), this.listApprovals(t.id), this.listKpis(t.id)]);
        return { ...t, outputs, approvals, kpis };
      }),
    );
    return { project, analyses, decision, tasks: full };
  }
}
