import { api, ApiError, type MetricGroup, type NoteField } from "../api";
import { esc, parseNum, toast } from "../components";

/**
 * ② データ・相談入力 → ［分析開始］
 * 最初は「基本」ブロックだけ開いた状態にし、Google 系の詳細は必要なときだけ開く。
 */
export async function renderNewAnalysis(main: HTMLElement) {
  const { groups, notes } = await api.get<{ groups: MetricGroup[]; notes: NoteField[] }>("/api/projects/metrics");
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultPeriod = `${lastMonth.getFullYear()} 年 ${lastMonth.getMonth() + 1} 月`;

  const field = (m: MetricGroup["metrics"][number]) =>
    `<label class="f">${esc(m.label)}（${esc(m.unit)}）<input data-metric="${esc(m.id)}" inputmode="decimal" placeholder="—">${m.hint ? `<small class="hint">${esc(m.hint)}</small>` : ""}</label>`;

  const groupBlock = (g: MetricGroup) => {
    const noteFields = notes.filter((n) => n.group === g.id);
    const filled = `<span class="count" data-count="${esc(g.id)}"></span>`;
    return `<details class="block" data-group="${esc(g.id)}"${g.open ? " open" : ""}>
      <summary><span class="nm">${esc(g.label)}</span><span class="desc">${esc(g.description)}</span>${filled}</summary>
      <div class="block-body">
        <div class="grid3">${g.metrics.map(field).join("")}</div>
        ${g.id === "gsc" ? keywordsBlock() : ""}
        ${noteFields.map((n) => `<label class="f note"><span>${esc(n.label)}</span><textarea data-note="${esc(n.id)}" placeholder="${esc(n.placeholder)}"></textarea></label>`).join("")}
      </div>
    </details>`;
  };

  main.innerHTML = `<section class="view">
    <div class="head"><h1>新しい分析</h1><div class="date">STEP <b>01</b> · 入力</div></div>
    <div class="card intro">
      <div class="grid3">
        <label class="f">対象期間<input id="f-period" value="${esc(defaultPeriod)}" placeholder="例: 2026 年 8 月"><small class="hint">前月比較に使います</small></label>
        <label class="f" style="grid-column: span 2">案件名（空欄なら自動）<input id="f-title" placeholder="例: 8 月の集客分析"></label>
      </div>
      <label class="f" style="margin-top:12px">相談内容・気になっていること<textarea id="f-consult" placeholder="例: 見学人数は増えたが、30日お試しへの転換率が低下している。"></textarea></label>
      <div class="warn">会員名や連絡先などの個人情報は入力しないでください。人数・金額・率などの集計値だけを扱います。</div>
    </div>

    <div class="sec">
      <div class="sec-head"><h2>数字を入力 <span>分かるものだけで構いません</span></h2><div class="hint"><button type="button" id="toggleAll">すべて開く</button></div></div>
      <div class="blocks">${groups.map(groupBlock).join("")}</div>
    </div>

    <div class="card" style="margin-top:14px">
      <div class="grid2">
        <label class="f">追加データ（表や CSV の貼り付け、任意）<textarea id="f-extra" placeholder="例: 退会理由の内訳、競合の料金 など" style="min-height:80px"></textarea></label>
        <label class="f">分析担当の選び方<select id="f-mode"><option value="auto">経営司令塔が自動で選ぶ（推奨）</option><option value="all">分析部 8 人全員に分析させる</option></select></label>
      </div>
    </div>

    <div class="form-actions" style="margin-top:16px">
      <span class="note" id="summary">入力: 0 項目</span>
      <div id="formErr" class="error" hidden></div>
      <button type="button" class="btn primary big" id="submitBtn">分析開始</button>
    </div>
  </section>`;

  const btn = main.querySelector<HTMLButtonElement>("#submitBtn")!;
  const err = main.querySelector<HTMLElement>("#formErr")!;
  const val = (sel: string) => (main.querySelector(sel) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;

  // 入力済み件数をブロックごとに表示
  const updateCounts = () => {
    const summaryEl = main.querySelector<HTMLElement>("#summary");
    if (!summaryEl) return; // 別の画面に移った後は何もしない
    let total = 0;
    for (const g of groups) {
      const inputs = [...main.querySelectorAll<HTMLInputElement>(`[data-group="${g.id}"] [data-metric]`)];
      const n = inputs.filter((i) => parseNum(i.value) !== null).length;
      total += n;
      const el = main.querySelector<HTMLElement>(`[data-count="${g.id}"]`);
      if (el) el.textContent = n > 0 ? `${n} / ${inputs.length}` : "";
    }
    const kw = main.querySelectorAll<HTMLInputElement>("[data-kw-keyword]");
    const kwFilled = [...kw].filter((i) => i.value.trim()).length;
    summaryEl.textContent = `入力: ${total} 項目${kwFilled ? ` · キーワード ${kwFilled} 件` : ""}`;
  };
  main.addEventListener("input", updateCounts);

  main.querySelector("#toggleAll")!.addEventListener("click", (ev) => {
    const el = ev.currentTarget as HTMLButtonElement;
    const open = el.textContent === "すべて開く";
    main.querySelectorAll<HTMLDetailsElement>("details.block").forEach((d) => (d.open = open));
    el.textContent = open ? "すべて閉じる" : "すべて開く";
  });

  setupKeywords(main, updateCounts);
  updateCounts();

  const cleanup = () => main.removeEventListener("input", updateCounts);

  btn.addEventListener("click", async () => {
    err.hidden = true;
    const values: Record<string, number> = {};
    main.querySelectorAll<HTMLInputElement>("[data-metric]").forEach((inp) => {
      const n = parseNum(inp.value);
      if (n !== null) values[inp.dataset.metric!] = n;
    });
    const keywords = [...main.querySelectorAll<HTMLElement>("[data-kw-row]")]
      .map((row) => ({
        keyword: (row.querySelector("[data-kw-keyword]") as HTMLInputElement).value.trim(),
        impressions: parseNum((row.querySelector("[data-kw-impressions]") as HTMLInputElement).value),
        clicks: parseNum((row.querySelector("[data-kw-clicks]") as HTMLInputElement).value),
        ctr: parseNum((row.querySelector("[data-kw-ctr]") as HTMLInputElement).value),
        position: parseNum((row.querySelector("[data-kw-position]") as HTMLInputElement).value),
      }))
      .filter((k) => k.keyword);
    const noteValues: Record<string, string> = {};
    main.querySelectorAll<HTMLTextAreaElement>("[data-note]").forEach((t) => {
      if (t.value.trim()) noteValues[t.dataset.note!] = t.value.trim();
    });

    const body = {
      title: val("#f-title"),
      period_label: val("#f-period"),
      input_text: val("#f-consult"),
      input_data: { values, keywords, notes: noteValues },
      extra_text: val("#f-extra"),
      analyst_mode: val("#f-mode"),
    };
    btn.disabled = true;
    btn.textContent = "開始しています…";
    try {
      const res = await api.post<{ project: { id: string } }>("/api/projects", body);
      location.hash = `#/projects/${res.project.id}`;
    } catch (e) {
      err.hidden = false;
      err.innerHTML = `<b>開始できませんでした。</b> ${esc(e instanceof Error ? e.message : String(e))}${e instanceof ApiError && e.code === "analysis_running" ? ' <a href="#/" style="text-decoration:underline">分析中の案件を見る</a>' : ""}`;
      btn.disabled = false;
      btn.textContent = "分析開始";
    }
  });

  return cleanup;
}

/** 検索キーワードの表（何行でも追加・削除できる） */
function keywordsBlock(): string {
  return `<div class="kw">
    <div class="eyebrow">重要検索キーワード（何件でも追加できます）</div>
    <div class="kw-head"><span>検索キーワード</span><span>表示回数</span><span>クリック数</span><span>CTR（%）</span><span>平均掲載順位</span><span></span></div>
    <div id="kwRows"></div>
    <button type="button" class="btn sm" id="kwAdd">キーワードを追加</button>
  </div>`;
}

function setupKeywords(main: HTMLElement, onChange: () => void) {
  const rows = main.querySelector<HTMLElement>("#kwRows");
  if (!rows) return;
  const addRow = (keyword = "") => {
    if (rows.children.length >= 30) return toast("キーワードは 30 件までです。");
    const row = document.createElement("div");
    row.className = "kw-row";
    row.setAttribute("data-kw-row", "");
    row.innerHTML = `<input data-kw-keyword placeholder="例: 高知 ジム" value="${esc(keyword)}">
      <input data-kw-impressions inputmode="decimal" placeholder="—">
      <input data-kw-clicks inputmode="decimal" placeholder="—">
      <input data-kw-ctr inputmode="decimal" placeholder="自動">
      <input data-kw-position inputmode="decimal" placeholder="—">
      <button type="button" class="kw-del" aria-label="この行を削除">×</button>`;
    row.querySelector(".kw-del")!.addEventListener("click", () => {
      row.remove();
      onChange();
    });
    rows.appendChild(row);
    onChange();
  };
  main.querySelector("#kwAdd")!.addEventListener("click", () => addRow());
  // よく使うキーワードを最初に 2 行だけ用意する（名前は自由に変えられる）
  addRow("高知 ジム");
  addRow("高知市 ジム");
}
