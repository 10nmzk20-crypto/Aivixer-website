import { api } from "../api";
import { DEPT_JA, esc, fmtDate, statusChip } from "../components";

interface EmployeeDetail {
  employee: { id: string; name: string; department: string; role_summary: string; watches: string[] };
  current: { tasks: Array<{ id: string; project_id: string; project_title: string; title: string; status: string; updated_at: string }>; analyses: Array<{ project_id: string; project_title: string; created_at: string }> };
  past: {
    outputs: Array<{ id: string; task_id: string; project_id: string; task_title: string; task_status: string; title: string; version: number; created_at: string }>;
    analyses: Array<{ project_id: string; project_title: string; headline: string | null; created_at: string }>;
    tasks: Array<{ id: string; project_id: string; project_title: string; title: string; status: string; updated_at: string }>;
  };
}

const sheet = () => document.getElementById("sheet")!;
const scrim = () => document.getElementById("scrim")!;

export function setupSheet(): void {
  scrim().addEventListener("click", closeSheet);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeSheet(); });
}
export function closeSheet(): void {
  sheet().dataset.open = "0";
  scrim().dataset.open = "0";
}

/** AI 社員カードをタップしたときに右から開く: 役割・見るもの・現在の仕事・過去の成果 */
export async function openEmployeeSheet(id: string): Promise<void> {
  const s = sheet();
  s.innerHTML = `<button type="button" class="close" aria-label="閉じる">×</button><div class="placeholder">読み込み中…</div>`;
  s.dataset.open = "1"; scrim().dataset.open = "1";
  s.querySelector(".close")!.addEventListener("click", closeSheet);
  try {
    const d = await api.get<EmployeeDetail>(`/api/employees/${encodeURIComponent(id)}`);
    const e = d.employee;
    const item = (href: string | null, date: string, text: string, chip = "") =>
      `<${href ? `a href="${href}"` : "div"} class="item"><span class="d">${esc(date)}</span>${chip}<div class="t">${esc(text)}</div></${href ? "a" : "div"}>`;
    const current = [
      ...d.current.analyses.map((a) => item(`#/projects/${a.project_id}`, fmtDate(a.created_at), `${a.project_title} を分析中`)),
      ...d.current.tasks.map((t) => item(`#/projects/${t.project_id}`, fmtDate(t.updated_at), t.title, ` ${statusChip(t.status)}`)),
    ];
    const past = [
      ...d.past.outputs.map((o) => item(`#/projects/${o.project_id}`, fmtDate(o.created_at), `${o.title}（v${o.version}）`, ` ${statusChip(o.task_status)}`)),
      ...d.past.analyses.map((a) => item(`#/projects/${a.project_id}`, fmtDate(a.created_at), `${a.project_title}: ${a.headline ?? "分析"}`)),
    ];
    s.innerHTML = `<button type="button" class="close" aria-label="閉じる">×</button>
      <div><div class="eyebrow">${esc(DEPT_JA[e.department] ?? e.department)}</div><h2>${esc(e.name)}</h2></div>
      <p class="role">${esc(e.role_summary)}</p>
      <div><div class="eyebrow" style="margin-bottom:8px">見るもの</div><div class="chips">${e.watches.map((w) => `<span>${esc(w)}</span>`).join("")}</div></div>
      <div><div class="eyebrow" style="margin-bottom:4px">現在の仕事</div>${current.join("") || '<div class="item"><div class="t faint">現在の仕事はありません</div></div>'}</div>
      <div><div class="eyebrow" style="margin-bottom:4px">過去の成果</div>${past.join("") || '<div class="item"><div class="t faint">まだ成果はありません</div></div>'}</div>`;
    s.querySelector(".close")!.addEventListener("click", closeSheet);
    s.querySelectorAll("a.item").forEach((a) => a.addEventListener("click", closeSheet));
  } catch (err) {
    s.innerHTML = `<button type="button" class="close" aria-label="閉じる">×</button><div class="placeholder">${esc(err instanceof Error ? err.message : String(err))}</div>`;
    s.querySelector(".close")!.addEventListener("click", closeSheet);
  }
}
