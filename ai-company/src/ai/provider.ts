import type { z } from "zod";
import type { Env } from "../env";
import { AnthropicProvider } from "./anthropic";
import { MockProvider } from "./mock";

/**
 * AI プロバイダ層。UI・API・Workflow はこの 2 つの関数しか呼ばない。
 * モデルや会社を変えるときは、この層の実装を差し替えるだけでよい。
 */
export interface GenerateUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface JsonRequest<T extends z.ZodType> {
  /** 役割の説明（system prompt） */
  system: string;
  /** その回の依頼内容 */
  user: string;
  schema: T;
  maxTokens?: number;
}

export interface TextRequest {
  system: string;
  user: string;
  maxTokens?: number;
}

export interface AiProvider {
  readonly name: string;
  generateJSON<T extends z.ZodType>(req: JsonRequest<T>): Promise<{ data: z.infer<T>; usage: GenerateUsage }>;
  generateText(req: TextRequest): Promise<{ text: string; usage: GenerateUsage }>;
}

export class AiProviderError extends Error {
  constructor(message: string, public readonly retryable: boolean) {
    super(message);
    this.name = "AiProviderError";
  }
}

export function getProvider(env: Env): AiProvider {
  const name = providerName(env);
  if (name === "mock") return new MockProvider();
  if (name === "claude") {
    if (!env.ANTHROPIC_API_KEY) {
      throw new AiProviderError("ANTHROPIC_API_KEY が設定されていません。`wrangler secret put ANTHROPIC_API_KEY` で登録してください。", false);
    }
    return new AnthropicProvider({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.AI_MODEL || "claude-opus-5",
      maxOutputTokens: Number(env.AI_MAX_OUTPUT_TOKENS || 8000),
      effort: (env.AI_EFFORT as AnthropicEffort) || "medium",
      // 動作確認用。通常は未設定（本物の Anthropic API を使う）
      baseURL: env.ANTHROPIC_BASE_URL || undefined,
    });
  }
  throw new AiProviderError(`未対応の AI_PROVIDER です: ${name}`, false);
}

/** 設定名を正規化する。`claude` と `anthropic` は同じ意味 */
export function providerName(env: Env): "mock" | "claude" | string {
  const raw = (env.AI_PROVIDER ?? "claude").toLowerCase().trim();
  if (raw === "anthropic" || raw === "claude") return "claude";
  return raw;
}

export type AnthropicEffort = "low" | "medium" | "high" | "xhigh" | "max";
