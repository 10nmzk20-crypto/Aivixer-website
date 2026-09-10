import type { z } from "zod";
import type { AiProvider, GenerateUsage, JsonRequest, TextRequest } from "./provider";

/**
 * API キーなしで動作確認するための固定回答プロバイダ。
 * 依頼文の内容（どの工程か）を見て、それらしいサンプルを返す。
 */
export class MockProvider implements AiProvider {
  readonly name = "mock";

  async generateJSON<T extends z.ZodType>(req: JsonRequest<T>): Promise<{ data: z.infer<T>; usage: GenerateUsage }> {
    await sleep(400);
    const key = detect(req.system, req.user);
    const sample = SAMPLES[key] ?? SAMPLES.analysis;
    const data = req.schema.parse(sample) as z.infer<T>;
    return { data, usage: usage() };
  }

  async generateText(req: TextRequest): Promise<{ text: string; usage: GenerateUsage }> {
    await sleep(400);
    const revised = /修正指示/.test(req.user);
    return { text: (revised ? "> 修正版（v2）: 修正指示を反映しました。\n\n" : "") + TEXT_SAMPLE, usage: usage() };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usage = (): GenerateUsage => ({ model: "mock", inputTokens: 1200, outputTokens: 600 });

function detect(system: string, user: string): keyof typeof SAMPLES {
  if (/分析部 8 人のうち今回必要な担当/.test(system)) return "select";
  if (/最も重要な AI 社員/.test(system)) return "synthesize";
  return "analysis";
}

const SAMPLES: Record<"select" | "analysis" | "synthesize", unknown> = {
  select: { analysts: ["data", "sales", "customer", "marketing"], reason: "数字の入力と、見学後の転換・退会・口コミに関する相談のため、全体数値・入会導線・継続・集客の 4 名を選びました。" },
  analysis: {
    headline: "見学は増えたが、お試しへの転換が落ちている（サンプル）",
    facts: ["見学・体験 31 件は前月比 +15%", "見学 → 30日お試し は 29%（前月 41%）", "退会 19 名は 2 か月連続で 15 名超"],
    hypotheses: ["見学当日に次の一歩を提示できていない可能性", "見学後のフォローが担当者によってばらつく可能性"],
    needed_data: ["担当者別の見学 → お試し転換率", "退会理由の内訳"],
    findings_md: "これはサンプルの分析です（AI_PROVIDER=mock）。本番では Claude が入力データをもとに、異常値・傾向・ボトルネックを書きます。\n\n見学は増えているのに、お試しへ進む率が落ちています。入口ではなく見学後に取りこぼしがあります。",
  },
  synthesize: {
    summary_md: "今月の問題は「集客不足」ではなく「見学後に落ちている」ことと「半年未満の退会」です。入口を増やす施策は後回しにし、見学 → お試しの転換と、休眠前の声かけに集中します。（サンプル）",
    facts: ["見学 → お試し転換率が 41% → 29% に低下", "退会 19 名のうち 11 名が在籍 6 か月未満", "口コミと表示回数は伸びている"],
    hypotheses: ["見学当日の「次の一歩」の提示不足", "見学後フォローの属人化"],
    needed_data: ["担当者別の見学 → お試し転換率", "退会理由の内訳（プラン別）"],
    not_now: [
      { item: "料金改定", reason: "退会理由が料金と確認できていない" },
      { item: "新規の広告出稿", reason: "入口は足りている。7 月の SNS 広告は中止済み" },
    ],
    tasks: [
      { rank: 1, title: "見学当日の案内トークと翌日 LINE フォローで、見学 → 30 日お試しの転換率を上げる", objective: "見学 → お試し転換率を 29% → 40% に戻す", reasoning: "転換率の落ち込みが最大の損失。既存の LINE で完結し、3 時間で着手できる。", impact_score: 5, effort_hours: 3, executor_employee_id: "line", assignment_reason: "見学者フォローの文面とタイミングが成果物のため", restricted_actions: ["send_line"], kpis: [{ name: "見学 → お試し転換率", unit: "%", baseline_value: 29, target_value: 40, measure_by: "2026-10-10" }] },
      { rank: 2, title: "Google ビジネスプロフィールの投稿・写真を更新し、見学予約への導線を強くする", objective: "プロフィールからの予約クリックを月 40 → 60 件に", reasoning: "表示回数は多い。写真と投稿の更新だけで予約の後押しになる。", impact_score: 4, effort_hours: 4, executor_employee_id: "growth", assignment_reason: "MEO の具体策が成果物のため", restricted_actions: [], kpis: [{ name: "予約クリック数", unit: "件", baseline_value: 40, target_value: 60, measure_by: "2026-10-10" }] },
      { rank: 3, title: "来館が月 2 回以下に落ちた会員への休眠前の声かけ", objective: "対象会員の翌月来館を月 3 回以上に戻す", reasoning: "退会予備軍が特定できている。声かけは 2 時間で完了する。", impact_score: 3, effort_hours: 2, executor_employee_id: "retention", assignment_reason: "継続施策が成果物のため", restricted_actions: ["edit_member_data"], kpis: [{ name: "翌月の退会数", unit: "名", baseline_value: 19, target_value: 12, measure_by: "2026-10-31" }] },
    ],
  },
};

const TEXT_SAMPLE = `## 対象と目的
これはサンプルの成果物です（AI_PROVIDER=mock）。本番では担当 AI が、そのまま使える原稿・計画・仕様を書きます。

## 送るタイミング
| タイミング | 目的 |
|---|---|
| 翌日 10:00 | 感謝と次の一歩 |
| 3 日後 19:00 | よくある質問への回答 |

## 文面
> 〇〇さん、昨日はご見学ありがとうございました。昨日お話しした時間帯なら、来週から 30 日お試しを始められます。

## 代表に確認してほしいこと
1. 送信は代表の承認後にスタッフが行います。
`;
