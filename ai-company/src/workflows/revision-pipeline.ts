import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env, RevisionPipelineParams } from "../env";
import { Repo } from "../db/repo";
import { produceOutput } from "./agents";
import { AI_STEP } from "./analysis-pipeline";

/** 「修正」で代表の指示を受け、担当 AI が次の版を作る */
export class RevisionPipeline extends WorkflowEntrypoint<Env, RevisionPipelineParams> {
  async run(event: WorkflowEvent<RevisionPipelineParams>, step: WorkflowStep) {
    const { taskId, note } = event.payload;
    try {
      const outputId = await step.do("revise", AI_STEP, () => produceOutput(this.env, taskId, note));
      await step.do("recompute", async () => {
        const repo = new Repo(this.env.DB);
        const task = await repo.getTask(taskId);
        return task ? repo.recomputeProjectStatus(task.project_id) : "unknown";
      });
      return outputId;
    } catch (err) {
      await step.do("mark-failed", async () => {
        const repo = new Repo(this.env.DB);
        // 失敗しても前の版は残っているので、承認待ちに戻して代表が再度判断できるようにする
        await repo.updateTask(taskId, { status: "awaiting_approval" });
        return true;
      });
      throw err;
    }
  }
}
