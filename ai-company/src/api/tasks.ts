import { Hono } from "hono";
import type { Env } from "../env";
import { Repo, type TaskRow } from "../db/repo";
import { employeeName } from "../employees/roster";

/** 施策（タスク）の承認・状態変更・KPI */
export function taskRoutes() {
  const r = new Hono<{ Bindings: Env }>();

  /** 採用 / 修正 / 却下 */
  r.post("/tasks/:id/approval", async (c) => {
    const repo = new Repo(c.env.DB);
    const task = await repo.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ decision?: string; note?: string; kpis?: KpiInput[] }>();
    const decision = body.decision;
    const note = (body.note ?? "").trim() || null;
    if (decision !== "adopted" && decision !== "revise" && decision !== "rejected") return c.json({ error: "bad_decision" }, 400);
    if (task.status !== "awaiting_approval") return c.json({ error: "bad_state", message: "承認待ちの施策だけ判断できます。" }, 400);
    if (decision === "revise" && !note) return c.json({ error: "note_required", message: "修正指示を入力してください。" }, 400);

    const latest = await repo.latestOutput(task.id);
    await repo.createApproval({ task_id: task.id, output_id: latest?.id ?? null, decision, note });

    if (decision === "adopted") {
      if (body.kpis?.length) await repo.replaceKpis(task.id, normalizeKpis(body.kpis), true);
      else for (const k of await repo.listKpis(task.id)) await repo.updateKpi(k.id, { confirmed: 1 });
      await repo.updateTask(task.id, { status: "in_progress" });
    } else if (decision === "revise") {
      await repo.updateTask(task.id, { status: "revising" });
      await c.env.REVISION_PIPELINE.create({ params: { taskId: task.id, note: note! } });
    } else {
      await repo.updateTask(task.id, { status: "rejected" });
      await repo.createKnowledge({
        kind: "idea",
        title: `却下した案: ${task.title}`,
        body_md: `${task.objective}\n\n却下理由: ${note ?? "（理由の記載なし）"}`,
        tags: tagsFor(task),
        source_type: "task",
        source_id: task.id,
      });
    }
    const projectStatus = await repo.recomputeProjectStatus(task.project_id);
    return c.json({ ok: true, task: await repo.getTask(task.id), project_status: projectStatus });
  });

  /** 「実施した」→ 検証待ち */
  r.post("/tasks/:id/status", async (c) => {
    const repo = new Repo(c.env.DB);
    const task = await repo.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ status?: string }>();
    if (body.status === "awaiting_verification") {
      if (task.status !== "in_progress") return c.json({ error: "bad_state", message: "実行中の施策だけ「実施した」にできます。" }, 400);
      await repo.updateTask(task.id, { status: "awaiting_verification" });
    } else if (body.status === "in_progress") {
      if (task.status !== "awaiting_verification") return c.json({ error: "bad_state" }, 400);
      await repo.updateTask(task.id, { status: "in_progress" });
    } else {
      return c.json({ error: "bad_status" }, 400);
    }
    const projectStatus = await repo.recomputeProjectStatus(task.project_id);
    return c.json({ ok: true, task: await repo.getTask(task.id), project_status: projectStatus });
  });

  /** KPI 実績を入れて 続行 / 改善 / 中止 を決める → 完了。ナレッジに保存 */
  r.post("/tasks/:id/verify", async (c) => {
    const repo = new Repo(c.env.DB);
    const task = await repo.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "not_found" }, 404);
    if (task.status !== "awaiting_verification") return c.json({ error: "bad_state", message: "検証待ちの施策だけ検証できます。" }, 400);
    const body = await c.req.json<{ verdict?: string; note?: string; kpis?: Array<{ id: string; actual_value: number | null }> }>();
    const verdict = body.verdict;
    if (verdict !== "continue" && verdict !== "improve" && verdict !== "stop") return c.json({ error: "bad_verdict" }, 400);
    const note = (body.note ?? "").trim() || null;
    const t = new Date().toISOString();
    for (const k of body.kpis ?? []) {
      const row = await repo.getKpi(k.id);
      if (row && row.task_id === task.id) await repo.updateKpi(k.id, { actual_value: k.actual_value ?? null });
    }
    for (const k of await repo.listKpis(task.id)) await repo.updateKpi(k.id, { verdict, verdict_note: note, verified_at: t });
    await repo.updateTask(task.id, { status: "completed" });

    const kpis = await repo.listKpis(task.id);
    const kind = verdict === "continue" ? "success" : verdict === "stop" ? "failure" : "learning";
    const verdictJa = { continue: "続行", improve: "改善", stop: "中止" }[verdict];
    const kpiLines = kpis.map((k) => `- ${k.name}: ${fmt(k.baseline_value)} → ${fmt(k.actual_value)}${k.unit ? " " + k.unit : ""}（目標 ${fmt(k.target_value)}）`).join("\n");
    await repo.createKnowledge({
      kind,
      title: `${verdictJa}: ${task.title}`,
      body_md: `担当: ${employeeName(task.executor_employee_id)}\n目的: ${task.objective}\n\nKPI:\n${kpiLines || "（KPI 未設定）"}\n\n判断: ${verdictJa}${note ? `\n${note}` : ""}`,
      tags: tagsFor(task),
      source_type: "task",
      source_id: task.id,
    });
    const projectStatus = await repo.recomputeProjectStatus(task.project_id);
    return c.json({ ok: true, task: await repo.getTask(task.id), kpis, project_status: projectStatus });
  });

  /** KPI 目標の設定（複数まとめて置き換え） */
  r.put("/tasks/:id/kpis", async (c) => {
    const repo = new Repo(c.env.DB);
    const task = await repo.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<{ kpis?: KpiInput[] }>();
    const kpis = await repo.replaceKpis(task.id, normalizeKpis(body.kpis ?? []), task.status !== "awaiting_approval" && task.status !== "candidate");
    return c.json({ ok: true, kpis });
  });

  /** KPI 1 件の実績・メモ更新 */
  r.patch("/kpis/:id", async (c) => {
    const repo = new Repo(c.env.DB);
    const kpi = await repo.getKpi(c.req.param("id"));
    if (!kpi) return c.json({ error: "not_found" }, 404);
    const body = await c.req.json<Partial<{ name: string; unit: string | null; baseline_value: number | null; target_value: number | null; actual_value: number | null; measure_by: string | null; verdict_note: string | null }>>();
    const patch: Record<string, unknown> = {};
    for (const key of ["name", "unit", "baseline_value", "target_value", "actual_value", "measure_by", "verdict_note"] as const) {
      if (key in body) patch[key] = body[key] ?? null;
    }
    await repo.updateKpi(kpi.id, patch);
    return c.json({ ok: true, kpi: await repo.getKpi(kpi.id) });
  });

  return r;
}

interface KpiInput { name: string; unit?: string | null; baseline_value?: number | null; target_value?: number | null; measure_by?: string | null }

function normalizeKpis(kpis: KpiInput[]) {
  return kpis
    .filter((k) => k && typeof k.name === "string" && k.name.trim())
    .slice(0, 5)
    .map((k) => ({ name: k.name.trim(), unit: k.unit?.trim() || null, baseline_value: num(k.baseline_value), target_value: num(k.target_value), measure_by: k.measure_by?.trim() || null }));
}
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
const fmt = (v: number | null) => (v === null ? "—" : String(v));

function tagsFor(task: TaskRow): string[] {
  const tags = new Set<string>([employeeName(task.executor_employee_id)]);
  for (const [word, tag] of [["LINE", "LINE"], ["見学", "見学"], ["お試し", "30日お試し"], ["退会", "退会"], ["休眠", "継続"], ["Google", "Google"], ["広告", "広告"], ["SNS", "SNS"], ["HP", "HP"], ["料金", "料金"], ["パーソナル", "パーソナル"]]) {
    if (task.title.includes(word) || task.objective.includes(word)) tags.add(tag);
  }
  return [...tags];
}
