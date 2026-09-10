import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { AnalysisPipelineParams, Env } from "../env";
import { finalizeProject, markProjectFailed, produceOutput, runAnalyst, selectAnalysts, synthesize } from "./agents";

/** AI 呼び出しを含むステップの再試行設定（合計 3 回まで、10 秒 → 20 秒 → 40 秒） */
export const AI_STEP = { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" }, timeout: "10 minutes" } as const;
const DB_STEP = { retries: { limit: 3, delay: "2 seconds", backoff: "constant" }, timeout: "1 minute" } as const;

/**
 * 分析パイプライン:
 *   1. 司令塔が分析担当を選ぶ
 *   2. 分析担当がそれぞれ分析する（並行）
 *   3. 司令塔が統合し、最優先施策（最大 3）を決める
 *   4. 実行担当が施策ごとに成果物を作る（並行）
 *   5. 案件を「代表承認待ち」にする
 */
export class AnalysisPipeline extends WorkflowEntrypoint<Env, AnalysisPipelineParams> {
  async run(event: WorkflowEvent<AnalysisPipelineParams>, step: WorkflowStep) {
    const { projectId } = event.payload;
    try {
      const analysts = await step.do("select-analysts", AI_STEP, () => selectAnalysts(this.env, projectId));

      const done = await Promise.allSettled(analysts.map((id) => step.do(`analyze-${id}`, AI_STEP, () => runAnalyst(this.env, projectId, id))));
      const succeeded = done.filter((d) => d.status === "fulfilled").length;
      if (succeeded === 0) {
        const first = done.find((d): d is PromiseRejectedResult => d.status === "rejected");
        throw new Error(`分析担当の処理がすべて失敗しました: ${first?.reason instanceof Error ? first.reason.message : String(first?.reason)}`);
      }

      const taskIds = await step.do("synthesize", AI_STEP, () => synthesize(this.env, projectId));

      await Promise.allSettled(taskIds.map((taskId, i) => step.do(`produce-${i + 1}`, AI_STEP, () => produceOutput(this.env, taskId, null))));

      return await step.do("finalize", DB_STEP, () => finalizeProject(this.env, projectId));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await step.do("mark-failed", DB_STEP, async () => {
        await markProjectFailed(this.env, projectId, message);
        return message;
      });
      throw err;
    }
  }
}
