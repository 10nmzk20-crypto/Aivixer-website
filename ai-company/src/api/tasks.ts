import { Hono } from "hono";
import type { Env } from "../env";
import { Repo, type TaskRow } from "../db/repo";
import { employeeName } from "../employees/roster";

/** 施策（タスク）の承認・状態変更・KPI */
export function taskRoutes() {
  const r = new Hono<{ Bindings: Env }>();

  /** 採用 / 修正 / 却下（施策案の段階で代表が判断する） */
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

    await repo.createApproval({ task_id: task.id, output_id: null, decision, note });

    if (decision === "adopted") {
      // KPI を確定してから、担当の実行 AI に成果物を作らせる
      if (body.kpis?.length) await repo.replaceKpis(task.id, normalizeKpis(body.kpis), true);
      else for (const k of await repo.listKpis(task.id)) await repo.updateKpi(k.id, { confirmed: 1 });
      await repo.updateTask(task.id, { status: "producing", adopted_at: new Date().toISOString(), production_error: null });
      await c.env.EXECUTION_PIPELINE.create({ params: { taskId: task.id } });
    } else if (decision === "revise") {
      // 経営司令塔が施策案そのものを作り直す
      await repo.updateTask(task.id, { status: "plan_revising" });
      await c.env.PLAN_REVISION_PIPELINE.create({ params: { taskId: task.id, note: note! } });
    } else {
      await repo.updateTask(task.id, { status: "rejected" });
      await repo.createKnowledge({
        kind: "idea",
        title: `却下した案: ${task.title}`,
        body_md: `**課題**: ${task.objective}\n\n**内容**: ${task.what_to_do ?? task.title}\n\n**却下理由**: ${note ?? "（理由の記載なし）"}`,
        tags: tagsFor(task),
        source_type: "task",
        source_id: task.id,
        outcome: "hold",
        data: { issue: task.objective, action: { title: task.title, what_to_do: task.what_to_do }, result: "却下", reason: note, date: new Date().toISOString().slice(0, 10) },
      });
    }
    const projectStatus = await repo.recomputeProjectStatus(task.project_id);
    return c.json({ ok: true, task: await repo.getTask(task.id), project_status: projectStatus });
  });

  /** 成果物の修正を実行担当 AI に依頼する（採用後、成果物ができてから） */
  r.post("/tasks/:id/revise-output", async (c) => {
    const repo = new Repo(c.env.DB);
    const task = await repo.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "not_found" }, 404);
    if (task.status !== "in_progress") return c.json({ error: "bad_state", message: "実行中の施策だけ成果物を修正できます。" }, 400);
    const body = await c.req.json<{ note?: string }>();
    const note = (body.note ?? "").trim();
    if (!note) return c.json({ error: "note_required", message: "修正指示を入力してください。" }, 400);
    const latest = await repo.latestOutput(task.id);
    await repo.createApproval({ task_id: task.id, output_id: latest?.id ?? null, decision: "revise", note });
    await repo.updateTask(task.id, { status: "revising" });
    await c.env.REVISION_PIPELINE.create({ params: { taskId: task.id, note } });
    return c.json({ ok: true, task: await repo.getTask(task.id) });
  });

  /** 成果物の作成に失敗したとき、実行担当 AI に再依頼する */
  r.post("/tasks/:id/retry-production", async (c) => {
    const repo = new Repo(c.env.DB);
    const task = await repo.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "not_found" }, 404);
    if (task.status !== "in_progress" || !task.production_error) return c.json({ error: "bad_state", message: "成果物の作成に失敗した施策だけ再依頼できます。" }, 400);
    await repo.updateTask(task.id, { status: "producing", production_error: null });
    await c.env.EXECUTION_PIPELINE.create({ params: { taskId: task.id } });
    return c.json({ ok: true, task: await repo.getTask(task.id) });
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

  /** KPI 実績を保存し、KPI 検証担当 AI に判定を依頼する（結果は案件詳細に表示。最終判断は代表） */
  r.post("/tasks/:id/verify-ai", async (c) => {
    const repo = new Repo(c.env.DB);
    const task = await repo.getTask(c.req.param("id"));
    if (!task) return c.json({ error: "not_found" }, 404);
    if (task.status !== "awaiting_verification") return c.json({ error: "bad_state", message: "検証待ちの施策だけ判定を依頼できます。" }, 400);
    const body = await c.req.json<{ kpis?: Array<{ id: string; actual_value: number | null }> }>();
    for (const k of body.kpis ?? []) {
      const row = await repo.getKpi(k.id);
      if (row && row.task_id === task.id) await repo.updateKpi(k.id, { actual_value: num(k.actual_value) });
    }
    const kpis = await repo.listKpis(task.id);
    if (!kpis.some((k) => k.actual_value !== null)) return c.json({ error: "no_actual", message: "施策後の KPI 実績を 1 つ以上入力してください。" }, 400);
    await repo.updateTask(task.id, { status: "verifying" });
    await c.env.VERIFICATION_PIPELINE.create({ params: { taskId: task.id } });
    return c.json({ ok: true, task: await repo.getTask(task.id) });
  });

  /** KPI 実績を入れて 続行 / 改善 / 中止 を決める → 完了。構造化ナレッジに保存 */
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
      if (row && row.task_id === task.id) await repo.updateKpi(k.id, { actual_value: num(k.actual_value) });
    }
    for (const k of await repo.listKpis(task.id)) await repo.updateKpi(k.id, { verdict, verdict_note: note, verified_at: t });
    await repo.updateTask(task.id, { status: "completed" });

    const [kpis, verification, project, decision, analyses] = await Promise.all([
      repo.listKpis(task.id),
      repo.latestVerification(task.id),
      repo.getProject(task.project_id),
      repo.getLatestDecision(task.project_id),
      repo.listAnalyses(task.project_id),
    ]);
    // 成功 / 失敗 / 保留 は KPI 検証担当の達成度と代表の判断から決める
    const outcome = verdict === "stop" ? "failure" : verification?.achievement === "achieved" ? "success" : verdict === "continue" ? "success" : "hold";
    const kind = outcome === "success" ? "success" : outcome === "failure" ? "failure" : "learning";
    const verdictJa = { continue: "続行", improve: "改善して再実施", stop: "中止" }[verdict];
    const outcomeJa = { success: "成功", failure: "失敗", hold: "保留" }[outcome];
    const kpiRows = kpis.map((k) => ({ name: k.name, unit: k.unit, baseline_value: k.baseline_value, target_value: k.target_value, actual_value: k.actual_value }));
    const hypotheses = [...new Set(analyses.flatMap((a) => (JSON.parse(a.hypotheses_json ?? "[]") as Array<string | { hypothesis: string }>).map((h) => (typeof h === "string" ? h : h.hypothesis))))].slice(0, 5);

    // 次回の分析でそのまま使えるよう、構造化して保存する
    const data = {
      issue: decision?.top_issue ?? project?.input_text ?? task.objective,
      period: project?.period_label ?? null,
      numbers_at_the_time: project?.input_data_json ? JSON.parse(project.input_data_json) : null,
      hypotheses,
      action: { title: task.title, what_to_do: task.what_to_do, executor: employeeName(task.executor_employee_id), human_owner: task.human_owner, duration_days: task.duration_days, effort_hours: task.effort_hours, cost: task.cost_estimate },
      kpis: kpiRows,
      achievement: verification?.achievement ?? null,
      result: verdictJa,
      outcome,
      lesson: note ?? verification?.lesson ?? null,
      next_time: verification?.next_time ?? null,
      other_factors: verification?.other_factors ?? null,
      date: t.slice(0, 10),
    };
    const fmt = (v: number | null) => (v === null ? "不明" : String(v));
    const body_md = [
      `**課題**: ${data.issue}`,
      `**実施した施策**: ${task.title}`,
      task.what_to_do ? `**内容**: ${task.what_to_do}` : "",
      `**KPI**:`,
      kpiRows.map((k) => `- ${k.name}${k.unit ? `（${k.unit}）` : ""}: 施策前 ${fmt(k.baseline_value)} → 目標 ${fmt(k.target_value)} → 施策後 ${fmt(k.actual_value)}`).join("\n") || "- （KPI 未設定）",
      `**結果**: ${outcomeJa}（${verification ? `KPI 検証担当の判定: ${{ achieved: "達成", partial: "一部達成", missed: "未達" }[verification.achievement] ?? verification.achievement} / ` : ""}代表の判断: ${verdictJa}）`,
      data.lesson ? `**学び**: ${data.lesson}` : "",
      data.next_time ? `**次回同じ状況では**: ${data.next_time}` : "",
      data.other_factors ? `**他の要因の可能性**: ${data.other_factors}` : "",
    ].filter(Boolean).join("\n\n");

    await repo.createKnowledge({
      kind,
      title: `${outcomeJa}: ${task.title}`,
      body_md,
      tags: tagsFor(task),
      source_type: "task",
      source_id: task.id,
      outcome,
      data,
    });
    const projectStatus = await repo.recomputeProjectStatus(task.project_id);
    return c.json({ ok: true, task: await repo.getTask(task.id), kpis, outcome, project_status: projectStatus });
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

function tagsFor(task: TaskRow): string[] {
  const tags = new Set<string>([employeeName(task.executor_employee_id)]);
  for (const [word, tag] of [["LINE", "LINE"], ["見学", "見学"], ["お試し", "30日お試し"], ["退会", "退会"], ["休眠", "継続"], ["Google", "Google"], ["広告", "広告"], ["SNS", "SNS"], ["HP", "HP"], ["料金", "料金"], ["パーソナル", "パーソナル"]]) {
    if (task.title.includes(word) || task.objective.includes(word)) tags.add(tag);
  }
  return [...tags];
}
