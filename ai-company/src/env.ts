/// <reference types="@cloudflare/workers-types" />

/** Worker が使う設定・秘密情報・バインディングの型 */
export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  ANALYSIS_PIPELINE: Workflow<AnalysisPipelineParams>;
  REVISION_PIPELINE: Workflow<RevisionPipelineParams>;
  VERIFICATION_PIPELINE: Workflow<VerificationPipelineParams>;

  ENVIRONMENT?: string; // 'development' | 'production'
  AI_PROVIDER?: string; // 'anthropic' | 'mock'
  AI_MODEL?: string;
  AI_MAX_OUTPUT_TOKENS?: string;
  AI_EFFORT?: string;

  // 秘密情報（wrangler secret / .dev.vars）
  ANTHROPIC_API_KEY?: string;
  /** 動作確認用に API の送信先を差し替える。本番では設定しない */
  ANTHROPIC_BASE_URL?: string;
  APP_PASSWORD?: string;
  APP_SESSION_SECRET?: string;

  // Cloudflare Access
  CF_ACCESS_TEAM_DOMAIN?: string;
  CF_ACCESS_AUD?: string;
}

export interface AnalysisPipelineParams {
  projectId: string;
}

export interface RevisionPipelineParams {
  taskId: string;
  note: string;
}

export interface VerificationPipelineParams {
  taskId: string;
}
