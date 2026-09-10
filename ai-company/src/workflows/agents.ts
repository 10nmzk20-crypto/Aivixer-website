import { NonRetryableError } from "cloudflare:workflows";
import type { Env } from "../env";
import { Repo, type ProjectRow, type TaskRow } from "../db/repo";
import { AiProviderError, getProvider, type AiProvider } from "../ai/provider";
import { AnalysisSchema, SelectAnalystsSchema, SynthesisSchema } from "../ai/schemas";
import { ANALYST_IDS, COMPANY_CONTEXT, EMPLOYEE_MAP, EXECUTOR_IDS, employeeName } from "../employees/roster";
import { COMMANDER_PROMPTS } from "../employees/prompts-command";
import { detectRestrictedActions } from "../policy/restricted-actions";

/**
 * AI 社員に仕事をさせる関数のまとめ。Workflow の各ステップから呼ばれる。
 * すべて「すでに保存済みなら何もしない」ように作ってあり、再実行しても二重登録しない。
 */

/** 入力画面の数値項目（id と表示名） */
export const METRICS: Array<{ id: string; label: string; unit: string }> = [
  { id: "sales", label: "売上", unit: "円" },
  { id: "members", label: "会員数（月末）", unit: "名" },
  { id: "new_members", label: "新規入会", unit: "名" },
  { id: "churn", label: "退会", unit: "名" },
  { id: "inquiries", label: "問い合わせ", unit: "件" },
  { id: "visits", label: "見学・体験", unit: "件" },
  { id: "trials", label: "30日お試し 開始", unit: "名" },
  { id: "conversions", label: "本入会（お試し経由）", unit: "名" },
  { id: "personal_users", label: "パーソナル利用者", unit: "名" },
  { id: "avg_visits", label: "平均来館回数（月）", unit: "回" },
  { id: "reviews", label: "Google 口コミ数", unit: "件" },
  { id: "web_bookings", label: "HP からの見学予約", unit: "件" },
];
const METRIC_LABEL = Object.fromEntries(METRICS.map((m) => [m.id, `${m.label}（${m.unit}）`]));

/** 自動招集の上限。全員を動かさない（司令塔が 2〜4 名を選ぶ） */
const MAX_ANALYSTS = 4;

function system(employeeId: string, override?: string): string {
  const def = EMPLOYEE_MAP[employeeId];
  if (!def) throw new NonRetryableError(`AI 社員が見つかりません: ${employeeId}`);
  return `${COMPANY_CONTEXT}\n\n${override ?? def.systemPrompt}`;
}

export function formatInput(project: ProjectRow): string {
  const lines: string[] = [];
  lines.push(`案件名: ${project.title}`);
  if (project.period_label) lines.push(`対象期間: ${project.period_label}`);
  if (project.input_data_json) {
    const data = JSON.parse(project.input_data_json) as Record<string, string | number>;
    lines.push("", "【入力された数字】");
    for (const [k, v] of Object.entries(data)) lines.push(`- ${METRIC_LABEL[k] ?? k}: ${typeof v === "number" ? v.toLocaleString("ja-JP") : v}`);
  }
  if (project.input_text) lines.push("", "【相談内容】", project.input_text);
  if (project.extra_text) lines.push("", "【追加データ（貼り付け）】", project.extra_text);
  return lines.join("\n");
}

async function knowledgeContext(repo: Repo): Promise<string> {
  const rows = await repo.listKnowledge({ limit: 30 });
  if (rows.length === 0) return "【過去のナレッジ】まだありません。";
  const kindJa: Record<string, string> = { success: "成功", failure: "失敗", idea: "却下・案", analysis: "分析", learning: "学び" };
  return ["【過去のナレッジ（新しい順・最大 30 件）】", ...rows.map((k) => `- [${kindJa[k.kind] ?? k.kind}] ${k.title}（${k.created_at.slice(0, 10)}）`)].join("\n");
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
      user: `${formatInput(project)}\n\n${await knowledgeContext(repo)}\n\nあなたの担当分野の観点で分析してください。`,
      schema: AnalysisSchema,
    });
    await repo.completeAnalysis(projectId, employeeId, {
      conclusion: data.conclusion,
      facts: data.facts,
      hypotheses: data.hypotheses.slice(0, 3),
      evidence: data.evidence,
      missing_data: data.missing_data,
      actions: data.actions.slice(0, 3),
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
      user: `${formatInput(project)}\n\n【分析部の結果】\n${report}\n\n${await knowledgeContext(repo)}\n\n【施策の担当に選べる実行 AI】\n${executors}\n\n統合判断をしてください。tasks は最大 3 つ、executor_employee_id は上の id から選んでください。`,
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
  await repo.updateProject(projectId, { status: "candidates" });
  return ids;
}

// ---------- Step 4: 実行担当が成果物を作る（修正依頼にも使う） ----------
export async function produceOutput(env: Env, taskId: string, revisionNote: string | null): Promise<string> {
  const repo = new Repo(env.DB);
  const task = await repo.getTask(taskId);
  if (!task) throw new NonRetryableError("施策が見つかりません。");
  const previous = await repo.latestOutput(taskId);
  // 初回作成で既に成果物があれば飛ばす。修正依頼のときは、同じ指示の版がまだ無いときだけ作る。
  if (!revisionNote && previous) return previous.id;
  if (revisionNote && previous?.revision_note === revisionNote && task.status !== "revising") return previous.id;

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
    await repo.updateTask(taskId, { status: "awaiting_approval" });
    return out.id;
  } catch (err) {
    const e = asWorkflowError(err);
    if (e instanceof NonRetryableError) await repo.updateTask(taskId, { status: "failed" });
    throw e;
  }
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
