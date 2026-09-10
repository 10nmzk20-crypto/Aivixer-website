import { api, ApiError, type Metric } from "../api";
import { esc, parseNum } from "../components";

/** ② データ・相談入力 → ［分析開始］ */
export async function renderNewAnalysis(main: HTMLElement) {
  const { metrics } = await api.get<{ metrics: Metric[] }>("/api/projects/metrics");
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const defaultPeriod = `${lastMonth.getFullYear()} 年 ${lastMonth.getMonth() + 1} 月`;

  main.innerHTML = `<section class="view">
    <div class="head"><h1>新しい分析</h1><div class="date">STEP <b>01</b> · 入力</div></div>
    <form class="form" id="newForm">
      <div class="card">
        <h3>今月の数字（分かるものだけで構いません）</h3>
        <div class="grid3">
          <label class="f">対象期間<input id="f-period" value="${esc(defaultPeriod)}" placeholder="例: 2026 年 8 月"></label>
          <label class="f" style="grid-column: span 2">案件名（空欄なら自動）<input id="f-title" placeholder="例: 8 月の月次データ"></label>
          ${metrics.map((m) => `<label class="f">${esc(m.label)}（${esc(m.unit)}）<input data-metric="${m.id}" inputmode="decimal" placeholder="—"></label>`).join("")}
        </div>
        <div class="warn">会員名や連絡先などの個人情報は入力しないでください。人数・金額・率などの集計値だけを扱います。</div>
      </div>
      <div class="card">
        <h3>相談内容・気になっていること</h3>
        <label class="f">自由記述<textarea id="f-consult" placeholder="例: 見学は増えているのに、30日お試しに進む人が減っている気がする。退会も 2 か月続けて 15 人を超えた。"></textarea></label>
        <label class="f" style="margin-top:12px">追加データ（表や CSV の貼り付け、任意）<textarea id="f-extra" placeholder="例: 流入経路別の見学数、退会理由の内訳、検索順位 など" style="min-height:88px"></textarea></label>
        <label class="f" style="margin-top:12px">分析担当の選び方<select id="f-mode"><option value="auto">経営司令塔が自動で選ぶ（推奨）</option><option value="all">分析部 8 人全員に分析させる</option></select></label>
      </div>
      <div class="form-actions">
        <span class="note">分析には数分かかります。開始後は案件詳細に自動で結果が表示されます。</span>
        <div id="formErr" class="error" hidden></div>
        <button type="submit" class="btn primary big" id="submitBtn">分析開始</button>
      </div>
    </form>
  </section>`;

  const form = main.querySelector<HTMLFormElement>("#newForm")!;
  const btn = main.querySelector<HTMLButtonElement>("#submitBtn")!;
  const err = main.querySelector<HTMLElement>("#formErr")!;
  form.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    err.hidden = true;
    const data: Record<string, number> = {};
    main.querySelectorAll<HTMLInputElement>("[data-metric]").forEach((inp) => {
      const n = parseNum(inp.value);
      if (n !== null) data[inp.dataset.metric!] = n;
    });
    const body = {
      title: (main.querySelector("#f-title") as HTMLInputElement).value,
      period_label: (main.querySelector("#f-period") as HTMLInputElement).value,
      input_text: (main.querySelector("#f-consult") as HTMLTextAreaElement).value,
      input_data: data,
      extra_text: (main.querySelector("#f-extra") as HTMLTextAreaElement).value,
      analyst_mode: (main.querySelector("#f-mode") as HTMLSelectElement).value,
    };
    btn.disabled = true; btn.textContent = "開始しています…";
    try {
      const res = await api.post<{ project: { id: string } }>("/api/projects", body);
      location.hash = `#/projects/${res.project.id}`;
    } catch (e) {
      err.hidden = false;
      err.innerHTML = `<b>開始できませんでした。</b> ${esc(e instanceof Error ? e.message : String(e))}${e instanceof ApiError && e.code === "analysis_running" ? ' <a href="#/" style="text-decoration:underline">分析中の案件を見る</a>' : ""}`;
      btn.disabled = false; btn.textContent = "分析開始";
    }
  });
}
