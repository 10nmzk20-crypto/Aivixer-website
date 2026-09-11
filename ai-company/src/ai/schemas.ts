import { z } from "zod";

/** AI に返させる JSON の形。プロバイダ層はこの形を保証して返す。 */

// ---------- 経営司令塔: 分析担当の招集 ----------
export const SelectAnalystsSchema = z.object({
  category: z.string().describe("相談の分類（例: 入会導線 / 集客 / 継続 / 収益 / 商品 / 競合 / 全体）"),
  analysts: z.array(z.string()).describe("今回招集する分析担当の id（2〜4 名）"),
  reason: z.string().describe("その担当を選んだ理由（1〜2 文）"),
});
export type SelectAnalystsResult = z.infer<typeof SelectAnalystsSchema>;

// ---------- 分析担当の回答（統一フォーマット） ----------
export const EvidenceSchema = z.object({
  label: z.string().describe("何の数字か（例: 見学 → お試し転換率）"),
  value: z.string().describe("数字そのもの（例: 29%、9 / 31 件）。不明なら「不明」"),
  source: z.string().describe("どの入力から得たか、または計算式（例: お試し 9 ÷ 見学 31）"),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const HypothesisSchema = z.object({
  hypothesis: z.string().describe("事実から考えられる原因（「〜の可能性」）"),
  rationale: z.string().describe("なぜその仮説を立てたか（根拠）"),
});

export const AnalysisSchema = z.object({
  conclusion: z.string().describe("【結論】最も重要な問題を 1〜2 文"),
  facts: z.array(z.string()).describe("【確認できる事実】入力された数字・データから言い切れることだけ"),
  hypotheses: z.array(HypothesisSchema).describe("【仮説】最大 3 つ。それぞれに根拠を付ける"),
  evidence: z.array(EvidenceSchema).describe("【根拠となった数字】入力にある数字と、そこから計算した数字だけ"),
  missing_data: z.array(z.string()).describe("【不足データ】判断精度を上げるために追加で必要な数字"),
  actions: z.array(z.string()).describe("【推奨アクション】具体策を最大 3 つ"),
});
export type AnalysisResult = z.infer<typeof AnalysisSchema>;

// ---------- 経営司令塔: 統合判断 ----------
export const KpiProposalSchema = z.object({
  name: z.string(),
  unit: z.string().nullable(),
  baseline_value: z.number().nullable().describe("現在値。入力から分かる場合のみ。不明なら null"),
  target_value: z.number().nullable().describe("目標値"),
  measure_by: z.string().nullable().describe("測る期日（YYYY-MM-DD）"),
});

export const TaskProposalSchema = z.object({
  rank: z.number().int().describe("優先順位 1〜3"),
  title: z.string().describe("施策名"),
  objective: z.string().describe("目的"),
  what_to_do: z.string().describe("具体的に何をするか（人が読んでそのまま動ける粒度、3〜6 文）"),
  executor_employee_id: z.string().describe("担当 AI 社員の id"),
  assignment_reason: z.string().describe("その AI 社員を選んだ理由"),
  human_owner: z.string().describe("人間側の担当（例: 代表 / 受付スタッフ / トレーナー）"),
  duration_days: z.number().int().describe("期限（着手から何日で完了・計測するか）"),
  effort_hours: z.number().describe("必要作業時間（人が動く時間の見積り）"),
  impact_score: z.number().int().describe("インパクト 1〜5"),
  difficulty: z.number().int().describe("実行難易度 1（簡単）〜5（難しい）"),
  cost_estimate: z.string().describe("必要コスト（例: 0 円 / 約 5,000 円 / 不明）"),
  priority_reason: z.string().describe("なぜこの優先順位か（インパクト・時間・難易度・コスト・現在の課題から）"),
  restricted_actions: z.array(z.string()).describe("代表承認が必要な操作の id（publish_hp / run_ads / post_sns / send_line / change_price / edit_member_data）"),
  kpis: z.array(KpiProposalSchema).describe("KPI 1〜2 個"),
});
export type TaskProposal = z.infer<typeof TaskProposalSchema>;

/** 代表の修正指示を受けて、施策 1 件を作り直す */
export const TaskRevisionSchema = z.object({
  task: TaskProposalSchema,
  change_note: z.string().describe("前の案から何をどう変えたか（1〜2 文）"),
});
export type TaskRevisionResult = z.infer<typeof TaskRevisionSchema>;

export const SynthesisSchema = z.object({
  top_issue: z.string().describe("【今月の最重要課題】1〜2 文"),
  reasoning: z.string().describe("【そう判断した理由】分析担当の結果と数字を根拠に 3〜6 文"),
  evidence: z.array(EvidenceSchema).describe("判断の根拠となった数字"),
  tasks: z.array(TaskProposalSchema).describe("【今やること】最大 3 つ"),
  not_now: z.array(z.object({ item: z.string(), reason: z.string() })).describe("【今はやらないこと】理由つき"),
  needed_data: z.array(z.string()).describe("【追加で必要なデータ】"),
});
export type SynthesisResult = z.infer<typeof SynthesisSchema>;

// ---------- KPI 検証担当 ----------
export const VerificationSchema = z.object({
  achievement: z.enum(["achieved", "partial", "missed"]).describe("達成 / 一部達成 / 未達"),
  achievement_reason: z.string().describe("判定の根拠（施策前・目標・施策後の数字を使って）"),
  effect_likelihood: z.string().describe("施策が効いた可能性（高い / 中 / 低い と、その理由）"),
  other_factors: z.string().describe("他の要因の可能性（季節・キャンペーン・偶然など）"),
  recommendation: z.enum(["continue", "improve", "stop"]).describe("次に続けるか / 改善して再実施か / 中止か"),
  recommendation_reason: z.string().describe("その推奨の理由"),
  next_step: z.string().describe("次に具体的にやること（改善案があればここに）"),
  lesson: z.string().describe("今回の学び（1〜3 文）"),
  next_time: z.string().describe("次回同じ状況になったらどうするか（1〜2 文）"),
});
export type VerificationResult = z.infer<typeof VerificationSchema>;
