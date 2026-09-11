import { Hono } from "hono";
import type { Env } from "../env";
import { Repo, type ProjectRow } from "../db/repo";
import { EMPLOYEES } from "../employees/roster";
import { METRIC_GROUPS, NOTE_FIELDS, normalizeInputData } from "../metrics";
import { computeDerived, withKeywordCtr } from "../analysis/derived";
import { compare, toPeriodKey, type HistoryEntry } from "../analysis/compare";
import { diagnoseFunnel } from "../analysis/funnel";

/** 案件（1 回の「分析開始」）の作成・取得 */
export function projectRoutes() {
  const r = new Hono<{ Bindings: Env }>();

  r.get("/projects", async (c) => {
    const repo = new Repo(c.env.DB);
    const status = c.req.query("status") || undefined;
    const projects = await repo.listProjects({ status, limit: Number(c.req.query("limit") || 50) });
    const withTasks = await Promise.all(
      projects.map(async (p) => {
        const tasks = await repo.listTasks(p.id);
        return { ...p, selected_analysts: p.selected_analysts_json ? JSON.parse(p.selected_analysts_json) : [], task_count: tasks.length, task_statuses: tasks.map((t) => t.status) };
      }),
    );
    return c.json({ projects: withTasks });
  });

  /** 入力画面の項目定義（ブロック分け・自由記述欄） */
  r.get("/projects/metrics", (c) => c.json({ groups: METRIC_GROUPS, notes: NOTE_FIELDS }));

  r.post("/projects", async (c) => {
    const repo = new Repo(c.env.DB);
    const body = await c.req.json<{
      title?: string;
      period_label?: string;
      input_text?: string;
      input_data?: unknown;
      extra_text?: string;
      analyst_mode?: "auto" | "all";
    }>();

    const inputText = (body.input_text ?? "").trim();
    const input = normalizeInputData(body.input_data);
    input.keywords = withKeywordCtr(input.keywords).slice(0, 30);
    if (!inputText && Object.keys(input.values).length === 0 && input.keywords.length === 0 && Object.keys(input.notes).length === 0) {
      return c.json({ error: "empty_input", message: "数字か相談内容のどちらかを入力してください。" }, 400);
    }
    if (await repo.hasRunningAnalysis()) {
      const running = (await repo.listProjects({ status: "analyzing", limit: 1 }))[0];
      return c.json({ error: "analysis_running", message: "分析中の案件があります。完了してから次の分析を開始してください。", running_project_id: running?.id ?? null }, 409);
    }

    const period = (body.period_label ?? "").trim() || null;
    const periodKey = toPeriodKey(period);
    const title = (body.title ?? "").trim() || (period ? `${period} の分析` : inputText.slice(0, 30) || "経営データの分析");

    // 前月・過去平均との比較と、ファネル判定はここで計算して保存する（AI には計算させない）
    const history: HistoryEntry[] = periodKey
      ? (await repo.listProjectsBefore(periodKey, 13)).map((p) => ({ periodKey: p.period_key!, input: normalizeInputData(p.input_data_json ? JSON.parse(p.input_data_json) : null) }))
      : [];
    const comparison = compare(input, periodKey, history);
    const funnel = diagnoseFunnel(input, comparison);

    const project = await repo.createProject({
      title,
      period_label: period,
      period_key: periodKey,
      input_text: inputText,
      input_data: input,
      extra_text: (body.extra_text ?? "").trim() || null,
      analyst_mode: body.analyst_mode === "all" ? "all" : "auto",
      derived: { kpis: computeDerived(input), comparison },
      funnel,
    });

    const instance = await c.env.ANALYSIS_PIPELINE.create({ params: { projectId: project.id } });
    await repo.updateProject(project.id, { workflow_instance_id: instance.id });
    return c.json({ project: { ...project, workflow_instance_id: instance.id } }, 201);
  });

  r.get("/projects/:id", async (c) => {
    const repo = new Repo(c.env.DB);
    const current = await repo.getProject(c.req.param("id"));
    if (current) await syncWithWorkflow(c.env, repo, current);
    const bundle = await repo.getProjectBundle(c.req.param("id"));
    if (!bundle) return c.json({ error: "not_found", message: "案件が見つかりません。" }, 404);
    const names = Object.fromEntries(EMPLOYEES.map((e) => [e.id, e.name]));
    const { project, analyses, decision, tasks } = bundle;
    return c.json({
      project: {
        ...project,
        input_data: project.input_data_json ? normalizeInputData(JSON.parse(project.input_data_json)) : null,
        selected_analysts: project.selected_analysts_json ? JSON.parse(project.selected_analysts_json) : null,
        derived: project.derived_json ? JSON.parse(project.derived_json) : null,
        funnel: project.funnel_json ? JSON.parse(project.funnel_json) : null,
      },
      analyses: analyses.map((a) => ({
        ...a,
        employee_name: names[a.employee_id] ?? a.employee_id,
        conclusion: a.headline,
        facts: a.facts_json ? JSON.parse(a.facts_json) : [],
        hypotheses: (a.hypotheses_json ? (JSON.parse(a.hypotheses_json) as Array<string | { hypothesis: string; rationale: string }>) : []).map((h) => (typeof h === "string" ? { hypothesis: h, rationale: "" } : h)),
        evidence: a.evidence_json ? JSON.parse(a.evidence_json) : [],
        missing_data: a.needed_data_json ? JSON.parse(a.needed_data_json) : [],
        actions: a.actions_json ? JSON.parse(a.actions_json) : [],
        unverified_numbers: a.unverified_json ? JSON.parse(a.unverified_json) : [],
      })),
      decision: decision
        ? {
            ...decision,
            top_issue: decision.top_issue ?? decision.summary_md,
            reasoning_md: decision.reasoning_md ?? "",
            evidence: decision.evidence_json ? JSON.parse(decision.evidence_json) : [],
            needed_data: JSON.parse(decision.needed_data_json),
            not_now: JSON.parse(decision.not_now_json),
          }
        : null,
      roster: {
        analysts: (project.selected_analysts_json ? (JSON.parse(project.selected_analysts_json) as string[]) : []).map((id) => ({ id, name: names[id] ?? id })),
        commander: { id: "commander", name: names.commander },
        executors: [...new Set(tasks.map((t) => t.executor_employee_id))].map((id) => ({ id, name: names[id] ?? id })),
      },
      tasks: tasks.map((t) => ({
        ...t,
        executor_name: names[t.executor_employee_id] ?? t.executor_employee_id,
        restricted_actions: JSON.parse(t.restricted_actions_json),
        leverage: {
          type: t.task_type ?? null,
          type_note: t.type_note,
          initial_hours: t.initial_hours,
          ongoing_hours: t.ongoing_hours,
          automation: t.automation_score,
          asset: t.asset_score,
          self_service: t.self_service,
          staff_dependency: t.staff_dependency,
          owner_dependency: t.owner_dependency,
          human_work_change: t.human_work_change,
          human_work_note: t.human_work_note,
          manual_reason: t.manual_reason,
          score: t.leverage_score,
          formula: t.leverage_formula,
          warning: t.leverage_warning,
        },
        frames: t.frames_json
          ? { ...(JSON.parse(t.frames_json) as object), sunzi_note: t.sunzi_note, confucius_note: t.confucius_note, warning: t.frame_warning }
          : null,
        verification: t.verification ? { ...t.verification, kpis_snapshot: JSON.parse(t.verification.kpis_snapshot_json) } : null,
      })),
    });
  });

  /** 分析を中止する（止まってしまったときの逃げ道）。中止後は「続きから再実行」できる */
  r.post("/projects/:id/cancel", async (c) => {
    const repo = new Repo(c.env.DB);
    const project = await repo.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "not_found" }, 404);
    if (project.status !== "analyzing") return c.json({ error: "not_running", message: "分析中の案件だけ中止できます。" }, 400);
    if (project.workflow_instance_id) {
      try {
        const instance = await c.env.ANALYSIS_PIPELINE.get(project.workflow_instance_id);
        const s = await instance.status();
        if (s.status === "running" || s.status === "queued" || s.status === "waiting" || s.status === "paused") await instance.terminate();
      } catch (err) {
        console.warn("terminate failed", err);
      }
    }
    await repo.updateProject(project.id, { status: "failed", error: "代表が分析を中止しました。「続きから再実行」で再開できます。" });
    return c.json({ ok: true });
  });

  /** 失敗した案件を続きから再実行（保存済みのステップは飛ばされる） */
  r.post("/projects/:id/retry", async (c) => {
    const repo = new Repo(c.env.DB);
    let project = await repo.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "not_found" }, 404);
    project = await syncWithWorkflow(c.env, repo, project);
    if (project.status !== "failed") return c.json({ error: "not_failed", message: "失敗した案件だけ再実行できます。" }, 400);
    if (await repo.hasRunningAnalysis()) return c.json({ error: "analysis_running", message: "分析中の案件があります。" }, 409);
    await repo.updateProject(project.id, { status: "analyzing", error: null });
    const instance = await c.env.ANALYSIS_PIPELINE.create({ params: { projectId: project.id } });
    await repo.updateProject(project.id, { workflow_instance_id: instance.id });
    return c.json({ ok: true, workflow_instance_id: instance.id });
  });

  return r;
}

/**
 * 「分析中」のまま Workflow が止まっていないか確かめる。
 * Workflow 側が終了（エラー・停止）しているのに案件が分析中なら、失敗として記録し再実行できるようにする。
 */
async function syncWithWorkflow(env: Env, repo: Repo, project: ProjectRow): Promise<ProjectRow> {
  if (project.status !== "analyzing" || !project.workflow_instance_id) return project;
  try {
    const instance = await env.ANALYSIS_PIPELINE.get(project.workflow_instance_id);
    const s = await instance.status();
    console.log("workflow status", project.workflow_instance_id, s.status, s.error ?? "");
    if (s.status === "errored" || s.status === "terminated") {
      const message = typeof s.error === "string" ? s.error : s.error?.message ?? `Workflow が ${s.status} で終了しました。`;
      await repo.updateProject(project.id, { status: "failed", error: message.slice(0, 1000) });
    } else if (s.status === "complete") {
      const fresh = await repo.getProject(project.id);
      if (fresh?.status === "analyzing") {
        await repo.updateProject(project.id, { status: "awaiting_approval" });
        await repo.recomputeProjectStatus(project.id);
      }
    } else if (s.status === "unknown") {
      // ローカル開発でサーバーを再起動した場合など。20 分以上進まなければ失敗扱いにする
      const age = Date.now() - new Date(project.updated_at).getTime();
      if (age > 20 * 60 * 1000) await repo.updateProject(project.id, { status: "failed", error: "分析が途中で止まりました。再実行してください。" });
    }
  } catch (err) {
    console.warn("workflow status check failed", err);
  }
  return (await repo.getProject(project.id)) ?? project;
}

