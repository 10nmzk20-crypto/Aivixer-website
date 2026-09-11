import { api, type Dashboard, type Employee } from "../api";
import { esc, fmtDate, PROJECT_STATUS_JA, RESTRICTED_JA, statusChip } from "../components";

/** ① ダッシュボード: 今日の状況 → 新しい分析 → 今日の最優先 → AI 社員 */
export async function renderDashboard(main: HTMLElement) {
  const d = await api.get<Dashboard>("/api/dashboard");
  const hot = d.counts.awaiting_approval > 0;
  const today = new Date();
  const wd = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][today.getDay()];

  const tile = (k: string, v: number, href: string, hotTile = false) =>
    `<a class="tile" href="${href}" data-hot="${hotTile ? 1 : 0}"><span class="k">${k}</span><span class="v">${v}${hotTile ? "<small>要対応</small>" : ""}</span></a>`;

  const prio = d.priorities.length
    ? d.priorities
        .map(
          (t) => `<a class="row" href="#/projects/${t.project_id}"><span class="rk">${t.rank}</span><span><span class="t">${esc(t.title)}</span><span class="m">担当 <b>${esc(t.executor_name)}</b> · インパクト ${t.impact_score} / ${t.effort_hours} 時間${t.restricted_actions.length ? ` · 代表承認が必要: ${t.restricted_actions.map((r) => RESTRICTED_JA[r] ?? r).join("・")}` : ""}</span></span>${statusChip(t.status)}</a>`,
        )
        .join("")
    : `<div class="row"><span class="rk">—</span><span class="empty">${d.running_project ? "分析中です。完了すると最優先施策がここに表示されます。" : "まだ案件がありません。「新しい分析を開始」から始めてください。"}</span><span></span></div>`;

  const card = (e: Employee, i: number) => {
    const busy = !!e.current;
    return `<button type="button" class="emp${e.department === "command" ? " wide" : ""}" data-employee="${e.id}" data-state="${busy ? "busy" : "idle"}">
      <span><span class="no">${String(i + 1).padStart(2, "0")}</span><span class="nm">${esc(e.name)}</span></span>
      <span class="ws">${e.department === "command" ? esc(e.role_summary) : "見るもの: " + esc(e.watches.slice(0, 4).join("・")) + (e.watches.length > 4 ? " 他" : "")}</span>
      <span class="st">${esc(e.current ?? "待機中")}</span></button>`;
  };
  const dept = (key: Employee["department"], label: string) => {
    const list = d.employees.filter((e) => e.department === key);
    return `<div class="dept"><div class="eyebrow">${label} · ${list.length}</div><div class="staff${key === "command" ? " one" : ""}">${list.map((e) => card(e, d.employees.indexOf(e))).join("")}</div></div>`;
  };

  main.innerHTML = `<section class="view">
    <div class="head"><h1>ViXer AI Company</h1><div class="date">${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")} <b>${wd}</b> · JST</div></div>
    <div class="sec first">
      <div class="sec-head"><h2>今日の状況</h2><div class="hint">案件 ${d.totals.projects} 件 · ナレッジ ${d.totals.knowledge} 件</div></div>
      <div class="tiles">
        ${tile("集計中", d.counts.analyzing, d.running_project ? `#/projects/${d.running_project.id}` : "#/history?status=analyzing")}
        ${tile("承認待ち", d.counts.awaiting_approval, d.latest_project ? `#/projects/${d.latest_project.id}` : "#/history?status=awaiting_approval", hot)}
        ${tile("実行中", d.counts.in_progress, "#/history?status=in_progress")}
        ${tile("検証待ち", d.counts.awaiting_verification, "#/history?status=awaiting_verification")}
      </div>
      <div class="cta-row">
        ${d.running_project ? `<a class="btn primary big" href="#/projects/${d.running_project.id}"><span class="pulse">●</span> 分析中の案件を見る</a>` : `<a class="btn primary big" href="#/new">新しい分析を開始</a>`}
        <span class="note">${d.latest_project ? `前回の分析: ${esc(d.latest_project.title)}（${fmtDate(d.latest_project.created_at)} · ${esc(PROJECT_STATUS_JA[d.latest_project.status] ?? d.latest_project.status)}）` : "まだ分析はありません。"}</span>
      </div>
    </div>
    <div class="sec">
      <div class="sec-head"><h2>今日の最優先 ${d.latest_project ? `<span>${esc(d.latest_project.title)} より</span>` : ""}</h2>${d.latest_project ? `<div class="hint"><a href="#/projects/${d.latest_project.id}">案件を開く →</a></div>` : ""}</div>
      <div class="list">${prio}</div>
    </div>
    <div class="sec">
      <div class="sec-head"><h2>実行中・検証待ちの施策 <span>${d.active_tasks.length} 件</span></h2><div class="hint"><a href="#/history?status=in_progress">履歴で見る →</a></div></div>
      <div class="list">${
        d.active_tasks.length
          ? d.active_tasks.map((t) => `<a class="row" href="#/projects/${t.project_id}"><span class="rk d">${esc(t.due_date ? t.due_date.slice(5).replace("-", ".") : "—")}</span><span><span class="t">${esc(t.title)}</span><span class="m">${esc(t.project_title)} · 担当 <b>${esc(t.executor_name)}</b>${t.human_owner ? ` / ${esc(t.human_owner)}` : ""}${t.due_date ? ` · 期限 ${esc(t.due_date)}` : ""}</span></span>${statusChip(t.status)}</a>`).join("")
          : `<div class="row"><span class="rk">—</span><span class="empty">実行中の施策はありません。施策を「採用」すると、ここに表示されます。</span><span></span></div>`
      }</div>
    </div>
    <div class="sec">
      <div class="sec-head"><h2>AI 社員 <span>${d.employees.length} 名</span></h2><div class="hint">カードをタップすると役割・現在の仕事・過去の成果を表示</div></div>
      ${dept("analysis", "分析部")}${dept("command", "司令塔")}${dept("execution", "実行部")}${dept("verification", "検証部")}
    </div>
  </section>`;

  // 分析中なら 5 秒ごとに更新
  if (d.running_project) {
    const timer = window.setInterval(() => renderDashboard(main).catch(() => window.clearInterval(timer)), 5000);
    return () => window.clearInterval(timer);
  }
}
