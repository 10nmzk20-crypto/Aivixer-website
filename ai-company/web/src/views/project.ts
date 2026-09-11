import { api, type Analysis, type Comparison, type DerivedKpi, type Evidence, type Frame, type Funnel, type Kpi, type MetricGroup, type ProjectBundle, type Report, type RosterEntry, type TaskFull, type Verification } from "../api";
import { esc, fmtDate, fmtNum, ACHIEVEMENT_JA, FUNNEL_STATUS_JA, HUMAN_WORK_JA, PROJECT_STATUS_JA, RESTRICTED_JA, TASK_STATUS_JA, TASK_TYPE_JA, VERDICT_JA, statusChip, toast, errorBox } from "../components";
import { renderMarkdown } from "../markdown";

/** ③ 案件詳細: 進捗 → 入力 → 分析部 → 経営司令塔 → 最優先施策（成果物・承認・KPI） */
const STEPS = ["analyzing", "candidates", "awaiting_approval", "in_progress", "awaiting_verification", "completed"];
let metricLabels: Record<string, string> | null = null;
let analysts: Array<{ id: string; name: string }> | null = null;

export async function renderProject(main: HTMLElement, params: Record<string, string>) {
  const id = params.id;
  if (!metricLabels || !analysts) {
    const [{ groups }, { employees }] = await Promise.all([
      api.get<{ groups: MetricGroup[] }>("/api/projects/metrics"),
      api.get<{ employees: Array<{ id: string; name: string; department: string }> }>("/api/employees"),
    ]);
    metricLabels = Object.fromEntries(groups.flatMap((g) => g.metrics.map((m) => [m.id, `${m.label}（${m.unit}）`])));
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
    const busy =
      b.project.status === "analyzing" ||
      b.project.status === "candidates" ||
      b.tasks.some((t) => ["candidate", "plan_revising", "producing", "revising", "verifying"].includes(t.status));
    window.clearTimeout(timer);
    if (busy) timer = window.setTimeout(() => load().catch(() => undefined), 3000);
  };
  await load(true);
  return () => window.clearTimeout(timer);
}

function signature(b: ProjectBundle): string {
  return [b.project.status, b.project.updated_at, b.project.selected_analysts?.join(",") ?? "", ...b.analyses.map((a) => a.employee_id + a.status), b.decision?.id ?? "", ...b.tasks.map((t) => `${t.id}:${t.status}:${t.plan_version}:${t.outputs.length}:${t.verification?.id ?? ""}:${t.kpis.map((k) => k.id + k.actual_value + k.confirmed).join("|")}`)].join(";");
}

function draw(main: HTMLElement, b: ProjectBundle, openVersions: Record<string, number>, refresh: () => Promise<void>) {
  const p = b.project;
  const stepIdx = STEPS.indexOf(p.status);
  const stepper = STEPS.map((s, i) => `<div class="stp" data-s="${p.status === "failed" || p.status === "rejected" ? "" : i < stepIdx ? "done" : i === stepIdx ? "active" : ""}"><span class="mk"></span>${esc(PROJECT_STATUS_JA[s])}</div>`).join("");
  const nums = p.input_data ? Object.entries(p.input_data.values).map(([k, v]) => `<span>${esc(metricLabels?.[k] ?? k)} <b>${fmtNum(v)}</b></span>`).join("") : "";
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
    ? `<div class="cmd">
        <h4>今月の最重要課題</h4><p class="lead">${esc(d.top_issue)}</p>
        <h4>そう判断した理由</h4><p class="reason">${esc(d.reasoning_md)}</p>
        <div class="grid cols3">
          <div><h4>根拠となった数字</h4>${evidenceTable(d.evidence)}</div>
          <div><h4>今はやらないこと</h4><ul>${d.not_now.map((x) => `<li class="nn">${esc(x.item)}<small>${esc(x.reason)}</small></li>`).join("") || "<li>なし</li>"}</ul></div>
          <div><h4>追加で必要なデータ</h4><ul>${d.needed_data.map((x) => `<li>${esc(x)}</li>`).join("") || "<li>なし</li>"}</ul></div>
        </div>
        <p class="tasks-note">今やること（最大 3 つ）は下の「最優先施策」です。</p></div>`
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
    ${funnelSection(p.funnel, p.derived)}
    <div class="sec" id="reportSec">
      <div class="sec-head"><h2>ChatGPT 用レポート</h2><div class="hint">このアプリは外部 AI を呼びません。レポートを ChatGPT に貼り付けて分析します</div></div>
      <div class="card report-card">
        <div class="report-actions">
          <button type="button" class="btn primary" id="makeReport">ChatGPT 用レポートを作成</button>
          <button type="button" class="btn" id="copyReport" hidden>全文コピー</button>
          <span class="note" id="reportMeta"></span>
        </div>
        <div id="reportBody"></div>
      </div>
    </div>
    <div class="sec"${b.roster.analysts.length === 0 ? ' hidden' : ""}><div class="sec-head"><h2>今回招集された AI 社員 <span>${selected ? `分析 ${b.roster.analysts.length} 名 + 司令塔${b.roster.executors.length ? ` + 実行 ${b.roster.executors.length} 名` : ""}` : "司令塔が招集中"}</span></h2><div class="hint">相談内容に必要な担当だけを招集し、他の社員は動かしません</div></div>
      <div class="roster">${rosterChips(b.roster.analysts, "分析部", "analysis")}${rosterChips([b.roster.commander], "司令塔", "command")}${rosterChips(b.roster.executors, "実行部", "execution")}</div></div>
    <div class="sec"${b.analyses.length === 0 ? ' hidden' : ""}><div class="sec-head"><h2>分析部の結果 <span>${selected ? `担当 ${selected.length} 名` : "担当を選定中"}</span></h2></div><div class="acc">${analysisRows}</div></div>
    <div class="sec"${b.decision ? "" : ' hidden'}><div class="sec-head"><h2>経営司令塔の判断</h2><div class="hint">判断基準: インパクト ÷ 必要時間</div></div>${commander}</div>
    <div class="sec"${b.tasks.length === 0 ? ' hidden' : ""}><div class="sec-head"><h2>最優先施策 <span>最大 3 つ · 実行部の成果物</span></h2><div class="hint">採用すると KPI を確定し「実行中」へ</div></div>${tasks}</div>
    <div class="foot-note">実行部の成果物は文章・原稿・仕様書のみです。HP 公開、広告出稿、SNS 投稿、LINE 送信、料金変更、会員データ変更は AI からは行えず、代表の承認と操作が必要です。</div>
  </section>`;

  bind(main, b, openVersions, refresh);
}

function analysisBlock(a: Analysis, no: string, open: boolean): string {
  if (a.status === "running") return `<details><summary>${no}<span class="nm">${esc(a.employee_name)}<small>分析中…</small></span>${statusChip("running", { running: "作業中" })}</summary></details>`;
  if (a.status === "failed") return `<details><summary>${no}<span class="nm">${esc(a.employee_name)}<small>失敗</small></span>${statusChip("failed")}</summary><div class="body"><p class="findings">${esc(a.findings_md ?? "")}</p></div></details>`;
  const list = (xs: string[]) => (xs.length ? `<ul>${xs.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : '<p class="none">なし</p>');
  return `<details${open ? " open" : ""}><summary>${no}<span class="nm">${esc(a.employee_name)}<small>${esc((a.conclusion ?? "").slice(0, 60))}</small></span>${statusChip("completed")}</summary>
    <div class="body">
      <h4>結論</h4><p class="findings">${esc(a.conclusion ?? a.findings_md ?? "")}</p>
      ${a.unverified_numbers.length ? `<p class="unverified">入力データに見つからない数字が含まれています: ${a.unverified_numbers.map((n) => esc(n)).join("、")}。根拠を確認してください。</p>` : ""}
      <div class="quad cols3">
        <div><h4>確認できる事実</h4>${list(a.facts)}</div>
        <div><h4>仮説（最大 3）と根拠</h4>${a.hypotheses.length ? `<ol class="hyp">${a.hypotheses.map((h) => `<li>${esc(h.hypothesis)}${h.rationale ? `<small>根拠: ${esc(h.rationale)}</small>` : ""}</li>`).join("")}</ol>` : '<p class="none">なし</p>'}</div>
        <div><h4>計算結果・根拠の数字</h4>${evidenceTable(a.evidence)}</div>
        <div><h4>不足データ</h4>${list(a.missing_data)}</div>
        <div class="span2"><h4>推奨アクション（最大 3）</h4>${a.actions.length ? `<ol>${a.actions.map((x) => `<li>${esc(x)}</li>`).join("")}</ol>` : '<p class="none">なし</p>'}</div>
      </div></div></details>`;
}

/** 集客ファネルの判定（コードが数字から機械的に計算した結果）と、自動計算 KPI・前月比 */
function funnelSection(funnel: Funnel | null, derived: { kpis: DerivedKpi[]; comparison: Comparison } | null): string {
  if (!funnel && !derived) return "";
  const stages = funnel
    ? `<div class="funnel">${funnel.stages
        .map(
          (st) => `<div class="fstage" data-s="${esc(st.status)}">
            <div class="fhead"><span class="fname">${esc(st.label)}</span><span class="fstatus">${esc(FUNNEL_STATUS_JA[st.status] ?? st.status)}</span></div>
            <p class="freason">${esc(st.reason)}</p>
            <dl class="fmetrics">${st.metrics.map((m) => `<div><dt>${esc(m.label)}</dt><dd>${esc(m.value)}${m.delta ? `<small>${esc(m.delta)}</small>` : ""}</dd></div>`).join("")}</dl>
          </div>`,
        )
        .join("")}</div>`
    : "";
  const weak = funnel?.weakest ? funnel.stages.find((s) => s.id === funnel.weakest) : null;

  const kpis = derived?.kpis ?? [];
  const calculated = kpis.filter((k) => k.value !== null);
  const uncalculated = kpis.filter((k) => k.value === null);
  const cmp = derived?.comparison;
  const cmpRow = (id: string) => cmp?.rows.find((r) => r.id === id);
  const kpiTable = calculated.length
    ? `<div class="tbl"><table class="kpitbl"><thead><tr><th>KPI</th><th>今月</th><th>前月</th><th>増減</th><th>計算式</th></tr></thead><tbody>${calculated
        .map((k) => {
          const r = cmpRow(k.id);
          const sign = r?.delta != null && r.delta > 0 ? "+" : "";
          return `<tr><td>${esc(k.label)}</td><td class="v">${k.value}${esc(k.unit)}</td><td class="v">${r?.previous != null ? `${r.previous}${esc(k.unit)}` : "—"}</td><td class="v ${r?.delta != null ? (r.delta > 0 ? "up" : r.delta < 0 ? "down" : "") : ""}">${r?.delta != null ? `${sign}${r.delta}${r.deltaPct != null ? `（${sign}${r.deltaPct}%）` : ""}` : "—"}</td><td class="s">${esc(k.formula)}</td></tr>`;
        })
        .join("")}</tbody></table></div>`
    : "";
  const missing = uncalculated.length
    ? `<details class="missing"><summary>計算できなかった KPI（${uncalculated.length} 件）</summary><ul>${uncalculated.map((k) => `<li>${esc(k.label)}: ${esc(k.missing ?? "必要な数字が未入力")}</li>`).join("")}</ul></details>`
    : "";

  return `<div class="sec"><div class="sec-head"><h2>集客ファネルの判定 ${weak ? `<span>最も詰まっている可能性: ${esc(weak.label)}</span>` : ""}</h2><div class="hint">数字から自動判定しています（AI の推測ではありません）${cmp?.previousPeriod ? ` · 前月 ${esc(cmp.previousPeriod)} と比較` : " · 前月データなし"}</div></div>
    ${stages}
    ${kpiTable || missing ? `<div class="kpiwrap"><div class="eyebrow">自動計算した KPI</div>${kpiTable}${missing}</div>` : ""}
  </div>`;
}

/** ChatGPT 用レポートの作成・表示・コピー・履歴 */
function setupReport(main: HTMLElement, projectId: string) {
  const body = main.querySelector<HTMLElement>("#reportBody");
  const makeBtn = main.querySelector<HTMLButtonElement>("#makeReport");
  const copyBtn = main.querySelector<HTMLButtonElement>("#copyReport");
  const meta = main.querySelector<HTMLElement>("#reportMeta");
  if (!body || !makeBtn || !copyBtn || !meta) return;
  let current: Report | null = null;

  const show = (report: Report, history: Report[]) => {
    current = report;
    copyBtn.hidden = false;
    meta.textContent = `第 ${report.version} 版 · ${fmtDate(report.created_at, true)} · ${fmtNum(report.char_count)} 字`;
    body.innerHTML = `<textarea class="report-text" id="reportText" readonly>${esc(report.content)}</textarea>
      ${history.length > 1 ? `<div class="report-history"><div class="eyebrow">このレポートの履歴</div>${history.map((h) => `<button type="button" class="hrow${h.id === report.id ? " on" : ""}" data-report="${h.id}"><span>第 ${h.version} 版</span><span>${esc(h.period_label ?? "")}</span><span>${esc(fmtDate(h.created_at, true))}</span><span>${fmtNum(h.char_count)} 字</span></button>`).join("")}</div>` : ""}`;
    main.querySelectorAll<HTMLElement>("[data-report]").forEach((el) =>
      el.addEventListener("click", () => {
        const picked = history.find((h) => h.id === el.dataset.report);
        if (picked) show(picked, history);
      }),
    );
  };

  const load = async (justCreated?: Report) => {
    const { reports } = await api.get<{ reports: Report[] }>(`/api/projects/${projectId}/reports`);
    if (reports.length === 0) {
      body.innerHTML = '<p class="report-empty">まだレポートはありません。上のボタンで作成すると、ChatGPT に貼り付けられる全文がここに出ます。</p>';
      copyBtn.hidden = true;
      meta.textContent = "";
      return;
    }
    show(justCreated ?? reports[0], reports);
  };

  makeBtn.addEventListener("click", async () => {
    makeBtn.disabled = true;
    const label = makeBtn.textContent;
    makeBtn.textContent = "作成しています…";
    try {
      const { report } = await api.post<{ report: Report }>(`/api/projects/${projectId}/report`);
      await load(report);
      toast("レポートを作成しました。");
      main.querySelector("#reportSec")?.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {
      toast(e instanceof Error ? e.message : "作成に失敗しました。");
    } finally {
      makeBtn.disabled = false;
      makeBtn.textContent = label;
    }
  });

  copyBtn.addEventListener("click", async () => {
    if (!current) return;
    const ok = await copyText(current.content, main.querySelector<HTMLTextAreaElement>("#reportText"));
    toast(ok ? "コピーしました" : "コピーできませんでした。文章を長押しして選択してください。");
  });

  void load();
}

/** iPad でも 1 回のタップでコピーできるようにする */
async function copyText(text: string, area: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 下の方法を試す */
  }
  try {
    // Safari 向け: 表示中のテキスト欄を選択して実行する
    const el = area ?? document.createElement("textarea");
    if (!area) {
      el.value = text;
      el.style.position = "fixed";
      el.style.opacity = "0";
      document.body.appendChild(el);
    }
    el.removeAttribute("readonly");
    el.focus();
    el.setSelectionRange(0, text.length);
    const ok = document.execCommand("copy");
    el.setAttribute("readonly", "");
    if (!area) el.remove();
    return ok;
  } catch {
    return false;
  }
}

function evidenceTable(evidence: Evidence[]): string {
  return evidence.length
    ? `<table class="ev"><tbody>${evidence.map((e) => `<tr><td>${esc(e.label)}</td><td class="v">${esc(e.value)}</td><td class="s">${esc(e.source)}</td></tr>`).join("")}</tbody></table>`
    : '<p class="none">なし</p>';
}

function rosterChips(list: RosterEntry[], label: string, dept: string): string {
  if (!list.length) return "";
  return `<div class="roster-group"><span class="eyebrow">${esc(label)}</span>${list.map((e) => `<button type="button" class="chip" data-employee="${esc(e.id)}" data-dept="${dept}">${esc(e.name)}</button>`).join("")}</div>`;
}

function taskCard(t: TaskFull, openVersions: Record<string, number>): string {
  const latest = t.outputs[t.outputs.length - 1];
  const ver = openVersions[t.id] ?? latest?.version;
  const out = t.outputs.find((o) => o.version === ver) ?? latest;
  const chip = t.status === "completed" && t.kpis[0]?.verdict ? `<span class="badge">${esc(VERDICT_JA[t.kpis[0].verdict] ?? "")}</span>` : statusChip(t.status);

  // 成果物は「採用」後に実行担当 AI が作る。承認前は施策案だけを見せる
  const note = (text: string) => `<div class="out"><div class="placeholder" style="padding:6px 0">${text}</div></div>`;
  let body: string;
  if (t.status === "candidate" || t.status === "awaiting_approval") body = note(`採用すると、${esc(t.executor_name)}がこの施策の成果物（原稿・計画・仕様書）を作ります。`);
  else if (t.status === "plan_revising") body = note("経営司令塔が施策案を作り直しています…");
  else if (t.status === "producing") body = note(`${esc(t.executor_name)}が成果物を作成しています…`);
  else if (!out) body = note(t.production_error ? `成果物の作成に失敗しました: ${esc(t.production_error)}` : "成果物はまだありません。");
  else
    body = `<div class="out"><div class="eyebrow"><span>${esc(t.executor_name)} の成果物</span>${t.outputs.length > 1 ? `<select data-ver="${t.id}">${t.outputs.map((o) => `<option value="${o.version}"${o.version === out.version ? " selected" : ""}>v${o.version}</option>`).join("")}</select>` : `<span>v${out.version}</span>`}</div>
        ${out.revision_note ? `<p style="font-size:12px;color:var(--muted);margin:0 0 8px">修正指示: ${esc(out.revision_note)}</p>` : ""}
        <div class="md">${renderMarkdown(out.content_md)}</div>
        <div class="out-meta">${esc(out.model ?? "")}${out.input_tokens ? ` · in ${fmtNum(out.input_tokens)} / out ${fmtNum(out.output_tokens)} tokens` : ""} · ${esc(fmtDate(out.created_at, true))}</div></div>`;

  const kpiRows = t.kpis.length
    ? t.kpis.map((k) => `<div class="r"><span>${esc(k.name)}${k.unit ? `（${esc(k.unit)}）` : ""}</span><b>${fmtNum(k.baseline_value)}</b><b>→ ${fmtNum(k.target_value)}${k.actual_value !== null ? ` ／ 実績 ${fmtNum(k.actual_value)}` : ""}</b></div>`).join("")
    : '<div class="r"><span style="color:var(--faint)">KPI 未設定</span><b></b><b></b></div>';
  const canEditKpi = t.status === "awaiting_approval" || t.status === "in_progress" || t.status === "awaiting_verification";
  const kpi = `<div class="kpi"><div class="eyebrow" style="margin-bottom:6px;display:flex;justify-content:space-between">KPI${t.kpis[0]?.confirmed ? "（確定）" : "（AI の提案値）"}${canEditKpi ? `<button type="button" data-kpi-edit="${t.id}" style="text-decoration:underline;text-underline-offset:3px;text-transform:none;letter-spacing:.04em">編集</button>` : ""}</div>${kpiRows}
    ${canEditKpi ? kpiEditor(t) : ""}</div>`;

  let act = "";
  switch (t.status) {
    case "awaiting_approval":
      act = `<div class="act"><button type="button" class="btn primary" data-dec="adopted" data-task="${t.id}">採用</button><button type="button" class="btn" data-dec="revise" data-task="${t.id}">修正</button><button type="button" class="btn danger" data-dec="rejected" data-task="${t.id}">却下</button></div>
        <div class="panel" id="rev-${t.id}"><label class="f">施策案の修正指示（経営司令塔が案を作り直します）<textarea data-revnote="${t.id}" placeholder="例: 期間を 2 週間に短縮したい。LINE ではなく来館時の声かけで。"></textarea></label><div class="r"><button type="button" class="btn sm" data-panel-close="rev-${t.id}">キャンセル</button><button type="button" class="btn sm primary" data-revsend="${t.id}">修正を依頼</button></div></div>
        <div class="panel" id="rej-${t.id}"><label class="f">却下の理由（ナレッジに残ります）<textarea data-rejnote="${t.id}" placeholder="例: 今は人手が足りない。来月再検討。"></textarea></label><div class="r"><button type="button" class="btn sm" data-panel-close="rej-${t.id}">キャンセル</button><button type="button" class="btn sm primary" data-rejsend="${t.id}">却下する</button></div></div>`;
      break;
    case "plan_revising":
      act = `<div class="note-box"><span class="badge">施策案を修正中</span><span>経営司令塔が修正指示を反映した案を作っています…</span></div>`;
      break;
    case "producing":
      act = `<div class="note-box"><span class="badge">採用</span><span>${esc(t.executor_name)}に引き継ぎました。成果物を作成しています…</span></div>`;
      break;
    case "revising":
      act = `<div class="note-box"><span class="badge">修正中</span><span>${esc(t.executor_name)}が成果物の次の版を作成しています…</span></div>`;
      break;
    case "in_progress":
      act = `<div class="note-box"><span class="badge">採用</span><span>${t.production_error ? "成果物の作成に失敗しました。再依頼できます。" : "実行中です。実施が終わったら「実施した」を押してください。"}</span></div>
        <div class="act">${t.production_error ? `<button type="button" class="btn primary" data-retryprod="${t.id}">成果物を再作成</button>` : `<button type="button" class="btn" data-reviseout="${t.id}">成果物を修正</button>`}<button type="button" class="btn" data-implemented="${t.id}">実施した</button></div>
        <div class="panel" id="revout-${t.id}"><label class="f">成果物の修正指示（${esc(t.executor_name)}が作り直します）<textarea data-revoutnote="${t.id}" placeholder="例: 文面をもう少し短く。3 日後の連絡は不要。"></textarea></label><div class="r"><button type="button" class="btn sm" data-panel-close="revout-${t.id}">キャンセル</button><button type="button" class="btn sm primary" data-revoutsend="${t.id}">修正を依頼</button></div></div>`;
      break;
    case "verifying":
      act = `<div class="note-box"><span class="badge">検証中</span><span>KPI 検証担当が施策前・目標・施策後を比較しています…</span></div>`;
      break;
    case "awaiting_verification": {
      const v = t.verification;
      const rec = v?.recommendation ?? "";
      act = `<div class="note-box"><span class="badge">検証待ち</span><span>${v ? "KPI 検証担当の判定を確認し、代表が最終判断してください。" : "施策後の KPI 実績を入力し、KPI 検証担当に判定を依頼してください。"}</span></div>
        <div class="panel" data-open="1" id="ver-${t.id}">
          <div class="eyebrow">KPI 実績（施策前 → 目標 → 施策後）</div>
          ${t.kpis.length ? t.kpis.map((k) => `<div class="r" style="justify-content:space-between;align-items:center;gap:10px"><span style="font-size:13px;color:var(--muted)">${esc(k.name)}${k.unit ? `（${esc(k.unit)}）` : ""}<br><b style="font-family:var(--mono);font-weight:400;color:var(--text)">${fmtNum(k.baseline_value)} → ${fmtNum(k.target_value)}</b></span><input inputmode="decimal" placeholder="施策後" data-actual="${k.id}" value="${k.actual_value ?? ""}" style="width:120px;min-height:40px;text-align:right;font-family:var(--mono)"></div>`).join("") : '<p class="none" style="margin:0;color:var(--faint);font-size:13px">KPI が設定されていません。「編集」で追加できます。</p>'}
          <div class="r"><button type="button" class="btn sm" data-back="${t.id}">実行中に戻す</button><button type="button" class="btn sm${v ? "" : " primary"}" data-verai="${t.id}">${v ? "再判定を依頼" : "KPI 検証担当に判定を依頼"}</button></div>
          ${v ? verificationBlock(v) : ""}
          <div class="eyebrow" style="margin-top:8px">代表の最終判断</div>
          <div class="seg" data-seg="${t.id}"><button type="button" data-verdict="continue" aria-pressed="${rec === "continue"}">続行</button><button type="button" data-verdict="improve" aria-pressed="${rec === "improve"}">改善して再実施</button><button type="button" data-verdict="stop" aria-pressed="${rec === "stop"}">中止</button></div>
          <label class="f">メモ（学びとしてナレッジに残ります）<textarea data-vernote="${t.id}" style="min-height:64px" placeholder="${v ? "空欄なら KPI 検証担当の学びをそのまま記録します" : ""}"></textarea></label>
          <div class="r"><button type="button" class="btn sm primary" data-versend="${t.id}">検証を完了してナレッジに保存</button></div></div>`;
      break;
    }
    case "completed":
      act = `<div class="note-box"><span class="badge">完了 · ${esc(VERDICT_JA[t.kpis[0]?.verdict ?? ""] ?? "")}</span><span>${esc(t.kpis[0]?.verdict_note ?? "ナレッジに記録しました。")}</span></div>${t.verification ? `<div class="panel" data-open="1">${verificationBlock(t.verification)}</div>` : ""}`;
      break;
    case "rejected":
      act = `<div class="note-box"><span class="badge dim">却下</span><span>${esc(t.approvals.filter((a) => a.decision === "rejected").pop()?.note ?? "ナレッジに「却下した案」として保存しました。")}</span></div>`;
      break;
    case "failed":
      act = `<div class="note-box"><span class="badge dim">エラー</span><span>この施策の成果物は作成できませんでした。</span></div>`;
      break;
  }

  return `<div class="task" data-task-card="${t.id}"><div class="tp"><div class="top"><span class="rk">${t.rank}</span>${chip}</div><h3>${esc(t.title)}</h3><p class="ob">目的: ${esc(t.objective)}</p>
    ${t.what_to_do ? `<p class="todo">${esc(t.what_to_do)}</p>` : ""}
    ${leverageBlock(t)}${framesRow(t)}
    <dl class="kv">
      <dt>担当 AI</dt><dd><b><button type="button" data-employee="${esc(t.executor_employee_id)}">${esc(t.executor_name)}</button></b> — ${esc(t.assignment_reason)}</dd>
      <dt>人間側</dt><dd>${esc(t.human_owner ?? "代表")}</dd>
      <dt>期限</dt><dd>${t.duration_days ? `${t.duration_days} 日` : "—"}${t.due_date ? `（${esc(t.due_date)} まで）` : ""}</dd>
      <dt>評価</dt><dd class="score">効果 ${t.impact_score}/5 · 難易度 ${t.difficulty ?? "—"}/5 · コスト ${esc(t.cost_estimate ?? "不明")}</dd>
      <dt>優先理由</dt><dd>${esc(t.reasoning)}</dd>
      ${t.plan_version > 1 ? `<dt>施策案</dt><dd>第 ${t.plan_version} 版${t.plan_change_note ? ` — ${esc(t.plan_change_note)}` : ""}</dd>` : ""}</dl>
    ${t.restricted_actions.length ? `<span class="flag">代表承認が必要: ${t.restricted_actions.map((r) => esc(RESTRICTED_JA[r] ?? r)).join("・")}</span>` : ""}</div>${body}${kpi}${act}</div>`;
}

/**
 * 施策が「人の仕事を増やさず、将来も働き続ける仕組みか」を見せる。
 * A/B/C の分類、初期工数と継続工数、人の仕事の増減、そして憲法に照らした注意。
 */
function leverageBlock(t: TaskFull): string {
  const g = t.leverage;
  if (!g || !g.type) return "";
  const hw = g.human_work_change ?? "same";
  const bar = (n: number | null | undefined) => (n === null || n === undefined ? "—" : `${n}/5`);
  return `<div class="lev" data-type="${esc(g.type)}" data-hw="${esc(hw)}">
    <div class="lev-top">
      <span class="lev-type">${esc(g.type)}</span>
      <span class="lev-type-label">${esc(TASK_TYPE_JA[g.type] ?? "")}</span>
      <span class="lev-hw">${esc(HUMAN_WORK_JA[hw] ?? "")}</span>
      ${g.score !== null && g.score !== undefined ? `<span class="lev-score" title="${esc(g.formula ?? "")}">仕組みスコア ${g.score}</span>` : ""}
    </div>
    ${g.human_work_note ? `<p class="lev-note">${esc(g.human_work_note)}</p>` : ""}
    <dl class="lev-grid">
      <div><dt>初期工数</dt><dd>${g.initial_hours ?? "—"} h</dd></div>
      <div><dt>継続工数</dt><dd>${g.ongoing_hours ?? "—"} h/月</dd></div>
      <div><dt>資産性</dt><dd>${bar(g.asset)}</dd></div>
      <div><dt>自動化</dt><dd>${bar(g.automation)}</dd></div>
      <div><dt>自己解決</dt><dd>${bar(g.self_service)}</dd></div>
      <div><dt>スタッフ依存</dt><dd>${bar(g.staff_dependency)}</dd></div>
      <div><dt>代表依存</dt><dd>${bar(g.owner_dependency)}</dd></div>
    </dl>
    ${g.manual_reason ? `<p class="lev-manual">人手が必要な理由: ${esc(g.manual_reason)}</p>` : ""}
    ${g.type_note ? `<p class="lev-warn">${esc(g.type_note)}</p>` : ""}
    ${g.warning ? `<p class="lev-warn">${esc(g.warning)}</p>` : ""}
  </div>`;
}

/**
 * 経営判断の 3 軸を 1 行で出す。
 *   A  老子 ◎  孫子 ◎  孔子 ○  人的負担 ↓  資産性 高
 * 記号に触れると、なぜその評価になったかが出る。思想名は装飾しない。
 */
function framesRow(t: TaskFull): string {
  const f = t.frames;
  if (!f) return "";
  const g = t.leverage;
  const hw = g.human_work_change ?? "same";
  const burden = hw === "decrease" ? "↓" : hw === "increase" ? "↑" : "→";
  const asset = g.asset === null || g.asset === undefined ? "—" : g.asset >= 4 ? "高" : g.asset >= 3 ? "中" : "低";
  const why = (x: Frame) => {
    const parts: string[] = [`${x.label}軸: ${x.summary}`];
    if (x.met.length) parts.push(`満たしている: ${x.met.join(" / ")}`);
    if (x.missed.length) parts.push(`満たしていない: ${x.missed.join(" / ")}`);
    if (x.cap) parts.push(x.cap);
    return parts.join("\n");
  };
  const cell = (x: Frame) =>
    `<span class="frm-item" data-mark="${esc(x.mark)}" title="${esc(why(x))}"><span class="frm-name">${esc(x.label)}</span><span class="frm-mark">${esc(x.mark)}</span></span>`;
  return `<div class="frm" data-reject="${f.hasReject ? "1" : "0"}">
    ${g.type ? `<span class="frm-type">${esc(g.type)}</span>` : ""}
    ${cell(f.laozi)}${cell(f.sunzi)}${cell(f.confucius)}
    <span class="frm-item" title="この施策で人の仕事が ${esc(HUMAN_WORK_JA[hw] ?? "")}"><span class="frm-name">人的負担</span><span class="frm-mark">${burden}</span></span>
    <span class="frm-item" title="作ったものが残り、後から何度も働くか（資産性 ${g.asset ?? "—"}/5）"><span class="frm-name">資産性</span><span class="frm-mark">${asset}</span></span>
  </div>
  ${f.sunzi_note ? `<p class="frm-note"><span>孫子</span>${esc(f.sunzi_note)}</p>` : ""}
  ${f.confucius_note ? `<p class="frm-note"><span>孔子</span>${esc(f.confucius_note)}</p>` : ""}
  ${f.warning ? `<p class="lev-warn">${esc(f.warning)}</p>` : ""}`;
}

/** KPI 検証担当の判定結果 */
function verificationBlock(v: Verification): string {
  return `<div class="verif">
    <div class="eyebrow">KPI 検証担当の判定 <span class="badge ${v.achievement === "achieved" ? "" : "dim"}">${esc(ACHIEVEMENT_JA[v.achievement] ?? v.achievement)}</span></div>
    <p>${esc(v.achievement_reason)}</p>
    <dl class="kv"><dt>効いた可能性</dt><dd>${esc(v.effect_likelihood)}</dd><dt>他の要因</dt><dd>${esc(v.other_factors)}</dd><dt>推奨</dt><dd><b>${esc(VERDICT_JA[v.recommendation] ?? v.recommendation)}</b> — ${esc(v.recommendation_reason)}</dd><dt>次にやること</dt><dd>${esc(v.next_step)}</dd><dt>学び</dt><dd>${esc(v.lesson)}</dd><dt>次回は</dt><dd>${esc(v.next_time)}</dd></dl>
  </div>`;
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

  setupReport(main, b.project.id);
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
      run(() => api.post(`/api/tasks/${id}/approval`, { decision: "adopted", kpis: editorOpen ? readKpis(id) : undefined }), "採用しました。担当 AI に引き継ぎ、成果物を作成しています。");
    }),
  );
  q<HTMLElement>("[data-revsend]").forEach((el) => el.addEventListener("click", () => {
    const note = val(`[data-revnote="${el.dataset.revsend}"]`).trim();
    if (!note) return toast("修正指示を入力してください。");
    run(() => api.post(`/api/tasks/${el.dataset.revsend}/approval`, { decision: "revise", note }), "修正を依頼しました。経営司令塔が施策案を作り直します。");
  }));
  q<HTMLElement>("[data-rejsend]").forEach((el) => el.addEventListener("click", () => run(() => api.post(`/api/tasks/${el.dataset.rejsend}/approval`, { decision: "rejected", note: val(`[data-rejnote="${el.dataset.rejsend}"]`) }), "却下しました。ナレッジに保存しました。")));
  q<HTMLElement>("[data-implemented]").forEach((el) => el.addEventListener("click", () => run(() => api.post(`/api/tasks/${el.dataset.implemented}/status`, { status: "awaiting_verification" }), "「検証待ち」にしました。期日に KPI を入力してください。")));
  q<HTMLElement>("[data-back]").forEach((el) => el.addEventListener("click", () => run(() => api.post(`/api/tasks/${el.dataset.back}/status`, { status: "in_progress" }))));
  q<HTMLElement>("[data-seg] button").forEach((btn) => btn.addEventListener("click", () => { btn.parentElement!.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === btn))); }));
  q<HTMLElement>("[data-reviseout]").forEach((el) => el.addEventListener("click", () => { const p = main.querySelector<HTMLElement>(`#revout-${el.dataset.reviseout}`)!; p.dataset.open = "1"; p.querySelector("textarea")?.focus(); }));
  q<HTMLElement>("[data-revoutsend]").forEach((el) => el.addEventListener("click", () => {
    const n = val(`[data-revoutnote="${el.dataset.revoutsend}"]`).trim();
    if (!n) return toast("修正指示を入力してください。");
    run(() => api.post(`/api/tasks/${el.dataset.revoutsend}/revise-output`, { note: n }), "成果物の修正を依頼しました。");
  }));
  q<HTMLElement>("[data-retryprod]").forEach((el) => el.addEventListener("click", () => run(() => api.post(`/api/tasks/${el.dataset.retryprod}/retry-production`), "成果物の作成を再依頼しました。")));
  q<HTMLElement>("[data-verai]").forEach((el) => el.addEventListener("click", () => {
    const id = el.dataset.verai!;
    const kpis = [...q<HTMLInputElement>(`#ver-${id} [data-actual]`)].map((i) => ({ id: i.dataset.actual!, actual_value: num(i.value) }));
    if (!kpis.some((k) => k.actual_value !== null)) return toast("施策後の KPI 実績を 1 つ以上入力してください。");
    run(() => api.post(`/api/tasks/${id}/verify-ai`, { kpis }), "KPI 検証担当に判定を依頼しました。結果はこの画面に表示されます。");
  }));
  q<HTMLElement>("[data-versend]").forEach((el) => el.addEventListener("click", () => {
    const id = el.dataset.versend!;
    const verdict = main.querySelector<HTMLElement>(`[data-seg="${id}"] button[aria-pressed="true"]`)?.dataset.verdict;
    if (!verdict) return toast("続行 / 改善 / 中止 のどれかを選んでください。");
    const kpis = [...q<HTMLInputElement>(`#ver-${id} [data-actual]`)].map((i) => ({ id: i.dataset.actual!, actual_value: num(i.value) }));
    run(() => api.post(`/api/tasks/${id}/verify`, { verdict, note: val(`[data-vernote="${id}"]`), kpis }), `検証を完了しました（${VERDICT_JA[verdict]}）。ナレッジに保存しました。`);
  }));
  void TASK_STATUS_JA;
}
