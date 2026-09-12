import { api, ApiError } from "./api";
import { renderDashboard } from "./views/dashboard";
import { renderNewAnalysis } from "./views/new-analysis";
import { renderProject } from "./views/project";
import { renderHistory } from "./views/history";
import { renderLogin } from "./views/login";
import { openEmployeeSheet, setupSheet } from "./views/employee";
import { errorBox } from "./components";

/**
 * 画面の切り替え（#/ , #/new , #/projects/:id , #/history）。MVP はこの 4 つだけ。
 * 各画面は render(main) を返し、離れるときに cleanup を呼ぶ（ポーリング停止など）。
 */
export type Cleanup = () => void;
export type View = (main: HTMLElement, params: Record<string, string>) => Promise<Cleanup | void> | Cleanup | void;

const routes: Array<{ pattern: RegExp; name: string; view: View }> = [
  { pattern: /^\/?$/, name: "dashboard", view: renderDashboard },
  { pattern: /^\/new$/, name: "new", view: renderNewAnalysis },
  { pattern: /^\/projects\/([^/]+)$/, name: "project", view: (m, p) => renderProject(m, p) },
  { pattern: /^\/history$/, name: "history", view: renderHistory },
];

let cleanup: Cleanup | void;
let navigating = 0;

async function navigate() {
  const main = document.getElementById("main")!;
  const hash = location.hash.replace(/^#/, "") || "/";
  const [path, query] = hash.split("?");
  const route = routes.find((r) => r.pattern.test(path)) ?? routes[0];
  const match = route.pattern.exec(path);
  const params: Record<string, string> = { id: match?.[1] ?? "" };
  new URLSearchParams(query ?? "").forEach((v, k) => (params[k] = v));

  const token = ++navigating;
  if (cleanup) { try { cleanup(); } catch { /* ignore */ } cleanup = undefined; }
  document.querySelectorAll<HTMLAnchorElement>("#nav a").forEach((a) => {
    if (a.dataset.route === route.name || (route.name === "project" && a.dataset.route === "history")) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  main.innerHTML = '<div class="placeholder">読み込み中…</div>';
  window.scrollTo({ top: 0 });
  try {
    const c = await route.view(main, params);
    if (token === navigating) cleanup = c;
  } catch (err) {
    if (token !== navigating) return;
    if (err instanceof ApiError && err.status === 401) {
      renderLogin(main, err.mode ?? "locked", err.message, () => navigate());
      return;
    }
    main.innerHTML = errorBox(err instanceof Error ? err.message : String(err), "再読み込み");
    main.querySelector("[data-retry]")?.addEventListener("click", () => navigate());
  }
}

window.addEventListener("hashchange", navigate);
document.addEventListener("click", (ev) => {
  const t = (ev.target as HTMLElement).closest<HTMLElement>("[data-employee]");
  if (t?.dataset.employee) { ev.preventDefault(); openEmployeeSheet(t.dataset.employee); }
});
setupSheet();

(async () => {
  try {
    const me = await api.get<{ mode: string; authenticated: boolean; ai_provider?: string; ai_model?: string }>("/api/auth/me");
    const foot = document.getElementById("side-foot");
    const ai =
      me.ai_provider === "none"
        ? "外部 AI は使いません。ChatGPT 用レポートを作って分析します"
        : me.ai_provider === "mock"
          ? "AI: 固定回答モード（mock）— 本番の分析ではありません"
          : `AI: Claude（${me.ai_model ?? ""}）`;
    if (foot) foot.textContent = `${ai}\n認証: ${{ access: "Cloudflare Access", password: "共有パスワード", open: "なし（開発）", locked: "未設定" }[me.mode] ?? me.mode}`;
    if (me.ai_provider === "mock") document.body.dataset.ai = "mock";
  } catch { /* 認証情報の取得に失敗しても画面は出す */ }
  navigate();
})();
