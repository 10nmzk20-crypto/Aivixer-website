import { api } from "../api";
import { esc } from "../components";

/** 共有パスワード方式のログイン画面。認証未設定のときは設定案内を出す。 */
export function renderLogin(main: HTMLElement, mode: string, message: string, onSuccess: () => void): void {
  if (mode !== "password") {
    main.innerHTML = `<div class="login"><h1>ViXer AI Company</h1><p>${esc(message)}</p>
      <p>${mode === "locked" ? "Worker の設定で Cloudflare Access（CF_ACCESS_TEAM_DOMAIN / CF_ACCESS_AUD）か、共有パスワード（APP_PASSWORD）を登録してから開いてください。" : "Cloudflare Access のログイン画面が表示されない場合は、ページを再読み込みしてください。"}</p>
      <button type="button" class="btn" id="reload">再読み込み</button></div>`;
    main.querySelector("#reload")?.addEventListener("click", () => location.reload());
    return;
  }
  main.innerHTML = `<form class="login" id="loginForm"><h1>ViXer AI Company</h1><p>社内用です。共有パスワードを入力してください。</p>
    <label class="f">パスワード<input type="password" id="pw" autocomplete="current-password" autofocus></label>
    <div id="loginErr" class="error" hidden></div>
    <button type="submit" class="btn primary big">ログイン</button></form>`;
  const form = main.querySelector<HTMLFormElement>("#loginForm")!;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pw = (main.querySelector("#pw") as HTMLInputElement).value;
    const err = main.querySelector<HTMLElement>("#loginErr")!;
    try {
      await api.post("/api/auth/login", { password: pw });
      onSuccess();
    } catch (e) {
      err.hidden = false;
      err.textContent = e instanceof Error ? e.message : "ログインに失敗しました。";
    }
  });
}
