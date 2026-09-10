import { api, type Analysis, type Evidence, type Kpi, type ProjectBundle, type TaskFull } from "../api";
import { esc, fmtDate, fmtNum, PROJECT_STATUS_JA, RESTRICTED_JA, TASK_STATUS_JA, VERDICT_JA, statusChip, toast, errorBox } from "../components";
import { renderMarkdown } from "../markdown";

/** ③ 案件詳細: 進捗 → 入力 → 分析部 → 経営司令塔 → 最優先施策（成果物・承認・KPI） */
const STEPS = ["analyzing", "candidates", "awaiting_approval", "in_progress", "awaiting_verification", "completed"];
let metricLabels: Record<string, string> | null = null;
let analysts: Array<{ id: string; name: string }> | null = null;

export async function renderProject(main: HTMLElement, params: Record<string, string>) {
  const id = params.id;
  if (!metricLabels || !analysts) {
    const [{ metrics }, { employees }] = await Promise.all([
      api.get<{ metrics: Array<{ id: string; label: string; unit: string }> }>("/api/projects/metrics"),
      api.get<{ employees: Array<{ id: string; name: string; department: string }> }>("/api/employees"),
    ]);
    metricLabels = Object.fromEntries(metrics.map((m) => [m.id, `${m.label}（${m.unit}）`]));
    analysts = employees.filter((e) => e.department === "analysis").map((e) => ({ id: e.id, name: e.name }));
  }
  let lastSig = "";
  let timer: number | undefined;
  const openVersions: Record<string, number> = {};

  const load = async (force = false) => {
    const b = await api.get<ProjectBundle>(`/api/projects/${encodeURIComponent(id)}`);
    const sig = signature(b);
    if (force || sig !== lastSig) {
      lastSig = sig;
      draw(main, b, openVersions, () => load(true));
    }
    const busy = b.project.status === "analyzing" || b.project.status === "candidates" || b.tasks.some((t) => t.status === "candidate" || t.status === "revising");
    window.clearTimeout(timer);
    if (busy) timer = window.setTimeout(() => load().catch(() => undefined), 3000);
  };
  await load(true);
  return () => window.clearTimeout(timer);
}

function signature(b: ProjectBundle): string {
  return [b.project.status, b.project.updated_at, b.project.selected_analysts?.join(",") ?? "", ...b.analyses.map((a) => a.employee_id + a.status), b.decision?.id ?? "", ...b.tasks.map((t) => `${t.id}:${t.status}:${t.outputs.length}:${t.kpis.map((k) => k.id + k.actual_value + k.confirmed).join("|")}`)].join(";");
}

function draw(main: HTMLElement, b: ProjectBundle, openVersions: Record<string, number>, refresh: () => Promise<void>) {
  const p = b.project;
  const stepIdx = STEPS.indexOf(p.status);
  const stepper = STEPS.map((s, i) => `<div class="stp" data-s="${p.status === "failed" || p.status === "rejected" ? "" : i < stepIdx ? "done" : i === stepIdx ? "active" : ""}"><span class="mk"></span>${esc(PROJECT_STATUS_JA[s])}</div>`).join("");
  const nums = p.input_data ? Object.entries(p.input_data).map(([k, v]) => `<span>${esc(metricLabels?.[k] ?? k)} <b>${esc(typeof v === "number" ? fmtNum(v) : v)}</b></span>`).join("") : "";
  const selected = p.selected_analysts;

  const analysisRows = (analysts ?? []).map((emp, i) => {
    const a = b.analyses.find((x) => x.employee_id === emp.id);
    const no = `<span class="no">${String(i + 1).padStart(2, "0")}</span>`;
    if (!a) {
      if (!selected) return `<details class="skip"><summary>${no}<span class="nm">${esc(emp.name)}<small>${p.status === "analyzing" ? "担当を選定中…" : "今回は不要"}</small></span><span></span></summary></details>`;
      return `<details class="skip"><summary>${no}<span class="nm">${esc(emp.name)}<small>今回は不要（司令塔の判断）</small></span><span></span></summary></details>`;
    }
    return analysisBlock(a, no, b.analyses.filter((x) => x.status === "done").length === 1);
  }).join("");

  const d = b.decision;
  const commander = d
    ? `<div class="cmd"><p class="lead">${esc(d.summary_md)}</p><div class="grid">${fourColumns(d.facts, d.hypotheses, d.evidence, d.needed_data)}</div>
        <div class="notnow"><h4>今やらなくていいこと</h4><ul>${d.not_now.map((x) => `<li class="nn">${esc(x.item)}<small>${esc(x.reason)}</small></li>`).join("")}</ul></div></div>`
    : `<div class="cmd"><div class="placeholder" style="padding:6px 0">${p.status === "analyzing" ? "分析部の結果が揃うと、ここに「結局、今何をやるべきか」が表示されます。" : "司令塔の判断はありません。"}</div></div>`;

  const tasks = b.tasks.length
    ? `<div class="tasks n${Math.min(3, b.tasks.length)}">${b.tasks.map((t) => taskCard(t, openVersions)).join("")}</div>`
    : `<div class="placeholder">${p.status === "analyzing" || p.status === "candidates" ? "司令塔の判断後、担当 AI が成果物を作成します。" : "施策はありません。"}</div>`;

  main.innerHTML = `<section class="view">
    <div class="head"><h1>${esc(p.title)}</h1><div class="date">${esc(fmtDate(p.created_at, true))} · <span class="status ${esc(p.status)}">${esc(PROJECT_STATUS_JA[p.status] ?? p.status)}</span></div></div>
    <div class="stepper">${stepper}</div>
    ${p.status === "failed" ? `<div style="margin-top:14px">${errorBox(p.error ?? "原因不明のエラーです。", "続きから再実行")}</div>` : ""}
    ${p.status === "analyzing" && Date.now() - new Date(p.updated_at).getTime() > 8 * 60 * 1000 ? `<div style="margin-top:14px" class="error">分析に時間がかかっています。止まっているようなら中止して再実行できます。 <button type="button" class="btn sm" data-cancel style="margin-left:12px">分析を中止</button></div>` : ""}
    <div class="input-sum">
      <div>${nums ? `<div class="nums">${nums}</div>` : ""}${p.input_text ? `<p class="consult">相談: ${esc(p.input_text)}</p>` : ""}${p.extra_text ? `<details style="margin-top:8px"><summary style="font-size:12px;color:var(--muted);cursor:pointer">追加データを表示</summary><p class="consult">${esc(p.extra_text)}</p></details>` : ""}</div>
      <div style="font-size:12px;color:var(--muted);max-width:280px">${p.selection_reason ? `担当の選定: ${esc(p.selection_reason)}` : ""}</div>
    </div>
    <div class="sec"><div class="sec-head"><h2>分析部の結果 <span>${selected ? `担当 ${selected.length} 名` : "担当を選定中"}</span></h2></div><div class="acc">${analysisRows}</div></div>
    <div class="sec"><div class="sec-head"><h2>経営司令塔の判断</h2><div class="hint">判断基準: インパクト ÷ 必要時間</div></div>${commander}</div>
    <div class="sec"><div class="sec-head"><h2>最優先施策 <span>最大 3 つ · 実行部の成果物</span></h2><div class="hint">採用すると KPI を確定し「実行中」へ</div></div>${tasks}</div>
    <div class="foot-note">実行部の成果物は文章・原稿・仕様書のみです。HP 公開、広告出稿、SNS 投稿、LINE 送信、料金変更、会員データ変更は AI からは行えず、代表の承認と操作が必要です。</div>
  </section>`;

  bind(main, b, openVersions, refresh);
}

function analysisBlock(a: Analysis, no: string, open: boolean): string {
  if (a.status === "running") return `<details><summary>${no}<span class="nm">${esc(a.employee_name)}<small>分析中…</small></span>${statusChip("running", { running: "作業中" })}</summary></details>`;
  if (a.status === "failed") return `<details><summary>${no}<span class="nm">${esc(a.employee_name)}<small>失敗</small></span>${statusChip("failed")}</summary><div class="body"><p class="findings">${esc(a.findings_md ?? "")}</p></div></details>`;
  return `<details${open ? " open" : ""}><summary>${no}<span class="nm">${esc(a.employee_name)}<small>${esc(a.headline ?? "")}</small></span>${statusChip("completed")}</summary>
    <div class="body"><p class="findings">${esc(a.findings_md ?? "")}</p>${fourColumns(a.facts, a.hypotheses, a.evidence, a.needed_data)}</div></details>`;
}

/** 事実 / 仮説 / 根拠となった数字 / 追加で必要なデータ の 4 区分表示 */
function fourColumns(facts: string[], hypotheses: string[], evidence: Evidence[], needed: string[]): string {
  const list = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<p class="none">なし</p>');
  const ev = evidence.length
    ? `<table class="ev"><tbody>${evidence.map((e) => `<tr><td>${esc(e.label)}</td><td class="v">${esc(e.value)}</td><td class="s">${esc(e.source)}</td></tr>`).join("")}</tbody></table>`
    : '<p class="none">なし</p>';
  return `<div class="quad"><div><h4>事実</h4>${list(facts)}</div><div><h4>仮説</h4>${list(hypotheses)}</div><div><h4>根拠となった数字</h4>${ev}</div><div><h4>追加で必要なデータ</h4>${list(needed)}</div></div>`;
}

function taskCard(t: TaskFull, openVersions: Record<string, number>): string {
  const latest = t.outputs[t.outputs.length - 1];
  const ver = openVersions[t.id] ?? latest?.version;
  const out = t.outputs.find((o) => o.version === ver) ?? latest;
  const ratio = (t.impact_score / Math.max(0.5, t.effort_hours)).toFixed(2);
  const chip = t.status === "completed" && t.kpis[0]?.verdict ? `<span class="badge">${esc(VERDICT_JA[t.kpis[0].verdict] ?? "")}</span>` : statusChip(t.status);

  const body = !out
    ? `<div class="out"><div class="placeholder" style="padding:6px 0">${t.status === "failed" ? "成果物の作成に失敗しました。" : `${esc(t.executor_name)}が成果物を作成しています…`}</div></div>`
    : `<div class="out"><div class="eyebrow"><span>${esc(t.executor_name)} の成果物</span>${t.outputs.length > 1 ? `<select data-ver="${t.id}">${t.outputs.map((o) => `<option value="${o.version}"${o.version === out.version ? " selected" : ""}>v${o.version}</option>`).join("")}</select>` : `<span>v${out.version}</span>`}</div>
        ${out.revision_note ? `<p style="font-size:12px;color:var(--muted);margin:0 0 8px">修正指示: ${esc(out.revision_note)}</p>` : ""}
        <div class="md">${renderMarkdown(out.content_md)}</div>
        <div class="out-meta">${esc(out.model ?? "")}${out.input_tokens ? ` · in ${fmtNum(out.input_tokens)} / out ${fmtNum(out.output_tokens)} tokens` : ""} · ${esc(fmtDate(out.created_at, true))}</div></div>`;

  const kpiRows = t.kpis.length
    ? t.kpis.map((k) => `<div class="r"><span>${esc(k.name)}${k.unit ? `（${esc(k.unit)}）` : ""}</span><b>${fmtNum(k.baseline_value)}</b><b>→ ${fmtNum(k.target_value)}${k.actual_value !== null ? ` ／ 実績 ${fmtNum(k.actual_value)}` : ""}</b></div>`).join("")
    : '<div class="r"><span style="color:var(--faint)">KPI 未設定</span><b></b><b></b></div>';
  const canEditKpi = t.status === "awaiting_approval" || t.status === "in_progress";
  const kpi = `<div class="kpi"><div class="eyebrow" style="margin-bottom:6px;display:flex;justify-content:space-between">KPI${t.kpis[0]?.confirmed ? "（確定）" : "（AI の提案値）"}${canEditKpi ? `<button type="button" data-kpi-edit="${t.id}" style="text-decoration:underline;text-underline-offset:3px;text-transform:none;letter-spacing:.04em">編集</button>` : ""}</div>${kpiRows}
    ${canEditKpi ? kpiEditor(t) : ""}</div>`;

  let act = "";
  switch (t.status) {
    case "awaiting_approval":
      act = `<div class="act"><button type="button" class="btn primary" data-dec="adopted" data-task="${t.id}">採用</button><button type="button" class="btn" data-dec="revise" data-task="${t.id}">修正</button><button type="button" class="btn danger" data-dec="rejected" data-task="${t.id}">却下</button></div>
        <div class="panel" id="rev-${t.id}"><label class="f">修正指示（担当 AI が全文を作り直します）<textarea data-revnote="${t.id}" placeholder="例: 文面をもう少し短く。3 日後の LINE は不要。"></textarea></label><div class="r"><button type="button" class="btn sm" data-panel-close="rev-${t.id}">キャンセル</button><button type="button" class="btn sm primary" data-revsend="${t.id}">修正を依頼</button></div></div>
        <div class="panel" id="rej-${t.id}"><label class="f">却下の理由（ナレッジに残ります）<textarea data-rejnote="${t.id}" placeholder="例: 今は人手が足りない。来月再検討。"></textarea></label><div class="r"><button type="button" class="btn sm" data-panel-close="rej-${t.id}">キャンセル</button><button type="button" class="btn sm primary" data-rejsend="${t.id}">却下する</button></div></div>`;
      break;
    case "revising":
      act = `<div class="note-box"><span class="badge">修正中</span><span>${esc(t.executor_name)}が次の版を作成しています…</span></div>`;
      break;
    case "in_progress":
      act = `<div class="note-box"><span class="badge">採用</span><span>実行中です。実施が終わったら「実施した」を押してください。</span></div><div class="act"><button type="button" class="btn" data-implemented="${t.id}">実施した</button></div>`;
      break;
    case "awaiting_verification":
      act = `<div class="note-box"><span class="badge">検証待ち</span><span>KPI の実績を入力し、続行 / 改善 / 中止 を選んでください。</span></div>
        <div class="panel" data-open="1" id="ver-${t.id}">
          ${t.kpis.map((k) => `<div class="r" style="justify-content:space-between;align-items:center"><span style="font-size:13px;color:var(--muted)">${esc(k.name)}${k.unit ? `（${esc(k.unit)}）` : ""} 目標 ${fmtNum(k.target_value)}</span><input inputmode="decimal" placeholder="実績" data-actual="${k.id}" value="${k.actual_value ?? ""}" style="width:120px;min-height:40px;text-align:right;font-family:var(--mono)"></div>`).join("")}
          <div class="seg" data-seg="${t.id}"><button type="button" data-verdict="continue" aria-pressed="false">続行</button><button type="button" data-verdict="improve" aria-pressed="false">改善</button><button type="button" data-verdict="stop" aria-pressed="false">中止</button></div>
          <label class="f">メモ（学びとしてナレッジに残ります）<textarea data-vernote="${t.id}" style="min-height:64px"></textarea></label>
          <div class="r"><button type="button" class="btn sm" data-back="${t.id}">実行中に戻す</button><button type="button" class="btn sm primary" data-versend="${t.id}">検証を完了</button></div></div>`;
      break;
    case "completed":
      act = `<div class="note-box"><span class="badge">完了 · ${esc(VERDICT_JA[t.kpis[0]?.verdict ?? ""] ?? "")}</span><span>${esc(t.kpis[0]?.verdict_note ?? "ナレッジに記録しました。")}</span></div>`;
      break;
    case "rejected":
      act = `<div class="note-box"><span class="badge dim">却下</span><span>${esc(t.approvals.filter((a) => a.decision === "rejected").pop()?.note ?? "ナレッジに「却下した案」として保存しました。")}</span></div>`;
      break;
    case "failed":
      act = `<div class="note-box"><span class="badge dim">エラー</span><span>この施策の成果物は作成できませんでした。</span></div>`;
      break;
  }

  return `<div class="task" data-task-card="${t.id}"><div class="tp"><div class="top"><span class="rk">${t.rank}</span>${chip}</div><h3>${esc(t.title)}</h3><p class="ob">目的: ${esc(t.objective)}</p>
    <dl class="kv"><dt>担当</dt><dd><b><button type="button" data-employee="${esc(t.executor_employee_id)}">${esc(t.executor_name)}</button></b> — ${esc(t.assignment_reason)}</dd><dt>根拠</dt><dd>${esc(t.reasoning)}</dd><dt>評価</dt><dd class="score">インパクト ${t.impact_score} / 5 · 必要時間 ${t.effort_hours} h · 比 ${ratio}</dd></dl>
    ${t.restricted_actions.length ? `<span class="flag">代表承認が必要: ${t.restricted_actions.map((r) => esc(RESTRICTED_JA[r] ?? r)).join("・")}</span>` : ""}</div>${body}${kpi}${act}</div>`;
}

function kpiEditor(t: TaskFull): string {
  const rows = [...t.kpis, ...Array(Math.max(0, 2 - t.kpis.length)).fill(null)].slice(0, 3) as Array<Kpi | null>;
  return `<div class="kpi-edit" id="kpiedit-${t.id}">
    <div class="r2" style="font-size:11px;color:var(--faint)"><span>指標</span><span>単位</span><span>現状</span><span>目標</span></div>
    ${rows.map((k) => `<div class="r2"><input data-kn placeholder="例: 見学予約数" value="${esc(k?.name ?? "")}"><input data-ku placeholder="件" value="${esc(k?.unit ?? "")}"><input data-kb inputmode="decimal" value="${k?.baseline_value ?? ""}"><input data-kt inputmode="decimal" value="${k?.target_value ?? ""}"></div>`).join("")}
    <div class="r"><button type="button" class="btn sm" data-panel-close="kpiedit-${t.id}">閉じる</button><button type="button" class="btn sm primary" data-kpisave="${t.id}">KPI を保存</button></div></div>`;
}

function bind(main: HTMLElement, b: ProjectBundle, openVersions: Record<string, number>, refresh: () => Promise<void>) {
  const q = <T extends Element>(sel: string) => main.querySelectorAll<T>(sel);
  const val = (sel: string) => (main.querySelector(sel) as HTMLTextAreaElement | HTMLInputElement | null)?.value ?? "";
  const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(/[,，]/g, "")));
  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try { await fn(); if (ok) toast(ok); await refresh(); } catch (e) { toast(e instanceof Error ? e.message : String(e)); }
  };
  const readKpis = (taskId: string) =>
    [...q<HTMLElement>(`#kpiedit-${taskId} .r2`)].slice(1).map((row) => ({
      name: (row.querySelector("[data-kn]") as HTMLInputElement).value,
      unit: (row.querySelector("[data-ku]") as HTMLInputElement).value,
      baseline_value: num((row.querySelector("[data-kb]") as HTMLInputElement).value),
      target_value: num((row.querySelector("[data-kt]") as HTMLInputElement).value),
    })).filter((k) => k.name.trim());

  main.querySelector("[data-retry]")?.addEventListener("click", () => run(() => api.post(`/api/projects/${b.project.id}/retry`), "再実行を開始しました。"));
  main.querySelector("[data-cancel]")?.addEventListener("click", () => { if (confirm("分析を中止しますか？（あとで続きから再実行できます）")) run(() => api.post(`/api/projects/${b.project.id}/cancel`), "分析を中止しました。"); });
  q<HTMLSelectElement>("[data-ver]").forEach((s) => s.addEventListener("change", () => { openVersions[s.dataset.ver!] = Number(s.value); refresh(); }));
  q<HTMLElement>("[data-panel-close]").forEach((el) => el.addEventListener("click", () => (main.querySelector<HTMLElement>(`#${el.dataset.panelClose}`)!.dataset.open = "0")));
  q<HTMLElement>("[data-kpi-edit]").forEach((el) => el.addEventListener("click", () => { const p = main.querySelector<HTMLElement>(`#kpiedit-${el.dataset.kpiEdit}`)!; p.dataset.open = p.dataset.open === "1" ? "0" : "1"; }));
  q<HTMLElement>("[data-kpisave]").forEach((el) => el.addEventListener("click", () => run(() => api.put(`/api/tasks/${el.dataset.kpisave}/kpis`, { kpis: readKpis(el.dataset.kpisave!) }), "KPI を保存しました。")));

  q<HTMLElement>("[data-dec]").forEach((el) =>
    el.addEventListener("click", () => {
      const id = el.dataset.task!;
      if (el.dataset.dec === "revise") { main.querySelector<HTMLElement>(`#rej-${id}`)!.dataset.open = "0"; const p = main.querySelector<HTMLElement>(`#rev-${id}`)!; p.dataset.open = "1"; p.querySelector("textarea")?.focus(); return; }
      if (el.dataset.dec === "rejected") { main.querySelector<HTMLElement>(`#rev-${id}`)!.dataset.open = "0"; const p = main.querySelector<HTMLElement>(`#rej-${id}`)!; p.dataset.open = "1"; p.querySelector("textarea")?.focus(); return; }
      const editorOpen = main.querySelector<HTMLElement>(`#kpiedit-${id}`)?.dataset.open === "1";
      run(() => api.post(`/api/tasks/${id}/approval`, { decision: "adopted", kpis: editorOpen ? readKpis(id) : undefined }), "採用しました。KPI を確定し「実行中」にしました。");
    }),
  );
  q<HTMLElement>("[data-revsend]").forEach((el) => el.addEventListener("click", () => {
    const note = val(`[data-revnote="${el.dataset.revsend}"]`).trim();
    if (!note) return toast("修正指示を入力してください。");
    run(() => api.post(`/api/tasks/${el.dataset.revsend}/approval`, { decision: "revise", note }), "修正を依頼しました。担当 AI が次の版を作成します。");
  }));
  q<HTMLElement>("[data-rejsend]").forEach((el) => el.addEventListener("click", () => run(() => api.post(`/api/tasks/${el.dataset.rejsend}/approval`, { decision: "rejected", note: val(`[data-rejnote="${el.dataset.rejsend}"]`) }), "却下しました。ナレッジに保存しました。")));
  q<HTMLElement>("[data-implemented]").forEach((el) => el.addEventListener("click", () => run(() => api.post(`/api/tasks/${el.dataset.implemented}/status`, { status: "awaiting_verification" }), "「検証待ち」にしました。期日に KPI を入力してください。")));
  q<HTMLElement>("[data-back]").forEach((el) => el.addEventListener("click", () => run(() => api.post(`/api/tasks/${el.dataset.back}/status`, { status: "in_progress" }))));
  q<HTMLElement>("[data-seg] button").forEach((btn) => btn.addEventListener("click", () => { btn.parentElement!.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === btn))); }));
  q<HTMLElement>("[data-versend]").forEach((el) => el.addEventListener("click", () => {
    const id = el.dataset.versend!;
    const verdict = main.querySelector<HTMLElement>(`[data-seg="${id}"] button[aria-pressed="true"]`)?.dataset.verdict;
    if (!verdict) return toast("続行 / 改善 / 中止 のどれかを選んでください。");
    const kpis = [...q<HTMLInputElement>(`#ver-${id} [data-actual]`)].map((i) => ({ id: i.dataset.actual!, actual_value: num(i.value) }));
    run(() => api.post(`/api/tasks/${id}/verify`, { verdict, note: val(`[data-vernote="${id}"]`), kpis }), `検証を完了しました（${VERDICT_JA[verdict]}）。ナレッジに保存しました。`);
  }));
  void TASK_STATUS_JA;
}
