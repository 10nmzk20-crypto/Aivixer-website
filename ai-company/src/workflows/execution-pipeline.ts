import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env, ExecutionPipelineParams } from "../env";
import { Repo } from "../db/repo";
import { produceOutput } from "./agents";
import { AI_STEP } from "./analysis-pipeline";

/**
 * 代表が「採用」を押したときに動く。
 * 採用された施策を担当の実行 AI に渡し、実際に使える成果物（原稿・計画・仕様書）を作らせる。
 */
export class ExecutionPipeline extends WorkflowEntrypoint<Env, ExecutionPipelineParams> {
  async run(event: WorkflowEvent<ExecutionPipelineParams>, step: WorkflowStep) {
    const { taskId } = event.payload;
    try {
      const outputId = await step.do("produce", AI_STEP, () => produceOutput(this.env, taskId, null));
      await step.do("recompute", async () => {
        const repo = new Repo(this.env.DB);
        const task = await repo.getTask(taskId);
        return task ? repo.recomputeProjectStatus(task.project_id) : "unknown";
      });
      return outputId;
    } catch (err) {
      await step.do("mark-failed", async () => {
        // 成果物が作れなくても採用の判断は残す。実行中のまま置き、代表が再依頼できるようにする
        const repo = new Repo(this.env.DB);
        const message = err instanceof Error ? err.message : String(err);
        await repo.updateTask(taskId, { status: "in_progress", production_error: message.slice(0, 500) });
        return true;
      });
      throw err;
    }
  }
}
