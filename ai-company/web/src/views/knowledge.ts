import { api, type Knowledge } from "../api";
import { esc, fmtDate, fmtNum, KNOWLEDGE_KIND_JA, OUTCOME_JA, toast } from "../components";
import { renderMarkdown } from "../markdown";

/** ⑥ ナレッジ（成功 / 失敗 / 却下・案 / 分析 / 学び） */
/** 1 件のナレッジ（構造化データがあれば表で見せる） */
function knowledgeRow(k: Knowledge): string {
  const d = k.data;
  const outcome = k.outcome ? OUTCOME_JA[k.outcome] ?? k.outcome : null;
  const kpiTable = d?.kpis?.length
    ? `<div class="tbl"><table><thead><tr><th>KPI</th><th>施策前</th><th>目標</th><th>施策後</th></tr></thead><tbody>${d.kpis
        .map((x) => `<tr><td>${esc(x.name)}${x.unit ? `（${esc(x.unit)}）` : ""}</td><td>${fmtNum(x.baseline_value)}</td><td>${fmtNum(x.target_value)}</td><td>${fmtNum(x.actual_value)}</td></tr>`)
        .join("")}</tbody></table></div>`
    : "";
  const nums = d?.numbers_at_the_time ? Object.entries(d.numbers_at_the_time).map(([kk, v]) => `${esc(kk)} ${esc(typeof v === "number" ? fmtNum(v) : v)}`).join(" · ") : "";
  const detail = d
    ? `<dl class="kv kn">
        ${d.issue ? `<dt>課題</dt><dd>${esc(d.issue)}</dd>` : ""}
        ${nums ? `<dt>当時の数字</dt><dd class="mono">${nums}</dd>` : ""}
        ${d.hypotheses?.length ? `<dt>仮説</dt><dd>${d.hypotheses.map((h) => esc(h)).join("<br>")}</dd>` : ""}
        ${d.action?.title ? `<dt>施策</dt><dd>${esc(d.action.title)}${d.action.executor ? `（担当: ${esc(d.action.executor)}${d.action.human_owner ? ` / ${esc(d.action.human_owner)}` : ""}）` : ""}</dd>` : ""}
        ${d.result ? `<dt>結果</dt><dd><b>${esc(d.result)}</b>${d.achievement ? `（KPI 判定: ${esc({ achieved: "達成", partial: "一部達成", missed: "未達" }[d.achievement] ?? d.achievement)}）` : ""}</dd>` : ""}
        ${d.lesson ? `<dt>学び</dt><dd>${esc(d.lesson)}</dd>` : ""}
        ${d.next_time ? `<dt>次回は</dt><dd>${esc(d.next_time)}</dd>` : ""}
        ${d.other_factors ? `<dt>他の要因</dt><dd>${esc(d.other_factors)}</dd>` : ""}
        ${d.reason ? `<dt>却下理由</dt><dd>${esc(d.reason)}</dd>` : ""}
      </dl>${kpiTable}`
    : `<div class="md">${renderMarkdown(k.body_md || "（本文なし）")}</div>`;
  return `<details><summary><span class="badge ${k.outcome === "success" ? "" : "dim"}" style="width:auto">${esc(outcome ?? KNOWLEDGE_KIND_JA[k.kind] ?? k.kind)}</span><span class="nm">${esc(k.title)}<small>${esc(fmtDate(k.created_at))}${k.tags.length ? " · " + esc(k.tags.join(" / ")) : ""}</small></span><span></span></summary><div class="body">${detail}${d && k.source_type === "task" ? `<p class="src">この記録は次回の分析で経営司令塔と分析担当に渡されます。</p>` : ""}</div></details>`;
}

export async function renderKnowledge(main: HTMLElement, params: Record<string, string>) {
  const kind = params.kind ?? "";
  const { knowledge } = await api.get<{ knowledge: Knowledge[] }>(`/api/knowledge?limit=200${kind ? `&kind=${encodeURIComponent(kind)}` : ""}`);
  const kinds = ["", "success", "failure", "learning", "idea", "analysis"];

  main.innerHTML = `<section class="view">
    <div class="head"><h1>ナレッジ</h1><div class="date">${knowledge.length} 件 · 経営司令塔が毎回参照</div></div>
    <div class="sec first">
      <div class="sec-head"><h2>学びの記録</h2><div class="hint">${kinds.map((k) => `<a href="#/knowledge${k ? `?kind=${k}` : ""}" style="margin-left:14px;${k === kind ? "color:var(--text)" : ""}">${k ? esc(KNOWLEDGE_KIND_JA[k]) : "すべて"}</a>`).join("")}</div></div>
      <div class="acc">${
        knowledge.length
          ? knowledge.map((k) => knowledgeRow(k)).join("")
          : '<div class="placeholder">まだナレッジはありません。施策を完了・却下すると自動で記録されます。</div>'
      }</div>
    </div>
    <div class="sec">
      <div class="sec-head"><h2>学びを手で追加</h2></div>
      <form class="card" id="kForm">
        <div class="grid3">
          <label class="f">種類<select id="k-kind"><option value="learning">学び</option><option value="success">成功</option><option value="failure">失敗</option><option value="idea">案</option><option value="analysis">分析</option></select></label>
          <label class="f" style="grid-column: span 2">題名<input id="k-title" placeholder="例: 夏は見学が減るので 6 月に予約導線を強化する"></label>
          <label class="f full">内容（任意）<textarea id="k-body" style="min-height:80px"></textarea></label>
          <label class="f full">タグ（カンマ区切り、任意）<input id="k-tags" placeholder="例: 見学, 集客"></label>
        </div>
        <div class="form-actions" style="margin-top:12px"><button type="submit" class="btn">保存</button></div>
      </form>
    </div>
  </section>`;

  main.querySelectorAll<HTMLElement>("[data-open-project]").forEach((el) => el.addEventListener("click", (ev) => ev.stopPropagation()));
  main.querySelector<HTMLFormElement>("#kForm")!.addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = (id: string) => (main.querySelector(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value;
    try {
      await api.post("/api/knowledge", { kind: v("#k-kind"), title: v("#k-title"), body_md: v("#k-body"), tags: v("#k-tags").split(/[,、，]/).map((s) => s.trim()).filter(Boolean) });
      toast("ナレッジを保存しました。");
      renderKnowledge(main, params);
    } catch (e) {
      toast(e instanceof Error ? e.message : "保存に失敗しました。");
    }
  });
}
