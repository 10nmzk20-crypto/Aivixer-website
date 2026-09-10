import { Hono } from "hono";
import type { Env } from "../env";
import { Repo } from "../db/repo";

export function knowledgeRoutes() {
  const r = new Hono<{ Bindings: Env }>();

  r.get("/knowledge", async (c) => {
    const repo = new Repo(c.env.DB);
    const kind = c.req.query("kind") || undefined;
    const tag = c.req.query("tag") || undefined;
    const rows = await repo.listKnowledge({ kind, limit: Number(c.req.query("limit") || 100) });
    const items = rows.map((k) => ({ ...k, tags: JSON.parse(k.tags_json) as string[], data: k.data_json ? JSON.parse(k.data_json) : null })).filter((k) => !tag || k.tags.includes(tag));
    return c.json({ knowledge: items });
  });

  /** 代表が手で学びを追加する */
  r.post("/knowledge", async (c) => {
    const repo = new Repo(c.env.DB);
    const body = await c.req.json<{ kind?: string; title?: string; body_md?: string; tags?: string[] }>();
    const kind = body.kind ?? "learning";
    if (!["success", "failure", "idea", "analysis", "learning"].includes(kind)) return c.json({ error: "bad_kind" }, 400);
    if (!body.title?.trim()) return c.json({ error: "title_required", message: "題名を入力してください。" }, 400);
    const outcome = kind === "success" ? "success" : kind === "failure" ? "failure" : "hold";
    const row = await repo.createKnowledge({ kind, title: body.title.trim(), body_md: (body.body_md ?? "").trim(), tags: body.tags ?? [], source_type: "manual", source_id: null, outcome });
    return c.json({ knowledge: { ...row, tags: JSON.parse(row.tags_json) } }, 201);
  });

  return r;
}
