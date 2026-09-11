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
  const executorId = { 摩擦削減担当: "line", 資産型集客担当: "growth", セルフ利用設計担当: "retention", 仕組み設計担当: "planner", 資産コンテンツ担当: "content", "Web 実装担当": "webdev" }[executor] ?? "planner";
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
    actions: ["見学者から出た質問を集め、その場で渡せる 1 枚にまとめる", "同じ内容を Web に置き、見学予約の確認メールからリンクする", "「何をすればいいか分からない」を解く目的別セルフメニューを用意する"],
  };
}

const SYNTHESIS = {
  top_issue: "今の最大の問題は「見学は来ているのに 30 日お試しへ進まない」こと。入口を増やすより、見学の場で疑問と不安が解消される状態を作る方が効果が大きい。（固定回答）",
  reasoning: "分析担当が共通して「見学後の落ち」を指摘している。見学数は確保できており、集客の入口は足りている。一方でお試しへの転換率は入力から計算でき、ここが最大の取りこぼしになっている。人が毎回フォローする案ではなく、見学の時点で判断材料が揃う仕組みを先に作る。",
  evidence: [{ label: "見学 → お試し 転換率", value: "入力の お試し ÷ 見学", source: "営業・入会分析担当の計算" }],
  tasks: [
    {
      rank: 1,
      title: "見学時に渡す「30 日お試しの進め方」1 枚と、同じ内容の Web ページを作る",
      objective: "見学の場で疑問と不安が解消され、その場で判断できる状態にする",
      what_to_do: "見学者から実際に出た質問を 10 個集め、答えを 1 枚にまとめる。料金・辞め方・持ち物・初日の流れ・混む時間帯を必ず入れる。同じ内容を HP の 1 ページにも置き、見学予約の確認メールからリンクする。紙は印刷して見学時に渡す。作ったあとは、質問が変わったときだけ直す。",
      executor_employee_id: "content",
      assignment_reason: "一度作れば働き続ける文章が成果物のため",
      human_owner: "代表（内容確認のみ）",
      duration_days: 14,
      task_type: "A",
      initial_hours: 4,
      ongoing_hours: 0.5,
      impact_score: 5,
      asset_score: 5,
      automation_score: 4,
      self_service: 5,
      staff_dependency: 1,
      owner_dependency: 2,
      human_work_change: "decrease",
      human_work_note: "見学のたびにスタッフが口頭で説明していた内容が 1 枚にまとまるため、説明の時間とばらつきが減ります。",
      manual_reason: null,
      difficulty: 2,
      cost_estimate: "印刷代のみ（約 2,000 円）",
      priority_reason: "転換率の落ち込みが最大の損失。一度作れば見学のたびに働き、スタッフの説明時間も減る。継続工数はほぼゼロ。",
      restricted_actions: ["publish_hp"],
      kpis: [{ name: "見学 → お試し転換率", unit: "%", baseline_value: null, target_value: 40, measure_by: null }],
    },
    {
      rank: 2,
      title: "よくある質問ページを作り、Google ビジネスプロフィールの固定情報も埋める",
      objective: "見学前の不安を減らし、検索から自然に見つかる状態を作る",
      what_to_do: "問い合わせで実際に多い質問を 15 個選び、答えを書いて HP に FAQ ページとして置く。Google ビジネスプロフィールの「質問と回答」「営業時間」「写真」も同じ内容で埋める。一度公開すれば、検索でも見学前でも使われ続ける。",
      executor_employee_id: "growth",
      assignment_reason: "積み上がる集客導線が成果物のため",
      human_owner: "代表",
      duration_days: 21,
      task_type: "A",
      initial_hours: 6,
      ongoing_hours: 0.5,
      impact_score: 4,
      asset_score: 5,
      automation_score: 3,
      self_service: 5,
      staff_dependency: 1,
      owner_dependency: 2,
      human_work_change: "decrease",
      human_work_note: "電話やLINEで同じ質問に答える回数が減ります。",
      manual_reason: null,
      difficulty: 2,
      cost_estimate: "0 円",
      priority_reason: "作れば検索でも見学前でも働き続ける。毎日投稿のような継続作業は発生しない。",
      restricted_actions: ["publish_hp"],
      kpis: [{ name: "HP からの見学予約", unit: "件", baseline_value: null, target_value: 24, measure_by: null }],
    },
    {
      rank: 3,
      title: "目的別セルフメニュー（20分 / 30分 / 45分）を作って館内と Web に置く",
      objective: "「何をすればいいか分からない」で来館が減る人を、自分で決められる状態にする",
      what_to_do: "目的（体を絞る・体力をつける・肩腰を楽にする）ごとに、20分 / 30分 / 45分の 3 通りのメニューを作る。マシンの並び順に沿って書き、館内に掲示し、同じ内容を Web にも置く。スタッフに聞かなくても、来たその日に始められる状態にする。",
      executor_employee_id: "retention",
      assignment_reason: "会員が自分で使える仕組みの設計が成果物のため",
      human_owner: "トレーナー（内容の確認）",
      duration_days: 30,
      task_type: "A",
      initial_hours: 8,
      ongoing_hours: 1,
      impact_score: 4,
      asset_score: 5,
      automation_score: 3,
      self_service: 5,
      staff_dependency: 2,
      owner_dependency: 1,
      human_work_change: "decrease",
      human_work_note: "メニューを毎回スタッフが考える必要がなくなり、聞かれる回数も減ります。",
      manual_reason: null,
      difficulty: 3,
      cost_estimate: "掲示物の印刷代（約 5,000 円）",
      priority_reason: "続かない理由の多くは「何をすればいいか分からない」。声かけを増やすより、自分で選べる状態を作る方が人の仕事を増やさずに効く。",
      restricted_actions: [],
      kpis: [{ name: "翌月の退会数", unit: "名", baseline_value: null, target_value: 12, measure_by: null }],
    },
  ],
  not_now: [
    { item: "来館が減った会員への個別 LINE", reason: "毎回人が動く C 分類。まず「何をすればいいか分からない」を仕組みで解く" },
    { item: "SNS の毎日投稿", reason: "やめた瞬間に効果が消える。検索で見つかる資産を先に作る" },
    { item: "料金改定", reason: "退会理由が料金と確認できていない" },
  ],
  needed_data: ["前月の見学数とお試し開始数", "見学者から実際に出た質問", "退会理由の内訳"],
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
