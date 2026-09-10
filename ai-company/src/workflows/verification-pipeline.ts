import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env, VerificationPipelineParams } from "../env";
import { Repo } from "../db/repo";
import { verifyTask } from "./agents";
import { AI_STEP } from "./analysis-pipeline";

/** 「KPI 検証担当に判定を依頼」で起動。判定結果を保存し、施策を検証待ちに戻す（最終判断は代表） */
export class VerificationPipeline extends WorkflowEntrypoint<Env, VerificationPipelineParams> {
  async run(event: WorkflowEvent<VerificationPipelineParams>, step: WorkflowStep) {
    const { taskId } = event.payload;
    try {
      return await step.do("verify", AI_STEP, () => verifyTask(this.env, taskId));
    } catch (err) {
      await step.do("mark-failed", async () => {
        // 失敗しても代表が手で判断できるよう、検証待ちに戻す
        const repo = new Repo(this.env.DB);
        await repo.updateTask(taskId, { status: "awaiting_verification" });
        return true;
      });
      throw err;
    }
  }
}
