import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "../env";
import { Repo, type ProjectRow, type TaskRow } from "../db/repo";
import { AiProviderError, getProvider, isAiDisabled, type AiProvider } from "../ai/provider";
import { AnalysisSchema, SelectAnalystsSchema, SynthesisSchema, TaskRevisionSchema, VerificationSchema } from "../ai/schemas";
import { ANALYST_IDS, COMPANY_CONTEXT, EMPLOYEE_MAP, EXECUTOR_IDS, employeeName } from "../employees/roster";
import { COMMANDER_PROMPTS } from "../employees/prompts-command";
import { detectRestrictedActions } from "../policy/restricted-actions";
import { METRIC_GROUPS, SOURCE_LABEL, metricLabel, normalizeInputData, type NormalizedInput } from "../metrics";
import { computeDerived, totalBookings, type DerivedKpi } from "../analysis/derived";
import type { ComparisonResult } from "../analysis/compare";
import { FUNNEL_STATUS_JA, type FunnelResult } from "../analysis/funnel";
import { checkNumbers } from "../analysis/verify-numbers";

/**
 * AI 社員に仕事をさせる関数のまとめ。Workflow の各ステップから呼ばれる。
 * すべて「すでに保存済みなら何もしない」ように作ってあり、再実行しても二重登録しない。
 */

const MAX_ANALYSTS = 4;

function system(employeeId: string, override?: string): string {
  const def = EMPLOYEE_MAP[employeeId];
  if (!def) throw new NonRetryableError(`AI 社員が見つかりません: ${employeeId}`);
  return `${COMPANY_CONTEXT}\n\n${override ?? def.systemPrompt}`;
}

/**
 * 案件の入力を AI に渡す文章にする。
 * ブロックごとに整理し、自動計算した KPI・前月比・ファネル判定を添える。
 * 未入力は「データなし」と明示し、集計方法が違う数字は出どころを書く。
 */
export function formatInput(project: ProjectRow): string {
  const lines: string[] = [];
  lines.push(`案件名: ${project.title}`);
  if (project.period_label) lines.push(`対象期間: ${project.period_label}`);

  const input: NormalizedInput = normalizeInputData(project.input_data_json ? JSON.parse(project.input_data_json) : null);
  const v = input.values;
  const derivedSaved = project.derived_json ? (JSON.parse(project.derived_json) as { kpis: DerivedKpi[]; comparison: ComparisonResult }) : null;
  const kpis = derivedSaved?.kpis ?? computeDerived(input);
  const comparison = derivedSaved?.comparison ?? null;
  const funnel = project.funnel_json ? (JSON.parse(project.funnel_json) as FunnelResult) : null;

  // ---- 入力された数字（ブロックごと）----
  if (Object.keys(v).length > 0) {
    lines.push("", "【入力された数字】");
    for (const group of METRIC_GROUPS) {
      const rows = group.metrics.filter((m) => v[m.id] !== undefined);
      if (rows.length === 0) continue;
      lines.push(`● ${group.label}（出どころ: ${SOURCE_LABEL[group.source]}）`);
      for (const m of rows) lines.push(`  - ${m.label}（${m.unit}）: ${v[m.id].toLocaleString("ja-JP")}`);
    }
    // 定義に無い項目（以前のデータなど）
    const known = new Set(METRIC_GROUPS.flatMap((g) => g.metrics.map((m) => m.id)));
    const others = Object.keys(v).filter((id) => !known.has(id));
    if (others.length > 0) {
      lines.push("● その他");
      for (const id of others) lines.push(`  - ${metricLabel(id)}: ${v[id].toLocaleString("ja-JP")}`);
    }
    const bookings = totalBookings(v);
    if (bookings !== undefined) lines.push(`● 見学・体験予約数の合計: ${bookings.toLocaleString("ja-JP")} 件（実来館数とは別の数字）`);
  }

  // ---- 検索キーワード ----
  if (input.keywords.length > 0) {
    lines.push("", "【重要検索キーワード（Google Search Console）】");
    for (const k of input.keywords) {
      const parts = [
        k.impressions !== null ? `表示 ${k.impressions.toLocaleString("ja-JP")}` : "表示 データなし",
        k.clicks !== null ? `クリック ${k.clicks.toLocaleString("ja-JP")}` : "クリック データなし",
        k.ctr !== null ? `CTR ${k.ctr}%` : "CTR データなし",
        k.position !== null ? `平均掲載順位 ${k.position}` : "順位 データなし",
      ];
      lines.push(`- ${k.keyword}: ${parts.join(" / ")}`);
    }
  }

  // ---- 自動計算した KPI ----
  const calculated = kpis.filter((k) => k.value !== null);
  const uncalculated = kpis.filter((k) => k.value === null);
  if (calculated.length > 0) {
    lines.push("", "【自動計算した KPI（システムが計算した値。この数字を使うこと）】");
    for (const k of calculated) lines.push(`- ${k.label}: ${k.value}${k.unit}（計算式: ${k.formula}）`);
  }
  if (uncalculated.length > 0) {
    lines.push("", "【計算できなかった KPI（データ不足。推測で数字を作らないこと）】");
    for (const k of uncalculated) lines.push(`- ${k.label}: 計算できません（${k.missing ?? "必要な数字が未入力"}）`);
  }

  // ---- 前月比較 ----
  if (comparison && comparison.previousPeriod) {
    const changed = comparison.rows.filter((r) => r.delta !== null);
    if (changed.length > 0) {
      lines.push("", `【前月比較（前月: ${comparison.previousPeriod}）】`);
      for (const r of changed) {
        const sign = r.delta! > 0 ? "+" : "";
        const pctText = r.deltaPct !== null ? `（${sign}${r.deltaPct}%）` : "";
        const avgText = r.avg3 !== null ? ` / 過去3か月平均 ${r.avg3}` : "";
        lines.push(`- ${r.label}: ${r.current}${r.unit} ← 前月 ${r.previous}${r.unit} / 増減 ${sign}${r.delta}${pctText}${avgText}`);
      }
    }
  } else if (comparison) {
    lines.push("", "【前月比較】前月のデータが無いため比較できません。単月の数字だけで判断すること。");
  }

  // ---- ファネル判定 ----
  if (funnel) {
    lines.push("", "【集客ファネルの判定（システムが数字から機械的に判定）】");
    for (const st of funnel.stages) lines.push(`- ${st.label}: ${FUNNEL_STATUS_JA[st.status]} — ${st.reason}`);
    if (funnel.weakest) {
      const w = funnel.stages.find((s) => s.id === funnel.weakest);
      lines.push(`→ 最も詰まっている可能性が高い段階: ${w?.label ?? funnel.weakest}`);
    }
    if (funnel.noDataCount > 0) lines.push(`→ データ不足の段階が ${funnel.noDataCount} 個あります。判断できない段階は「データなし」と書くこと。`);
  }

  // ---- 自由記述 ----
  if (Object.keys(input.notes).length > 0) {
    lines.push("", "【ヒートマップ・行動観察で分かったこと（人が書いた所見）】");
    for (const [, text] of Object.entries(input.notes)) lines.push(text);
  }

  if (project.input_text) lines.push("", "【相談内容】", project.input_text);
  if (project.extra_text) lines.push("", "【追加データ（貼り付け）】", project.extra_text);

  lines.push(
    "",
    "【数字の扱いについての注意】",
    "- 入力されていない数字は「データなし」とすること。推測して数字を作らない。",
    "- Search Console のクリック数、GA4 のユーザー数、Google ビジネスプロフィールの Web クリック数は集計方法が違う。同じ数字として扱わない。",
    "- 上の「自動計算した KPI」以外の率を自分で計算しない。必要なら不足データとして挙げること。",
  );
  return lines.join("\n");
}

async function knowledgeContext(repo: Repo, query: string): Promise<string> {
  const rows = await repo.listKnowledge({ limit: 60 });
  if (rows.length === 0) return "【過去のナレッジ】まだありません。";
  const kindJa: Record<string, string> = { success: "成功", failure: "失敗", idea: "却下・案", analysis: "分析", learning: "学び" };
  const words = [...new Set((query.match(/[一-龥ァ-ヶーa-zA-Z]{2,}/g) ?? []).map((w) => w.toLowerCase()))];
  const score = (k: { title: string; tags_json: string; body_md: string }) => {
    const hay = `${k.title} ${k.tags_json} ${k.body_md}`.toLowerCase();
    return words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
  };
  const sorted = [...rows].sort((a, b) => score(b) - score(a));
  const detailed = sorted.slice(0, 5);
  const rest = sorted.slice(5, 30);
  const fmt = (v: unknown) => (v === null || v === undefined ? "不明" : String(v));
  const lines = detailed.map((k) => {
    const d = k.data_json ? (JSON.parse(k.data_json) as Record<string, any>) : null;
    if (!d) return `- [${kindJa[k.kind] ?? k.kind}] ${k.title}（${k.created_at.slice(0, 10)}）`;
    const kpi = Array.isArray(d.kpis) ? d.kpis.map((x: any) => `${x.name}: ${fmt(x.baseline_value)} → 目標 ${fmt(x.target_value)} → 実績 ${fmt(x.actual_value)}`).join(" / ") : "";
    return [
      `- [${kindJa[k.kind] ?? k.kind}] ${k.title}（${k.created_at.slice(0, 10)}）`,
      `    当時の課題: ${fmt(d.issue)}`,
      d.action?.title ? `    実施した施策: ${d.action.title}` : "",
      kpi ? `    KPI: ${kpi}` : "",
      d.result ? `    結果: ${d.result}${d.achievement ? `（${d.achievement}）` : ""}` : "",
      d.lesson ? `    学び: ${d.lesson}` : "",
      d.next_time ? `    次回は: ${d.next_time}` : "",
    ].filter(Boolean).join("\n");
  });
  return [
    "【過去のナレッジ（今回の相談に近い順）】",
    ...lines,
    ...(rest.length ? ["【その他の記録（題名のみ）】", ...rest.map((k) => `- [${kindJa[k.kind] ?? k.kind}] ${k.title}（${k.created_at.slice(0, 10)}）`)] : []),
    "同じ失敗や同じ案を繰り返さないこと。似た施策を提案する場合は、前回との違いを必ず書くこと。",
  ].join("\n");
}

/** 再試行してよい失敗かを Workflow に伝える */
export function asWorkflowError(err: unknown): Error {
  if (err instanceof AiProviderError && !err.retryable) return new NonRetryableError(err.message);
  return err instanceof Error ? err : new Error(String(err));
}

/** AI プロバイダを取得する。設定漏れ（API キー未登録など）は再試行せず即失敗にする */
function provider(env: Env): AiProvider {
  try {
    return getProvider(env);
  } catch (err) {
    throw asWorkflowError(err);
  }
}

// ---------- Step 1: 分析担当を選ぶ ----------
export async function selectAnalysts(env: Env, projectId: string): Promise<string[]> {
  const repo = new Repo(env.DB);
  const project = await repo.getProject(projectId);
  if (!project) throw new NonRetryableError("案件が見つかりません。");
  if (project.selected_analysts_json) return JSON.parse(project.selected_analysts_json);

  let selected: string[];
  let reason: string;
  if (project.analyst_mode === "all") {
    selected = [...ANALYST_IDS];
    reason = "代表の指定により全員が分析します。";
  } else {
    const ai = provider(env);
    const roster = ANALYST_IDS.map((id) => `- ${id}: ${EMPLOYEE_MAP[id].name}`).join("\n");
    try {
      const { data } = await ai.generateJSON({
        system: system("commander", COMMANDER_PROMPTS.select),
        user: `分析部の一覧:\n${roster}\n\n今回の入力:\n${formatInput(project)}\n\n相談を分類し、招集する担当（2〜4 名）の id を analysts に入れてください。`,
        schema: SelectAnalystsSchema,
        maxTokens: 1500,
      });
      selected = [...new Set(data.analysts.filter((id) => ANALYST_IDS.includes(id)))].slice(0, MAX_ANALYSTS);
      reason = `分類: ${data.category}。${data.reason}`;
    } catch (err) {
      throw asWorkflowError(err);
    }
    if (selected.length === 0) {
      selected = ["data", "sales", "customer"];
      reason = "自動選択の結果が空だったため、基本の 3 名を割り当てました。";
    }
  }
  await repo.updateProject(projectId, { selected_analysts_json: JSON.stringify(selected), selection_reason: reason });
  for (const id of selected) await repo.markAnalysisRunning(projectId, id);
  return selected;
}

// ---------- Step 2: 分析担当 1 人が分析する ----------
export async function runAnalyst(env: Env, projectId: string, employeeId: string): Promise<string> {
  const repo = new Repo(env.DB);
  const existing = await repo.getAnalysis(projectId, employeeId);
  if (existing?.status === "done") return employeeId;
  const project = await repo.getProject(projectId);
  if (!project) throw new NonRetryableError("案件が見つかりません。");
  await repo.markAnalysisRunning(projectId, employeeId);

  const ai = provider(env);
  try {
    const { data, usage } = await ai.generateJSON({
      system: system(employeeId),
      user: `${formatInput(project)}\n\n${await knowledgeContext(repo, `${project.input_text} ${project.title}`)}\n\nあなたの担当分野の観点で分析してください。`,
      schema: AnalysisSchema,
    });
    // AI が挙げた数字が入力値か計算済み KPI に実在するかを確かめる
    const input = normalizeInputData(project.input_data_json ? JSON.parse(project.input_data_json) : null);
    const kpis = project.derived_json ? (JSON.parse(project.derived_json) as { kpis: DerivedKpi[] }).kpis : computeDerived(input);
    const check = checkNumbers([data.conclusion, ...data.facts, ...data.evidence.map((e) => `${e.value} ${e.source}`)], input, kpis);

    await repo.completeAnalysis(projectId, employeeId, {
      conclusion: data.conclusion,
      facts: data.facts,
      hypotheses: data.hypotheses.slice(0, 3),
      evidence: data.evidence,
      missing_data: data.missing_data,
      actions: data.actions.slice(0, 3),
      unverified_numbers: check.unverified,
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
    });
  } catch (err) {
    const e = asWorkflowError(err);
    if (e instanceof NonRetryableError) await repo.failAnalysis(projectId, employeeId, e.message);
    throw e;
  }
  return employeeId;
}

/** 分析担当 1 人の結果を、司令塔に渡す文章にする */
export function formatAnalysis(a: { employee_id: string; headline: string | null; facts_json: string | null; hypotheses_json: string | null; evidence_json: string | null; needed_data_json: string | null; actions_json: string | null }): string {
  const list = (s: string | null) => (JSON.parse(s ?? "[]") as string[]).map((x) => `  - ${x}`).join("\n") || "  - なし";
  const hyps = (JSON.parse(a.hypotheses_json ?? "[]") as Array<string | { hypothesis: string; rationale: string }>)
    .map((h) => (typeof h === "string" ? `  - ${h}` : `  - ${h.hypothesis}（根拠: ${h.rationale}）`))
    .join("\n") || "  - なし";
  const evidence = (JSON.parse(a.evidence_json ?? "[]") as Array<{ label: string; value: string; source: string }>).map((e) => `  - ${e.label}: ${e.value}（${e.source}）`).join("\n") || "  - なし";
  return `■ ${employeeName(a.employee_id)}\n【結論】${a.headline}\n【確認できる事実】\n${list(a.facts_json)}\n【仮説と根拠】\n${hyps}\n【根拠となった数字】\n${evidence}\n【不足データ】\n${list(a.needed_data_json)}\n【推奨アクション】\n${list(a.actions_json)}`;
}

// ---------- Step 3: 司令塔が統合し、最優先施策を決める ----------
export async function synthesize(env: Env, projectId: string): Promise<string[]> {
  const repo = new Repo(env.DB);
  const project = await repo.getProject(projectId);
  if (!project) throw new NonRetryableError("案件が見つかりません。");
  // すでに判断済みなら（再実行時）、保存済みの施策をそのまま返す
  if (await repo.getLatestDecision(projectId)) return (await repo.listTasks(projectId)).map((t) => t.id);

  const analyses = (await repo.listAnalyses(projectId)).filter((a) => a.status === "done");
  if (analyses.length === 0) throw new NonRetryableError("分析結果がひとつも得られませんでした。");
  const report = analyses.map((a) => formatAnalysis(a)).join("\n\n");
  const executors = EXECUTOR_IDS.map((id) => `- ${id}: ${EMPLOYEE_MAP[id].name}`).join("\n");

  const ai = provider(env);
  let result;
  try {
    result = await ai.generateJSON({
      system: system("commander"),
      user: `${formatInput(project)}\n\n【分析部の結果】\n${report}\n\n${await knowledgeContext(repo, `${project.input_text} ${project.title} ${analyses.map((a) => a.headline).join(" ")}`)}\n\n【施策の担当に選べる実行 AI】\n${executors}\n\n統合判断をしてください。tasks は最大 3 つ、executor_employee_id は上の id から選んでください。`,
      schema: SynthesisSchema,
    });
  } catch (err) {
    throw asWorkflowError(err);
  }
  const { data, usage } = result;

  const decision = await repo.createDecision(projectId, {
    top_issue: data.top_issue,
    reasoning: data.reasoning,
    evidence: data.evidence,
    needed_data: data.needed_data,
    not_now: data.not_now,
    model: usage.model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  });
  const ids: string[] = [];
  const proposals = [...data.tasks].sort((a, b) => a.rank - b.rank).slice(0, 3);
  for (const [i, p] of proposals.entries()) {
    const executor = EXECUTOR_IDS.includes(p.executor_employee_id) ? p.executor_employee_id : "planner";
    const task = await repo.createTask({
      project_id: projectId,
      decision_id: decision.id,
      rank: i + 1,
      title: p.title,
      objective: p.objective,
      reasoning: p.priority_reason,
      impact_score: clamp(Math.round(p.impact_score), 1, 5),
      effort_hours: Math.max(0.5, Number(p.effort_hours) || 1),
      executor_employee_id: executor,
      assignment_reason: p.assignment_reason,
      restricted_actions: detectRestrictedActions(`${p.title}\n${p.objective}\n${p.what_to_do}\n${p.priority_reason}`, p.restricted_actions),
      due_date: dueDate(p.duration_days),
      what_to_do: p.what_to_do,
      human_owner: p.human_owner,
      duration_days: clamp(Math.round(p.duration_days), 1, 365),
      difficulty: clamp(Math.round(p.difficulty), 1, 5),
      cost_estimate: p.cost_estimate,
    });
    if (p.kpis.length) await repo.replaceKpis(task.id, p.kpis.slice(0, 3), false);
    ids.push(task.id);
  }
  // 施策案がそろった時点で代表の承認待ちにする。成果物は「採用」後に実行担当が作る
  for (const id of ids) await repo.updateTask(id, { status: "awaiting_approval" });
  await repo.updateProject(projectId, { status: "awaiting_approval" });
  return ids;
}

// ---------- Step 4: 実行担当が成果物を作る（修正依頼にも使う） ----------
export async function produceOutput(env: Env, taskId: string, revisionNote: string | null): Promise<string> {
  const repo = new Repo(env.DB);
  const task = await repo.getTask(taskId);
  if (!task) throw new NonRetryableError("施策が見つかりません。");
  const previous = await repo.latestOutput(taskId);
  // 初回作成で既に成果物があれば飛ばす（再実行時）。修正依頼は、同じ指示の版がまだ無いときだけ作る
  if (!revisionNote && previous && task.status !== "producing") return previous.id;
  if (!revisionNote && previous && task.status === "producing") {
    await repo.updateTask(taskId, { status: "in_progress", production_error: null });
    return previous.id;
  }
  if (revisionNote && previous?.revision_note === revisionNote && task.status !== "revising") return previous.id;
  if (!revisionNote && task.status !== "producing" && task.status !== "in_progress") {
    throw new NonRetryableError("採用されていない施策の成果物は作りません。");
  }

  const project = await repo.getProject(task.project_id);
  const decision = await repo.getLatestDecision(task.project_id);
  const kpis = await repo.listKpis(taskId);
  const def = EMPLOYEE_MAP[task.executor_employee_id];
  const kpiText = kpis.map((k) => `- ${k.name}${k.unit ? `（${k.unit}）` : ""}: 現状 ${k.baseline_value ?? "不明"} → 目標 ${k.target_value ?? "未設定"}`).join("\n") || "- （未設定）";

  const parts = [
    project ? formatInput(project) : "",
    decision ? `【経営司令塔の判断】\n最重要課題: ${decision.top_issue ?? decision.summary_md}\n理由: ${decision.reasoning_md ?? ""}` : "",
    `【あなたが担当する施策（優先順位 ${task.rank}）】\n題名: ${task.title}\n目的: ${task.objective}\n具体的に何をするか: ${task.what_to_do ?? "（未記載）"}\n人間側の担当: ${task.human_owner ?? "代表"}\n期限: ${task.duration_days ?? "未定"} 日\nなぜ今これか: ${task.reasoning}\n担当理由: ${task.assignment_reason}\nKPI:\n${kpiText}`,
  ];
  if (revisionNote && previous) {
    parts.push(`【前回の成果物（v${previous.version}）】\n${previous.content_md}`, `【代表からの修正指示】\n${revisionNote}\n\n修正指示を反映した新しい版を、全文書き直して出してください。`);
  } else {
    parts.push("この施策の成果物を作ってください。");
  }

  const ai = provider(env);
  try {
    const { text, usage } = await ai.generateText({ system: system(task.executor_employee_id), user: parts.filter(Boolean).join("\n\n") });
    const out = await repo.createOutput({
      task_id: taskId,
      employee_id: task.executor_employee_id,
      kind: def?.outputKind ?? "plan",
      title: task.title,
      content_md: text,
      revision_note: revisionNote,
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
    });
    // 採用済みの施策なので、成果物ができたら「実行中」にする
    await repo.updateTask(taskId, { status: "in_progress", production_error: null });
    return out.id;
  } catch (err) {
    const e = asWorkflowError(err);
    if (e instanceof NonRetryableError) await repo.updateTask(taskId, { status: "in_progress", production_error: e.message.slice(0, 500) });
    throw e;
  }
}

// ---------- 代表の修正指示を受けて、司令塔が施策案を作り直す ----------
export async function revisePlan(env: Env, taskId: string, note: string): Promise<string> {
  const repo = new Repo(env.DB);
  const task = await repo.getTask(taskId);
  if (!task) throw new NonRetryableError("施策が見つかりません。");
  if (task.status !== "plan_revising") return taskId; // すでに作り直し済み（再実行時）

  const [project, decision, kpis, siblings] = await Promise.all([
    repo.getProject(task.project_id),
    repo.getLatestDecision(task.project_id),
    repo.listKpis(taskId),
    repo.listTasks(task.project_id),
  ]);
  const others = siblings.filter((t) => t.id !== taskId).map((t) => `- 優先順位 ${t.rank}: ${t.title}`).join("\n") || "（他の施策なし）";
  const kpiText = kpis.map((k) => `- ${k.name}${k.unit ? `（${k.unit}）` : ""}: 現状 ${k.baseline_value ?? "不明"} → 目標 ${k.target_value ?? "未設定"}`).join("\n") || "- （未設定）";
  const executors = EXECUTOR_IDS.map((id) => `- ${id}: ${EMPLOYEE_MAP[id].name}`).join("\n");

  const user = [
    project ? formatInput(project) : "",
    decision ? `【あなたが出した最重要課題】${decision.top_issue ?? decision.summary_md}` : "",
    `【作り直す施策（現在の案・第 ${task.plan_version} 版）】\n題名: ${task.title}\n目的: ${task.objective}\n具体的に何をするか: ${task.what_to_do ?? "（未記載）"}\n担当 AI: ${employeeName(task.executor_employee_id)}\n人間側の担当: ${task.human_owner ?? "代表"}\n期限: ${task.duration_days ?? "未定"} 日 / 必要時間: ${task.effort_hours} h / 難易度: ${task.difficulty ?? "不明"} / コスト: ${task.cost_estimate ?? "不明"}\n優先理由: ${task.reasoning}\nKPI:\n${kpiText}`,
    `【同じ案件の他の施策（重複しないように）】\n${others}`,
    `【代表からの修正指示】\n${note}`,
    `【施策の担当に選べる実行 AI】\n${executors}`,
    "修正指示を反映した新しい施策案を 1 件だけ作ってください。rank は変えないでください。change_note に前の案から何を変えたかを書いてください。",
  ].filter(Boolean).join("\n\n");

  const ai = provider(env);
  try {
    const { data } = await ai.generateJSON({ system: system("commander"), user, schema: TaskRevisionSchema, maxTokens: 4000 });
    const p = data.task;
    const executor = EXECUTOR_IDS.includes(p.executor_employee_id) ? p.executor_employee_id : task.executor_employee_id;
    await repo.updateTask(taskId, {
      title: p.title,
      objective: p.objective,
      reasoning: p.priority_reason,
      what_to_do: p.what_to_do,
      human_owner: p.human_owner,
      duration_days: clamp(Math.round(p.duration_days), 1, 365),
      effort_hours: Math.max(0.5, Number(p.effort_hours) || 1),
      impact_score: clamp(Math.round(p.impact_score), 1, 5),
      difficulty: clamp(Math.round(p.difficulty), 1, 5),
      cost_estimate: p.cost_estimate,
      executor_employee_id: executor,
      assignment_reason: p.assignment_reason,
      restricted_actions_json: JSON.stringify(detectRestrictedActions(`${p.title}\n${p.objective}\n${p.what_to_do}\n${p.priority_reason}`, p.restricted_actions)),
      due_date: dueDate(p.duration_days),
      plan_version: task.plan_version + 1,
      plan_change_note: data.change_note,
      status: "awaiting_approval",
    });
    if (p.kpis.length) await repo.replaceKpis(taskId, p.kpis.slice(0, 3), false);
    await repo.recomputeProjectStatus(task.project_id);
    return taskId;
  } catch (err) {
    throw asWorkflowError(err);
  }
}

// ---------- Phase 2: KPI 検証担当が施策前・目標・施策後を比べて判定する ----------
export async function verifyTask(env: Env, taskId: string): Promise<string> {
  const repo = new Repo(env.DB);
  const task = await repo.getTask(taskId);
  if (!task) throw new NonRetryableError("施策が見つかりません。");
  if (task.status !== "verifying") {
    // すでに判定済み（再実行時）
    const existing = await repo.latestVerification(taskId);
    if (existing) return existing.id;
  }
  const [project, decision, kpis, output] = await Promise.all([repo.getProject(task.project_id), repo.getLatestDecision(task.project_id), repo.listKpis(taskId), repo.latestOutput(taskId)]);
  const fmt = (v: number | null) => (v === null ? "不明" : String(v));
  const kpiLines = kpis.map((k) => `- ${k.name}${k.unit ? `（${k.unit}）` : ""}: 施策前 ${fmt(k.baseline_value)} / 目標 ${fmt(k.target_value)} / 施策後 ${fmt(k.actual_value)}${k.measure_by ? ` / 計測期日 ${k.measure_by}` : ""}`).join("\n") || "- KPI が設定されていません";
  const user = [
    project ? `【当時の入力】\n${formatInput(project)}` : "",
    decision ? `【当時の最重要課題】${decision.top_issue ?? decision.summary_md}` : "",
    `【実施した施策】\n題名: ${task.title}\n目的: ${task.objective}\n具体的に何をしたか: ${task.what_to_do ?? "（未記載）"}\n期間: ${task.duration_days ?? "不明"} 日\n担当: ${employeeName(task.executor_employee_id)} / ${task.human_owner ?? "代表"}\nコスト: ${task.cost_estimate ?? "不明"}`,
    output ? `【成果物（抜粋）】\n${output.content_md.slice(0, 1500)}` : "",
    `【KPI】\n${kpiLines}`,
    "施策前・目標・施策後を比較して判定してください。",
  ].filter(Boolean).join("\n\n");

  const ai = provider(env);
  try {
    const { data, usage } = await ai.generateJSON({ system: system("kpi"), user, schema: VerificationSchema, maxTokens: 3000 });
    const row = await repo.createVerification({
      task_id: taskId,
      ...data,
      kpis_snapshot: kpis.map((k) => ({ name: k.name, unit: k.unit, baseline_value: k.baseline_value, target_value: k.target_value, actual_value: k.actual_value })),
      model: usage.model,
      input_tokens: usage.inputTokens,
      output_tokens: usage.outputTokens,
    });
    await repo.updateTask(taskId, { status: "awaiting_verification" });
    return row.id;
  } catch (err) {
    throw asWorkflowError(err);
  }
}

/**
 * 外部 AI を使わない設定のときの仕上げ。
 * 入力・KPI・ファネル判定はすでに保存済みなので、案件を「レポート作成待ち」にする。
 */
export async function finalizeWithoutAi(env: Env, projectId: string): Promise<string> {
  const repo = new Repo(env.DB);
  await repo.updateProject(projectId, {
    status: "ready_for_report",
    selection_reason: "外部 AI を使わない設定のため、AI 社員は動いていません。ChatGPT 用レポートを作成して分析してください。",
    error: null,
  });
  return "ready_for_report";
}

export async function finalizeProject(env: Env, projectId: string): Promise<string> {
  const repo = new Repo(env.DB);
  const tasks = await repo.listTasks(projectId);
  for (const t of tasks) if (t.status === "candidate") await repo.updateTask(t.id, { status: "failed" });
  const project = await repo.getProject(projectId);
  if (project?.status === "analyzing" || project?.status === "candidates") await repo.updateProject(projectId, { status: "awaiting_approval" });
  return repo.recomputeProjectStatus(projectId);
}

export async function markProjectFailed(env: Env, projectId: string, message: string): Promise<void> {
  const repo = new Repo(env.DB);
  await repo.updateProject(projectId, { status: "failed", error: message.replace(/^NonRetryableError:\s*/, "").slice(0, 1000) });
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const dueDate = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + clamp(Math.round(days), 1, 365));
  return d.toISOString().slice(0, 10);
};
