import { Hono } from "hono";
import type { Env } from "../env";
import { Repo } from "../db/repo";
import { EMPLOYEES } from "../employees/roster";

/** ダッシュボード用: 今日の状況・最優先・社員の稼働状況を 1 回で返す */
export function dashboardRoutes() {
  const r = new Hono<{ Bindings: Env }>();

  r.get("/dashboard", async (c) => {
    const repo = new Repo(c.env.DB);
    const [projectCounts, taskCounts, latest, running, activeTasks, knowledgeCount, employees] = await Promise.all([
      repo.countProjectsByStatus(),
      repo.countTasksByStatus(),
      repo.latestDecidedProject(),
      repo.listProjects({ status: "analyzing", limit: 1 }),
      repo.listTasksByStatus(["awaiting_approval", "revising", "in_progress", "awaiting_verification"], 100),
      repo.countKnowledge(),
      repo.listEmployees(),
    ]);

    const runningProject = running[0] ?? null;
    const runningAnalyses = runningProject ? await repo.listAnalyses(runningProject.id) : [];

    const busy: Record<string, string> = {};
    for (const a of runningAnalyses) if (a.status === "running") busy[a.employee_id] = "分析中";
    if (runningProject) busy.commander = "分析を統括中";
    for (const t of activeTasks) {
      const label = { awaiting_approval: "承認待ちの成果物あり", revising: "修正版を作成中", in_progress: "施策を実行中", awaiting_verification: "検証待ち" }[t.status] ?? t.status;
      if (!busy[t.executor_employee_id]) busy[t.executor_employee_id] = label;
    }
    if (runningProject && runningAnalyses.length === 0) busy.commander = "分析担当を選定中";

    const priorities = latest ? await repo.listTasks(latest.id) : [];
    const names = Object.fromEntries(EMPLOYEES.map((e) => [e.id, e.name]));

    return c.json({
      today: new Date().toISOString().slice(0, 10),
      counts: {
        analyzing: projectCounts.analyzing ?? 0,
        awaiting_approval: (taskCounts.awaiting_approval ?? 0) + (taskCounts.revising ?? 0),
        in_progress: taskCounts.in_progress ?? 0,
        awaiting_verification: taskCounts.awaiting_verification ?? 0,
      },
      running_project: runningProject ? { id: runningProject.id, title: runningProject.title, status: runningProject.status } : null,
      latest_project: latest ? { id: latest.id, title: latest.title, status: latest.status, created_at: latest.created_at } : null,
      priorities: priorities.map((t) => ({ ...t, executor_name: names[t.executor_employee_id] ?? t.executor_employee_id, restricted_actions: JSON.parse(t.restricted_actions_json) })),
      employees: employees.map((e) => ({ ...e, watches: JSON.parse(e.watches_json), current: busy[e.id] ?? null })),
      totals: { projects: Object.values(projectCounts).reduce((a, b) => a + b, 0), knowledge: knowledgeCount },
    });
  });

  return r;
}
