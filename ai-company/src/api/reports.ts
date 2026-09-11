import { Hono } from "hono";
import type { Env } from "../env";
import { Repo } from "../db/repo";
import { buildReport } from "../report/build";
import { normalizeInputData } from "../metrics";
import { computeDerived } from "../analysis/derived";
import { compare, toPeriodKey, type HistoryEntry } from "../analysis/compare";
import { diagnoseFunnel } from "../analysis/funnel";

/** ChatGPT に貼り付けるレポートの生成と履歴 */
export function reportRoutes() {
  const r = new Hono<{ Bindings: Env }>();

  /** レポートを生成して保存する（外部 AI は呼ばない。入力値とアプリ内の計算だけで作る） */
  r.post("/projects/:id/report", async (c) => {
    const repo = new Repo(c.env.DB);
    const project = await repo.getProject(c.req.param("id"));
    if (!project) return c.json({ error: "not_found", message: "案件が見つかりません。" }, 404);

    const input = normalizeInputData(project.input_data_json ? JSON.parse(project.input_data_json) : null);
    const periodKey = project.period_key ?? toPeriodKey(project.period_label);

    // 作成のたびに計算し直す。過去月のデータを後から入力した場合も、最新の比較で作るため。
    // 計算し直した結果は案件にも保存し、画面の表示とレポートが食い違わないようにする。
    const history: HistoryEntry[] = periodKey
      ? (await repo.listProjectsBefore(periodKey, 13)).map((p) => ({ periodKey: p.period_key!, input: normalizeInputData(p.input_data_json ? JSON.parse(p.input_data_json) : null) }))
      : [];
    const comparison = compare(input, periodKey, history);
    const derived = { kpis: computeDerived(input), comparison };
    const funnel = diagnoseFunnel(input, comparison);
    await repo.updateProject(project.id, { derived_json: JSON.stringify(derived), funnel_json: JSON.stringify(funnel), period_key: periodKey });

    const [pastTasks, knowledge] = await Promise.all([repo.listPastTasksForReport(project.id, 12), repo.listKnowledge({ limit: 15 })]);
    const withKpis = await Promise.all(pastTasks.map(async (t) => ({ ...t, kpis: await repo.listKpis(t.id) })));

    const content = buildReport({ project, derived, funnel, pastTasks: withKpis, knowledge });
    const report = await repo.createReport({ project_id: project.id, period_label: project.period_label, content });
    return c.json({ report }, 201);
  });

  /** この案件で作ったレポートの履歴 */
  r.get("/projects/:id/reports", async (c) => {
    const repo = new Repo(c.env.DB);
    const reports = await repo.listReports(c.req.param("id"));
    return c.json({ reports });
  });

  return r;
}
