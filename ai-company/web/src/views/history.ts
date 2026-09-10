import { api, type Project } from "../api";
import { esc, fmtDate, PROJECT_STATUS_JA, statusChip } from "../components";

type ProjectListItem = Project & { selected_analysts: string[]; task_count: number; task_statuses: string[] };

/** ⑤ 案件の履歴 */
export async function renderHistory(main: HTMLElement, params: Record<string, string>) {
  const status = params.status ?? "";
  const { projects } = await api.get<{ projects: ProjectListItem[] }>(`/api/projects?limit=100${status ? `&status=${encodeURIComponent(status)}` : ""}`);
  const filters = ["", "analyzing", "awaiting_approval", "in_progress", "awaiting_verification", "completed", "rejected", "failed"];

  main.innerHTML = `<section class="view">
    <div class="head"><h1>案件の履歴</h1><div class="date">${projects.length} 件</div></div>
    <div class="sec first">
      <div class="sec-head"><h2>案件</h2><div class="hint" id="filters">${filters.map((f) => `<a href="#/history${f ? `?status=${f}` : ""}" style="margin-left:14px;${f === status ? "color:var(--text)" : ""}">${f ? esc(PROJECT_STATUS_JA[f]) : "すべて"}</a>`).join("")}</div></div>
      <div class="list hist-list">${
        projects.length
          ? projects
              .map((p) => {
                const done = p.task_statuses.filter((s) => s === "completed").length;
                const rej = p.task_statuses.filter((s) => s === "rejected").length;
                return `<a class="row" href="#/projects/${p.id}"><span class="rk d">${esc(fmtDate(p.created_at).slice(5))}</span><span><span class="t">${esc(p.title)}</span><span class="m">分析 ${p.selected_analysts.length} 名 · 施策 ${p.task_count}${done ? ` · 完了 ${done}` : ""}${rej ? ` · 却下 ${rej}` : ""}${p.error ? ` · <b>${esc(p.error.slice(0, 60))}</b>` : ""}</span></span>${statusChip(p.status, PROJECT_STATUS_JA)}</a>`;
              })
              .join("")
          : `<div class="row"><span class="rk">—</span><span class="empty">該当する案件はありません。</span><span></span></div>`
      }</div>
    </div>
  </section>`;
}
