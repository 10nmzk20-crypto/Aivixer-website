import { Hono } from "hono";
import type { Env } from "../env";
import { Repo } from "../db/repo";

/** ダッシュボード用: 直近の分析と担当 5 人を 1 回で返す */
export function dashboardRoutes() {
  const r = new Hono<{ Bindings: Env }>();

  r.get("/dashboard", async (c) => {
    const repo = new Repo(c.env.DB);
    const [projectCounts, recent, employees] = await Promise.all([
      repo.countProjectsByStatus(),
      repo.listProjects({ limit: 5 }),
      repo.listEmployees(),
    ]);

    return c.json({
      today: new Date().toISOString().slice(0, 10),
      latest_project: recent[0] ? { id: recent[0].id, title: recent[0].title, status: recent[0].status, created_at: recent[0].created_at } : null,
      recent_projects: recent.map((p) => ({ id: p.id, title: p.title, period_label: p.period_label, status: p.status, created_at: p.created_at })),
      employees: employees.map((e) => ({ ...e, watches: JSON.parse(e.watches_json) })),
      totals: { projects: Object.values(projectCounts).reduce((a, b) => a + b, 0) },
    });
  });

  return r;
}
