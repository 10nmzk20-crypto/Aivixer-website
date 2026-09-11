import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env, PlanRevisionPipelineParams } from "../env";
import { Repo } from "../db/repo";
import { revisePlan } from "./agents";
import { AI_STEP } from "./analysis-pipeline";

/**
 * 代表が「修正」を押したときに動く（施策案の段階）。
 * 経営司令塔が修正指示を読み、その施策 1 件を作り直して再び承認待ちにする。
 */
export class PlanRevisionPipeline extends WorkflowEntrypoint<Env, PlanRevisionPipelineParams> {
  async run(event: WorkflowEvent<PlanRevisionPipelineParams>, step: WorkflowStep) {
    const { taskId, note } = event.payload;
    try {
      return await step.do("revise-plan", AI_STEP, () => revisePlan(this.env, taskId, note));
    } catch (err) {
      await step.do("mark-failed", async () => {
        // 作り直せなくても元の案は残っているので、承認待ちに戻して代表が再判断できるようにする
        const repo = new Repo(this.env.DB);
        await repo.updateTask(taskId, { status: "awaiting_approval" });
        return true;
      });
      throw err;
    }
  }
}
