import { api, type Project, type Report, type ToolReview, type OverallReview } from "../api";
import { esc, fmtDate, toast } from "../components";

/**
 * ③ 分析結果。
 * 上から「今月やるべきこと（最大 3 つ）」→「担当 5 人の結果」→「ChatGPT 用レポート」。
 * 代表が上から読んで、次に何をするかが分かれば終わり。
 */

const VERDICT_JA: Record<string, string> = { good: "良好", watch: "注意", problem: "問題あり", no_data: "データなし" };

export async function renderProject(main: HTMLElement, params: Record<string, string>) {
  const { project } = await api.get<{ project: Project }>(`/api/projects/${params.id}`);
  const review = project.review;

  main.innerHTML = `<section class="view">
    <div class="head">
      <div>
        <h1>${esc(project.title)}</h1>
        <div class="sub">${esc(project.period_label ?? "期間の指定なし")} · ${fmtDate(project.created_at)}</div>
      </div>
      <a class="btn" href="#/new">新しい分析</a>
    </div>
    ${review ? actionsSection(review) : ""}
    ${review ? reviewsSection(review) : '<div class="placeholder">分析結果がありません。</div>'}
    ${reportSection()}
  </section>`;

  setupReport(project.id, main);
}

/** 今月やるべきこと。いちばん上に置く */
function actionsSection(r: OverallReview): string {
  const actions = r.actions.length
    ? r.actions
        .map(
          (a) => `<li class="act">
            <span class="act-no">${a.rank}</span>
            <div class="act-body">
              <p class="act-do">${esc(a.action)}</p>
              <p class="act-why"><span>なぜ</span>${esc(a.why)}</p>
              <p class="act-from">${esc(a.from)}の指摘</p>
            </div>
          </li>`,
        )
        .join("")
    : `<li class="act"><span class="act-no">—</span><div class="act-body"><p class="act-do">今月直すべき点は見つかりませんでした。</p></div></li>`;

  return `<div class="sec first">
    <div class="sec-head"><h2>今月やるべきこと</h2><div class="hint">最大 3 つ · 上から順に</div></div>
    <p class="headline">${esc(r.headline)}</p>
    <ol class="acts">${actions}</ol>
    ${r.noDataOwners.length ? `<p class="nodata">数字が入っていないため分析できなかった担当: ${esc(r.noDataOwners.join("・"))}</p>` : ""}
  </div>`;
}

/** 担当 5 人の結果 */
function reviewsSection(r: OverallReview): string {
  return `<div class="sec">
    <div class="sec-head"><h2>担当ごとの分析 <span>5 人</span></h2><div class="hint">見出しをタップすると開きます</div></div>
    <div class="revs">${r.reviews.map((x) => reviewBlock(x, x.id === r.weakest)).join("")}</div>
  </div>`;
}

function reviewBlock(v: ToolReview, weakest: boolean): string {
  const list = (items: string[]) => items.map((t) => `<li>${esc(t)}</li>`).join("");
  // 最初から開くのは、いちばん詰まっている 1 つだけ。
  // 全部開くと画面が長くなり、5〜10 分で読み終わらないため
  const open = weakest ? " open" : "";
  return `<details class="rev" data-verdict="${esc(v.verdict)}"${open}>
    <summary>
      <span class="rev-name">${esc(v.name)}${weakest ? '<span class="rev-weak">いちばん詰まっている</span>' : ""}</span>
      <span class="rev-q">${esc(v.question)}</span>
      <span class="rev-v">${esc(VERDICT_JA[v.verdict] ?? v.verdict)}</span>
    </summary>
    <div class="rev-body">
      ${v.current.length ? `<div class="rev-part"><h4>現状</h4><ul>${list(v.current)}</ul></div>` : ""}
      ${v.trend.length ? `<div class="rev-part"><h4>傾向（前月比）</h4><ul>${list(v.trend)}</ul></div>` : ""}
      ${
        v.findings.length
          ? `<div class="rev-part"><h4>問題点と改善案</h4>${v.findings
              .map((f) => `<div class="fnd"><p class="fnd-p">${esc(f.problem)}</p><p class="fnd-f"><span>改善案</span>${esc(f.fix)}</p></div>`)
              .join("")}</div>`
          : v.verdict === "no_data"
            ? '<div class="rev-part"><p class="dim">このツールの数字が入力されていません。</p></div>'
            : '<div class="rev-part"><p class="dim">目立った問題は見つかりませんでした。</p></div>'
      }
      ${v.missing.length ? `<div class="rev-part"><h4>次回入れてほしい数字</h4><ul class="dim">${list(v.missing)}</ul></div>` : ""}
    </div>
  </details>`;
}

/** ChatGPT 用レポート（任意） */
function reportSection(): string {
  return `<div class="sec">
    <div class="sec-head"><h2>ChatGPT でさらに深く見る</h2><div class="hint">任意</div></div>
    <div class="report-card">
      <p class="dim">上の分析はアプリが数字から出したものです。さらに深く考えたいときは、レポートを作って ChatGPT に貼り付けてください。</p>
      <div class="r"><button type="button" class="btn primary" id="make-report">レポートを作る</button><button type="button" class="btn" id="copy-report" hidden>全文コピー</button></div>
      <pre class="report-text" id="report-text" hidden></pre>
    </div>
  </div>`;
}

function setupReport(projectId: string, main: HTMLElement) {
  const make = main.querySelector<HTMLButtonElement>("#make-report");
  const copy = main.querySelector<HTMLButtonElement>("#copy-report");
  const box = main.querySelector<HTMLPreElement>("#report-text");
  if (!make || !copy || !box) return;

  make.addEventListener("click", async () => {
    make.disabled = true;
    make.textContent = "作成中…";
    try {
      const { report } = await api.post<{ report: Report }>(`/api/projects/${projectId}/report`);
      box.textContent = report.content;
      box.hidden = false;
      copy.hidden = false;
      make.textContent = "作り直す";
    } catch (err) {
      toast(err instanceof Error ? err.message : "レポートを作れませんでした。");
      make.textContent = "レポートを作る";
    } finally {
      make.disabled = false;
    }
  });

  copy.addEventListener("click", async () => {
    const text = box.textContent ?? "";
    let ok = false;
    try {
      await navigator.clipboard.writeText(text);
      ok = true;
    } catch {
      // iPad Safari など、クリップボードが使えない環境では文字を選択状態にする
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(box);
      sel?.removeAllRanges();
      sel?.addRange(range);
      ok = document.execCommand?.("copy") ?? false;
    }
    copy.textContent = ok ? "コピーしました" : "長押しでコピーしてください";
    setTimeout(() => (copy.textContent = "全文コピー"), 2000);
  });
}
