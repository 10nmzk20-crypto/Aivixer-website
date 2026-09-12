import { api, type Dashboard, type Employee } from "../api";
import { esc, fmtDate } from "../components";

/**
 * ① ダッシュボード。
 * 代表が開いてまず見るのは「前回の分析」と「新しい分析を始める」の 2 つだけ。
 * その下に、担当 5 人が何を見る係なのかを置く。
 */
export async function renderDashboard(main: HTMLElement) {
  const d = await api.get<Dashboard>("/api/dashboard");
  const today = new Date();
  const wd = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"][today.getDay()];

  const card = (e: Employee, i: number) =>
    `<button type="button" class="emp" data-employee="${e.id}" data-state="idle">
      <span><span class="no">${String(i + 1).padStart(2, "0")}</span><span class="nm">${esc(e.name)}</span></span>
      <span class="ws">見るもの: ${esc(e.watches.slice(0, 4).join("・"))}${e.watches.length > 4 ? " 他" : ""}</span>
    </button>`;

  main.innerHTML = `<section class="view">
    <div class="head">
      <h1>ViXer AI Company</h1>
      <div class="date">${today.getFullYear()}.${String(today.getMonth() + 1).padStart(2, "0")}.${String(today.getDate()).padStart(2, "0")} <b>${wd}</b> · JST</div>
    </div>

    <div class="sec first">
      <div class="cta-row">
        <a class="btn primary big" href="#/new">今月の数字を入力する</a>
        <span class="note">${
          d.latest_project
            ? `前回: <a href="#/projects/${d.latest_project.id}">${esc(d.latest_project.title)}</a>（${fmtDate(d.latest_project.created_at)}）`
            : "まだ分析はありません。5〜10 分で終わります。"
        }</span>
      </div>
      <p class="dim">5 つのツールの数字を入れると、担当 5 人が現状・傾向・問題点・改善案を出し、最後に「今月やるべきこと」が最大 3 つ出ます。</p>
    </div>

    <div class="sec">
      <div class="sec-head"><h2>過去の分析 <span>${d.totals.projects} 件</span></h2>${d.totals.projects > 0 ? '<div class="hint"><a href="#/history">すべて見る →</a></div>' : ""}</div>
      <div class="list">${
        d.recent_projects?.length
          ? d.recent_projects
              .map(
                (p) => `<a class="row" href="#/projects/${p.id}"><span class="rk d">${esc(fmtDate(p.created_at).slice(5))}</span><span><span class="t">${esc(p.title)}</span><span class="m">${esc(p.period_label ?? "期間の指定なし")}</span></span><span></span></a>`,
              )
              .join("")
          : '<div class="row"><span class="rk">—</span><span class="empty">まだ分析がありません。「今月の数字を入力する」から始めてください。</span><span></span></div>'
      }</div>
    </div>

    <div class="sec">
      <div class="sec-head"><h2>担当 <span>5 人</span></h2><div class="hint">1 ツール 1 担当。カードをタップすると見方が出ます</div></div>
      <div class="staff">${d.employees.map(card).join("")}</div>
    </div>
  </section>`;
}
