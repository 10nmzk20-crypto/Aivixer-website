import { Hono } from "hono";
import type { Env } from "../env";
import { Repo } from "../db/repo";
import { EMPLOYEE_MAP } from "../employees/roster";
import { EMPLOYEE_GUIDES } from "../employees/guides";
import { DISCOURAGED_PATTERNS, GOAL_STATES, PREFERRED_DIRECTIONS, PRINCIPLES, TASK_TYPES, VISION } from "../principles";

export function employeeRoutes() {
  const r = new Hono<{ Bindings: Env }>();

  /** 憲法（全社員の最上位ルール）。画面で確認できるようにする */
  r.get("/principles", (c) => c.json({ vision: VISION, goals: GOAL_STATES, principles: PRINCIPLES, types: TASK_TYPES, discouraged: DISCOURAGED_PATTERNS.map((d) => d.label), preferred: PREFERRED_DIRECTIONS }));

  r.get("/employees", async (c) => {
    const repo = new Repo(c.env.DB);
    const rows = await repo.listEmployees();
    return c.json({ employees: rows.map((e) => ({ ...e, watches: JSON.parse(e.watches_json) })) });
  });

  /** 役割・見るもの・現在の仕事・過去の成果 */
  r.get("/employees/:id", async (c) => {
    const repo = new Repo(c.env.DB);
    const id = c.req.param("id");
    const row = await repo.getEmployee(id);
    if (!row) return c.json({ error: "not_found" }, 404);
    const def = EMPLOYEE_MAP[id];
    const guide = EMPLOYEE_GUIDES[id];

    const [currentTasks, pastTasks, outputs, analyses] = await Promise.all([
      repo.listTasksByExecutor(id, ["awaiting_approval", "revising", "in_progress", "awaiting_verification"], 10),
      repo.listTasksByExecutor(id, ["completed", "rejected"], 10),
      repo.listOutputsByEmployee(id, 10),
      row.department === "analysis" ? repo.listAnalysesByEmployee(id, 10) : Promise.resolve([]),
    ]);
    const runningAnalyses = analyses.filter((a) => a.status === "running");

    return c.json({
      employee: {
        ...row,
        watches: guide?.watches ?? JSON.parse(row.watches_json),
        role: guide?.role ?? row.role_summary,
        checkpoints: guide?.checkpoints ?? [],
        needs: guide?.needs ?? [],
        role_prompt_excerpt: def?.systemPrompt.split("\n").slice(0, 3).join("\n") ?? null,
      },
      current: {
        tasks: currentTasks.map((t) => ({ id: t.id, project_id: t.project_id, project_title: t.project_title, title: t.title, status: t.status, updated_at: t.updated_at })),
        analyses: runningAnalyses.map((a) => ({ project_id: a.project_id, project_title: a.project_title, created_at: a.created_at })),
      },
      past: {
        outputs: outputs.map((o) => ({ id: o.id, task_id: o.task_id, project_id: o.project_id, task_title: o.task_title, task_status: o.task_status, title: o.title, kind: o.kind, version: o.version, created_at: o.created_at })),
        analyses: analyses.filter((a) => a.status === "done").map((a) => ({ project_id: a.project_id, project_title: a.project_title, headline: a.headline, created_at: a.created_at })),
        tasks: pastTasks.map((t) => ({ id: t.id, project_id: t.project_id, project_title: t.project_title, title: t.title, status: t.status, updated_at: t.updated_at })),
      },
    });
  });

  return r;
}
