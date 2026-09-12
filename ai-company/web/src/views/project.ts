import { api, type Project, type ToolReview, type OverallReview } from "../api";
import { buildGptReport, buildRawNumbers } from "../report-text";
import { esc, fmtDate, toast } from "../components";

/**
 * ③ 分析結果。
 * 上から「今月やるべきこと（最大 3 つ）」→「担当 5 人の結果」→「GPT 用レポートのコピー」。
 * 代表が上から読んで、次に何をするかが分かれば終わり。
 */

const VERDICT_JA: Record<string, string> = { good: "良好", watch: "注意", problem: "問題あり", no_data: "データなし" };

/**
 * 文章の中の数字を少し大きく太く見せる。分析ツールなので数字が先に目に入ってほしい。
 * esc() で記号を無害化したあとに実行するので、ここでタグを足しても安全。
 */
function emphNum(escaped: string): string {
  // 単位（回・位・件 など）は本文の書体のまま残す。等幅にすると間延びして読みにくい
  return escaped.replace(/[+\-−]?\d[\d,]*(?:\.\d+)?%?/g, (m) => `<b class="num">${m}</b>`);
}

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

  setupReport(project, main);
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
              <p class="act-why"><span>なぜ</span>${emphNum(esc(a.why))}</p>
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
  const list = (items: string[]) => items.map((t) => `<li>${emphNum(esc(t))}</li>`).join("");
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
              .map((f) => `<div class="fnd"><p class="fnd-p">${emphNum(esc(f.problem))}</p><p class="fnd-f"><span>改善案</span>${esc(f.fix)}</p></div>`)
              .join("")}</div>`
          : v.verdict === "no_data"
            ? '<div class="rev-part"><p class="dim">このツールの数字が入力されていません。</p></div>'
            : '<div class="rev-part"><p class="dim">目立った問題は見つかりませんでした。</p></div>'
      }
      ${v.missing.length ? `<div class="rev-part"><h4>次回入れてほしい数字</h4><ul class="dim">${list(v.missing)}</ul></div>` : ""}
    </div>
  </details>`;
}

/**
 * GPT 用レポートのコピー。
 * 画面に出ている内容から組み立てるので、押した瞬間にコピーが終わる（通信なし）。
 */
function reportSection(): string {
  return `<div class="sec">
    <div class="sec-head"><h2>ChatGPT で総括する</h2><div class="hint">5 領域を横断して判断させます</div></div>
    <div class="report-card">
      <p class="dim">上の分析は領域ごとのものです。ChatGPT に 1 回貼り付けると、集客全体としてどこが詰まっているかを判断させられます。</p>
      <div class="r">
        <button type="button" class="btn primary" id="copy-gpt">GPT用レポートをコピー</button>
        <button type="button" class="btn sm" id="copy-raw">生データだけコピー</button>
      </div>
      <p class="dim sub-note">「生データだけコピー」は、アプリの分析文を入れずに数字だけを渡します。アプリの判断そのものを ChatGPT にゼロから検証させたいときに使ってください。</p>
      <textarea class="copy-buffer" id="copy-buffer" readonly aria-hidden="true" tabindex="-1"></textarea>
    </div>
  </div>`;
}

/**
 * クリップボードにコピーする。
 * iPad の Safari では navigator.clipboard が使えないことがあるため、
 * 画面外のテキスト欄に入れて選択 → execCommand("copy") に切り替える。
 */
async function copyText(text: string, buffer: HTMLTextAreaElement): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      buffer.value = text;
      buffer.hidden = false;
      buffer.focus();
      buffer.setSelectionRange(0, text.length);
      const ok = document.execCommand?.("copy") ?? false;
      buffer.hidden = true;
      return ok;
    } catch {
      buffer.hidden = true;
      return false;
    }
  }
}

function setupReport(project: Project, main: HTMLElement) {
  const buffer = main.querySelector<HTMLTextAreaElement>("#copy-buffer");
  if (!buffer) return;

  const wire = (id: string, label: string, build: () => string) => {
    const btn = main.querySelector<HTMLButtonElement>(id);
    if (!btn) return;
    btn.addEventListener("click", async () => {
      const ok = await copyText(build(), buffer);
      btn.textContent = ok ? "コピーしました" : "コピーできませんでした";
      if (!ok) toast("この端末ではコピーできませんでした。画面を長押しして選択してください。");
      setTimeout(() => (btn.textContent = label), 2000);
    });
  };

  wire("#copy-gpt", "GPT用レポートをコピー", () => buildGptReport(project));
  wire("#copy-raw", "生データだけコピー", () => buildRawNumbers(project));
}
