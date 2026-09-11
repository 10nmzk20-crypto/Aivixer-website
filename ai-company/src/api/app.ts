import { Hono } from "hono";
import type { Env } from "../env";
import { loginHandler, logoutHandler, meHandler, requireAuth } from "./auth";
import { dashboardRoutes } from "./dashboard";
import { employeeRoutes } from "./employees";
import { projectRoutes } from "./projects";
import { taskRoutes } from "./tasks";
import { knowledgeRoutes } from "./knowledge";
import { reportRoutes } from "./reports";
import { AiProviderError } from "../ai/provider";

export type App = Hono<{ Bindings: Env }>;

export function createApp(): App {
  const app = new Hono<{ Bindings: Env }>();

  app.get("/api/health", (c) => c.json({ ok: true, service: "vixer-ai-company", time: new Date().toISOString() }));
  app.get("/api/auth/me", meHandler);
  app.post("/api/auth/login", loginHandler);
  app.post("/api/auth/logout", logoutHandler);

  app.use("/api/*", requireAuth);
  app.route("/api", dashboardRoutes());
  app.route("/api", employeeRoutes());
  app.route("/api", projectRoutes());
  app.route("/api", taskRoutes());
  app.route("/api", knowledgeRoutes());
  app.route("/api", reportRoutes());

  app.notFound((c) => c.json({ error: "not_found", message: "この API はありません。" }, 404));
  app.onError((err, c) => {
    console.error("API error", err);
    if (err instanceof AiProviderError) return c.json({ error: "ai_error", message: err.message }, 502);
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ error: "internal_error", message }, 500);
  });
  return app;
}
