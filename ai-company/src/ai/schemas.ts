import { z } from "zod";

/** AI に返させる JSON の形。プロバイダ層はこの形を保証して返す。 */

export const SelectAnalystsSchema = z.object({
  analysts: z.array(z.string()).describe("今回必要な分析担当の id"),
  reason: z.string(),
});
export type SelectAnalystsResult = z.infer<typeof SelectAnalystsSchema>;

export const EvidenceSchema = z.object({
  label: z.string().describe("何の数字か（例: 見学 → お試し転換率）"),
  value: z.string().describe("数字そのもの（例: 29%、9 / 31 件）"),
  source: z.string().describe("どの入力から得たか、または計算式（例: お試し 9 ÷ 見学 31）"),
});
export type Evidence = z.infer<typeof EvidenceSchema>;

export const AnalysisSchema = z.object({
  headline: z.string(),
  facts: z.array(z.string()),
  hypotheses: z.array(z.string()),
  evidence: z.array(EvidenceSchema).describe("根拠となった数字。入力にある数字と、そこから計算した数字だけ"),
  needed_data: z.array(z.string()),
  findings_md: z.string(),
});
export type AnalysisResult = z.infer<typeof AnalysisSchema>;

export const KpiProposalSchema = z.object({
  name: z.string(),
  unit: z.string().nullable(),
  baseline_value: z.number().nullable(),
  target_value: z.number().nullable(),
  measure_by: z.string().nullable().describe("測る期日（YYYY-MM-DD）"),
});

export const TaskProposalSchema = z.object({
  rank: z.number().int(),
  title: z.string(),
  objective: z.string(),
  reasoning: z.string(),
  impact_score: z.number().int(),
  effort_hours: z.number(),
  executor_employee_id: z.string(),
  assignment_reason: z.string(),
  restricted_actions: z.array(z.string()),
  kpis: z.array(KpiProposalSchema),
});

export const SynthesisSchema = z.object({
  summary_md: z.string(),
  facts: z.array(z.string()),
  hypotheses: z.array(z.string()),
  evidence: z.array(EvidenceSchema).describe("判断の根拠となった数字（分析担当の結果から重要なもの）"),
  needed_data: z.array(z.string()),
  not_now: z.array(z.object({ item: z.string(), reason: z.string() })),
  tasks: z.array(TaskProposalSchema),
});
export type SynthesisResult = z.infer<typeof SynthesisSchema>;
export type TaskProposal = z.infer<typeof TaskProposalSchema>;
