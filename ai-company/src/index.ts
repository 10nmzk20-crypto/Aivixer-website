import type { Env } from "./env";
import { createApp } from "./api/app";

export { AnalysisPipeline } from "./workflows/analysis-pipeline";
export { RevisionPipeline } from "./workflows/revision-pipeline";

const app = createApp();

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/") || url.pathname === "/api") {
      return app.fetch(request, env, ctx);
    }
    // 画面は Static Assets が返す（通常は Worker より先に配信されるが、念のためここでも返す）
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
