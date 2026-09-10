import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { AiProviderError, type AiProvider, type AnthropicEffort, type GenerateUsage, type JsonRequest, type TextRequest } from "./provider";

interface Options {
  apiKey: string;
  model: string;
  maxOutputTokens: number;
  effort: AnthropicEffort;
}

/** Anthropic Claude を使う実装 */
export class AnthropicProvider implements AiProvider {
  readonly name = "anthropic";
  private client: Anthropic;
  private opts: Options;

  constructor(opts: Options) {
    this.opts = opts;
    // SDK 側の再試行は少なめにし、再試行は Workflow に任せる。1 回の回答に数分かかることがあるので timeout は長め
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 1, timeout: 10 * 60 * 1000 });
  }

  async generateJSON<T extends z.ZodType>(req: JsonRequest<T>): Promise<{ data: z.infer<T>; usage: GenerateUsage }> {
    try {
      const response = await this.client.messages.parse({
        model: this.opts.model,
        max_tokens: req.maxTokens ?? this.opts.maxOutputTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { effort: this.opts.effort, format: zodOutputFormat(req.schema) },
      });
      if (response.stop_reason === "refusal") throw new AiProviderError("AI が回答を拒否しました。入力内容を見直してください。", false);
      if (response.stop_reason === "max_tokens") throw new AiProviderError("AI の回答が長すぎて途中で切れました（max_tokens）。", true);
      if (!response.parsed_output) throw new AiProviderError("AI の回答を JSON として読み取れませんでした。", true);
      return { data: response.parsed_output, usage: usageOf(response) };
    } catch (err) {
      throw translate(err);
    }
  }

  async generateText(req: TextRequest): Promise<{ text: string; usage: GenerateUsage }> {
    try {
      const response = await this.client.messages.create({
        model: this.opts.model,
        max_tokens: req.maxTokens ?? this.opts.maxOutputTokens,
        system: req.system,
        messages: [{ role: "user", content: req.user }],
        output_config: { effort: this.opts.effort },
      });
      if (response.stop_reason === "refusal") throw new AiProviderError("AI が回答を拒否しました。入力内容を見直してください。", false);
      const text = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("\n")
        .trim();
      if (!text) throw new AiProviderError("AI から本文が返りませんでした。", true);
      return { text, usage: usageOf(response) };
    } catch (err) {
      throw translate(err);
    }
  }
}

function usageOf(r: Anthropic.Message): GenerateUsage {
  return { model: r.model, inputTokens: r.usage.input_tokens, outputTokens: r.usage.output_tokens };
}

/** SDK の例外を、再試行してよいかが分かる形に変換する */
function translate(err: unknown): Error {
  if (err instanceof AiProviderError) return err;
  if (err instanceof Anthropic.AuthenticationError) return new AiProviderError("Anthropic の API キーが無効です。", false);
  if (err instanceof Anthropic.BadRequestError) return new AiProviderError(`AI への依頼内容に問題があります: ${err.message}`, false);
  if (err instanceof Anthropic.RateLimitError) return new AiProviderError("AI の利用上限に達しました。少し待って再試行します。", true);
  if (err instanceof Anthropic.APIError) return new AiProviderError(`AI の呼び出しに失敗しました（${err.status}）: ${err.message}`, (err.status ?? 500) >= 500);
  if (err instanceof Anthropic.APIConnectionError) return new AiProviderError("AI への接続に失敗しました。", true);
  return err instanceof Error ? err : new Error(String(err));
}
