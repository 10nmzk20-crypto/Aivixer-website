/**
 * 実 AI（Claude）との通信確認スクリプト。デプロイ前に手元で 1 回動かす。
 *
 *   ANTHROPIC_API_KEY=sk-ant-... npm run ai:check
 *
 * やること:
 *   1. 経営司令塔にサンプル入力を渡し「必要な分析担当」を選ばせる
 *   2. 選ばれた最初の担当にサンプル入力を分析させ、事実 / 仮説 / 根拠となった数字 / 追加データ が返るか確かめる
 * 料金の目安: 2 回の呼び出しで数円〜十数円程度。
 */
import { AnthropicProvider } from "../src/ai/anthropic";
import { AnalysisSchema, SelectAnalystsSchema } from "../src/ai/schemas";
import { ANALYST_IDS, COMPANY_CONTEXT, EMPLOYEE_MAP } from "../src/employees/roster";
import { COMMANDER_PROMPTS } from "../src/employees/prompts-command";

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY が設定されていません。例: ANTHROPIC_API_KEY=sk-ant-... npm run ai:check");
  process.exit(1);
}
const model = process.env.AI_MODEL || "claude-opus-5";
const effort = (process.env.AI_EFFORT as "low" | "medium" | "high") || "medium";
const ai = new AnthropicProvider({ apiKey, model, maxOutputTokens: Number(process.env.AI_MAX_OUTPUT_TOKENS || 8000), effort });

const SAMPLE_INPUT = `案件名: 2026 年 8 月 の分析
対象期間: 2026 年 8 月

【入力された数字】
- 売上（円）: 4,180,000
- 会員数（月末）（名）: 412
- 新規入会（名）: 14
- 退会（名）: 19
- 問い合わせ（件）: 46
- 見学・体験（件）: 31
- 30日お試し 開始（名）: 9
- 本入会（お試し経由）（名）: 5

【相談内容】
見学は先月より増えているのに、30日お試しに進む人が減っている気がする。退会も 2 か月続けて 15 人を超えた。`;

const system = (id: string, override?: string) => `${COMPANY_CONTEXT}\n\n${override ?? EMPLOYEE_MAP[id].systemPrompt}`;
const t0 = Date.now();
const sec = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";

console.log(`モデル: ${model} / effort: ${effort}`);
console.log("1) 経営司令塔: 必要な分析担当を選ぶ …");
const roster = ANALYST_IDS.map((id) => `- ${id}: ${EMPLOYEE_MAP[id].name}`).join("\n");
const sel = await ai.generateJSON({
  system: system("commander", COMMANDER_PROMPTS.select),
  user: `分析部の一覧:\n${roster}\n\n今回の入力:\n${SAMPLE_INPUT}\n\n必要な担当の id を analysts に入れてください。`,
  schema: SelectAnalystsSchema,
  maxTokens: 1500,
});
console.log(`   選ばれた担当: ${sel.data.analysts.join(", ")}`);
console.log(`   理由: ${sel.data.reason}`);
console.log(`   tokens in/out: ${sel.usage.inputTokens}/${sel.usage.outputTokens}  (${sec()})`);

const first = sel.data.analysts.find((id) => ANALYST_IDS.includes(id)) ?? "data";
console.log(`2) ${EMPLOYEE_MAP[first].name}: 分析 …`);
const res = await ai.generateJSON({
  system: system(first),
  user: `${SAMPLE_INPUT}\n\n【過去のナレッジ】まだありません。\n\nあなたの担当分野の観点で分析してください。`,
  schema: AnalysisSchema,
});
const d = res.data;
console.log(`   見出し: ${d.headline}`);
console.log("   事実:"); d.facts.forEach((x) => console.log("     -", x));
console.log("   仮説:"); d.hypotheses.forEach((x) => console.log("     -", x));
console.log("   根拠となった数字:"); d.evidence.forEach((e) => console.log(`     - ${e.label}: ${e.value}（${e.source}）`));
console.log("   追加で必要なデータ:"); d.needed_data.forEach((x) => console.log("     -", x));
console.log("   所見:", d.findings_md.replace(/\n+/g, " ").slice(0, 200));
console.log(`   tokens in/out: ${res.usage.inputTokens}/${res.usage.outputTokens}  (${sec()})`);
console.log("\nOK: Claude との通信と回答の形式（事実 / 仮説 / 根拠となった数字 / 追加データ）を確認しました。");
