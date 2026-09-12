import { Hono } from "hono";
import type { Env } from "../env";
import { Repo, type ProjectRow } from "../db/repo";
import { EMPLOYEES, employeeName } from "../employees/roster";
import { GROUP_OWNER, METRIC_GROUPS, NOTE_FIELDS, normalizeInputData } from "../metrics";
import { computeDerived, withKeywordCtr } from "../analysis/derived";
import { compare, toPeriodKey, type HistoryEntry } from "../analysis/compare";
import { diagnoseFunnel } from "../analysis/funnel";
import { reviewAll } from "../analysis/tool-review";

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
  r.get("/projects/metrics", (c) =>
    c.json({
      // どのブロックを誰が見るかを一緒に返す。入力画面に担当名を出すため
      groups: METRIC_GROUPS.map((g) => ({ ...g, owner: GROUP_OWNER[g.id] ?? null, owner_name: employeeName(GROUP_OWNER[g.id] ?? "") })),
      notes: NOTE_FIELDS,
    }),
  );

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

    // 5 人分の「現状・傾向・問題点・改善案」と「今月やるべきこと」をここで組み立てる。
    // 外部 AI を呼ばないので、保存した時点で分析は終わっている。
    const review = reviewAll(input, comparison);

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
      review,
      status: "reviewed",
    });
    return c.json({ project }, 201);
  });

  r.get("/projects/:id", async (c) => {
    const repo = new Repo(c.env.DB);
    const project = await repo.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "not_found", message: "案件が見つかりません。" }, 404);
    return c.json({
      project: {
        ...project,
        input_data: project.input_data_json ? normalizeInputData(JSON.parse(project.input_data_json)) : null,
        derived: project.derived_json ? JSON.parse(project.derived_json) : null,
        funnel: project.funnel_json ? JSON.parse(project.funnel_json) : null,
        review: project.review_json ? JSON.parse(project.review_json) : null,
      },
    });
  });


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

