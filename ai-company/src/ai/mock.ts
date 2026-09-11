import type { z } from "zod";
import type { AiProvider, GenerateUsage, JsonRequest, TextRequest } from "./provider";

/**
 * API キーなしで動作確認するための固定回答プロバイダ（開発用）。
 * 本物の AI ではない。相談内容のキーワードで招集する担当を変え、担当名を回答に入れる程度の変化だけ付ける。
 */
export class MockProvider implements AiProvider {
  readonly name = "mock";

  async generateJSON<T extends z.ZodType>(req: JsonRequest<T>): Promise<{ data: z.infer<T>; usage: GenerateUsage }> {
    await sleep(300);
    const sample = pick(req.system, req.user);
    const data = req.schema.parse(sample) as z.infer<T>;
    return { data, usage: usage() };
  }

  async generateText(req: TextRequest): Promise<{ text: string; usage: GenerateUsage }> {
    await sleep(300);
    const revised = /修正指示/.test(req.user);
    return { text: (revised ? "> 修正版: 代表の修正指示を反映しました。（固定回答）\n\n" : "") + TEXT_SAMPLE, usage: usage() };
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usage = (): GenerateUsage => ({ model: "mock", inputTokens: 1200, outputTokens: 600 });

function pick(system: string, user: string): unknown {
  if (/分析部 8 人のうち今回必要な担当/.test(system)) return select(user);
  if (/修正指示を反映した新しい施策案を 1 件だけ/.test(user)) return revisedTask(user);
  if (/ViXer で最も重要な AI 社員/.test(system)) return SYNTHESIS;
  if (/KPI 検証担当/.test(system)) return VERIFICATION;
  const name = /あなたは「([^」]+担当)」/.exec(system)?.[1] ?? "分析担当";
  return analysis(name);
}

/**
 * 招集する担当を決める。本番では司令塔 AI が判断するが、
 * mock でも動きを再現するため、ファネル判定（問題ありの段階）と相談文から機械的に決める。
 */
function select(user: string) {
  const t = user.split("今回の入力:")[1] ?? user;
  // ファネル判定に「最も詰まっている段階」があればそれを優先する
  const weakest = /→ 最も詰まっている可能性が高い段階: (.+)/.exec(t)?.[1]?.trim();
  const byStage: Record<string, { category: string; analysts: string[] }> = {
    "Google 検索": { category: "集客（検索）", analysts: ["marketing", "web", "competitor"] },
    "Google ビジネスプロフィール": { category: "集客（MEO）", analysts: ["marketing", "web", "competitor"] },
    "HP 流入": { category: "集客（HP 流入）", analysts: ["web", "marketing", "data"] },
    "HP 内行動": { category: "HP 内の導線", analysts: ["web", "marketing", "data"] },
    "見学予約": { category: "見学予約", analysts: ["sales", "marketing", "customer"] },
    実来館: { category: "実来館", analysts: ["sales", "customer", "data"] },
    "30日お試し": { category: "入会導線", analysts: ["sales", "customer", "product"] },
    本入会: { category: "入会導線", analysts: ["sales", "customer", "product"] },
  };
  if (weakest && byStage[weakest]) {
    const hit = byStage[weakest];
    return { ...hit, reason: `ファネル判定で「${weakest}」が最も詰まっているため、その段階を見る 3 名を招集しました。（固定回答）` };
  }
  if (/利益|固定費|人件費|コスト|経費/.test(t)) return { category: "収益", analysts: ["data", "profit", "product"], reason: "売上と利益の差に関する相談のため、全体数値・収益・商品構成の 3 名を招集しました。（固定回答）" };
  if (/退会|休眠|来館/.test(t) && !/見学|お試し/.test(t)) return { category: "継続", analysts: ["customer", "data", "product"], reason: "退会・継続に関する相談のため、継続・全体数値・商品構成の 3 名を招集しました。（固定回答）" };
  if (/Google|検索|流入|MEO|SEO|口コミ/i.test(t)) return { category: "集客", analysts: ["marketing", "web", "competitor"], reason: "検索・Google からの流入に関する相談のため、集客・Web・競合の 3 名を招集しました。（固定回答）" };
  return { category: "入会導線", analysts: ["data", "sales", "customer"], reason: "見学から 30 日お試しへの転換に関する相談のため、全体数値・入会導線・継続の 3 名を招集しました。（固定回答）" };
}

/** 代表の修正指示を受けた施策案の作り直し（固定回答） */
function revisedTask(user: string) {
  const rank = Number(/優先順位 (\d+)/.exec(user)?.[1] ?? 1);
  const title = /題名: (.+)/.exec(user)?.[1]?.trim() ?? "施策";
  const executor = /担当 AI: (.+)/.exec(user)?.[1]?.trim() ?? "";
  const executorId = { "LINE・営業担当": "line", 集客実行担当: "growth", 会員継続担当: "retention", 企画設計担当: "planner", コンテンツ制作担当: "content", "Web 実装担当": "webdev" }[executor] ?? "planner";
  const note = /【代表からの修正指示】\n(.+)/.exec(user)?.[1]?.trim() ?? "";
  const base = SYNTHESIS.tasks.find((t) => t.rank === rank) ?? SYNTHESIS.tasks[0];
  return {
    task: { ...base, rank, title: `${title}（修正版）`, executor_employee_id: executorId, what_to_do: `${base.what_to_do}\n代表の指示「${note}」を反映しました。（固定回答）`, priority_reason: `${base.priority_reason} 代表の修正指示を反映しています。` },
    change_note: `代表の指示「${note}」に合わせて内容を調整しました。（固定回答）`,
  };
}

function analysis(name: string) {
  return {
    conclusion: `${name}の観点: 見学は増えているが、30日お試しへ進む率が落ちている。入口ではなく見学後に取りこぼしがある。（固定回答。本番では Claude が入力の数字から書きます）`,
    facts: ["見学・体験は入力値のとおり", "見学 → 30日お試し の転換率は入力値から計算できる", "退会数は入力値のとおり"],
    hypotheses: [
      { hypothesis: "見学当日に次の一歩を提示できていない可能性", rationale: "見学数に対してお試し開始が少なく、見学後の落ちが大きいため" },
      { hypothesis: "見学後のフォローが担当者によってばらつく可能性", rationale: "転換率の月ごとの変動が大きいため（前月比が分かればより確度が上がる）" },
    ],
    evidence: [
      { label: "見学 → 30日お試し 転換率", value: "入力の お試し ÷ 見学", source: "計算式: 30日お試し開始 ÷ 見学・体験" },
      { label: "退会", value: "入力値", source: "入力: 退会" },
    ],
    missing_data: ["前月の見学数とお試し開始数（前月比を出すため）", "見学担当者別の転換率", "退会理由の内訳"],
    actions: ["見学当日の締めトークに「次の一歩（お試し開始日）」を必ず入れる", "見学翌日に LINE でフォローする文面とタイミングを決める", "担当者別の転換率を 1 か月記録する"],
  };
}

const SYNTHESIS = {
  top_issue: "今月の最重要課題は「見学は来ているのに 30 日お試しへ進まない」こと。入口を増やすより、見学後の転換を直す方が効果が大きい。（固定回答）",
  reasoning: "分析担当 3 名が共通して「見学後の落ち」を指摘している。見学数は入力値のとおり確保できており、集客の入口は足りている。一方でお試しへの転換率は入力から計算でき、ここが最大の取りこぼしになっている。退会も続いているが、まず入会導線を直す方が短時間で効果が出る。",
  evidence: [{ label: "見学 → お試し 転換率", value: "入力の お試し ÷ 見学", source: "営業・入会分析担当の計算" }],
  tasks: [
    { rank: 1, title: "見学当日の案内トークと翌日 LINE フォローで、見学 → 30 日お試しの転換率を上げる", objective: "見学 → お試し転換率の改善", what_to_do: "見学の最後に「続けられそうな時間帯」を聞き、お試しの開始日を提案する締めトークを全スタッフで統一する。翌日 10 時に LINE で見学のお礼と開始日の提案を送り、3 日後・7 日後にも短いフォローを送る。送信は代表承認後にスタッフが行う。", executor_employee_id: "line", assignment_reason: "見学者フォローの文面とタイミングが成果物のため", human_owner: "受付スタッフ（文面の最終確認は代表）", duration_days: 30, effort_hours: 3, impact_score: 5, difficulty: 2, cost_estimate: "0 円（既存の LINE 公式アカウント）", priority_reason: "転換率の落ち込みが最大の損失で、既存の LINE で完結し 3 時間で着手できる。", restricted_actions: ["send_line"], kpis: [{ name: "見学 → お試し転換率", unit: "%", baseline_value: null, target_value: 40, measure_by: null }] },
    { rank: 2, title: "Google ビジネスプロフィールの投稿・写真を更新し、見学予約への導線を強くする", objective: "見学予約数の維持・増加", what_to_do: "週 1 回の投稿を 4 週分作り、古い写真を差し替える。予約ボタンの導線を確認する。", executor_employee_id: "growth", assignment_reason: "MEO の具体策が成果物のため", human_owner: "代表", duration_days: 30, effort_hours: 4, impact_score: 3, difficulty: 2, cost_estimate: "0 円", priority_reason: "入口は足りているので優先度は 2 番目。写真と投稿の更新だけで予約の後押しになる。", restricted_actions: ["post_sns"], kpis: [{ name: "HP からの見学予約", unit: "件", baseline_value: null, target_value: 24, measure_by: null }] },
    { rank: 3, title: "来館が月 2 回以下に落ちた会員への休眠前の声かけ", objective: "退会の予防", what_to_do: "直近 30 日の来館が 2 回以下の会員を抽出し（代表承認後）、来館時の声かけと LINE の文面を決めて実施する。", executor_employee_id: "retention", assignment_reason: "継続施策が成果物のため", human_owner: "トレーナー", duration_days: 30, effort_hours: 2, impact_score: 3, difficulty: 3, cost_estimate: "0 円", priority_reason: "退会予備軍は特定できるが、まず入会導線を直してから。", restricted_actions: ["edit_member_data"], kpis: [{ name: "翌月の退会数", unit: "名", baseline_value: null, target_value: 12, measure_by: null }] },
  ],
  not_now: [
    { item: "料金改定", reason: "退会理由が料金と確認できていない" },
    { item: "新規の広告出稿", reason: "見学数は足りている。入口より見学後を直す" },
    { item: "HP の全面リニューアル", reason: "予約導線の部分改善で足りる" },
  ],
  needed_data: ["前月の見学数とお試し開始数", "見学担当者別の転換率", "退会理由の内訳（プラン別）"],
};

const VERIFICATION = {
  achievement: "achieved",
  achievement_reason: "施策後の値が目標値以上のため達成と判定。（固定回答）",
  effect_likelihood: "高い。施策の内容（見学当日の締めトークと翌日フォロー）が転換率に直接効く位置にあり、他に大きな変更が無いため。",
  other_factors: "季節要因（新年度・夏）や口コミ増加の影響も考えられる。前年同月と比較できればより確かになる。",
  recommendation: "continue",
  recommendation_reason: "目標を達成し、コストもかかっていないため継続が妥当。",
  next_step: "文面を月 1 回見直し、担当者別の転換率を記録して属人化を防ぐ。",
  lesson: "見学後 24 時間以内の具体的な提案（開始日）が転換に効く。",
  next_time: "転換率が落ちたら、まず見学当日の締めトークと翌日フォローが実施されているかを確認する。",
};

const TEXT_SAMPLE = `## 対象と目的
これは固定回答の成果物です（AI_PROVIDER=mock）。本番では担当 AI が、そのまま使える原稿・計画・仕様を書きます。

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
