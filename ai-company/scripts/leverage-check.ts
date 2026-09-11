/**
 * 仕組みスコアと分類ガードの動作確認（手動実行）。
 *   npx tsx scripts/leverage-check.ts
 * 「FAQ ページを作る」は A のまま高スコア、
 * 「来館が減った会員に個別 LINE」は A から降格し、注意が出ることを確かめる。
 */
import { checkType, computeLeverage, findDiscouraged, leverageWarning } from "../src/analysis/leverage";
import type { TaskType } from "../src/principles";

let failed = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}\n     ${detail}`);
  if (!ok) failed++;
}

// ---- ケース1: 一度作れば働く施策 ----
const faqInput = {
  impact: 4,
  asset: 5,
  automation: 5,
  initialHours: 6,
  ongoingHoursPerMonth: 0,
  staffDependency: 1,
  ownerDependency: 2,
};
const faqText = "見学前の不安を解消する FAQ ページを HP に作り、検索からも入るようにする";
const faq = computeLeverage(faqInput);
const faqType = checkType("A", faqInput);
const faqWarn = leverageWarning({ type: faqType.type, text: faqText, manualReason: null, ongoingHoursPerMonth: faqInput.ongoingHoursPerMonth });
check("FAQ ページ: A のまま", faqType.type === "A" && faqType.note === null, `分類=${faqType.type} 注記=${faqType.note ?? "なし"}`);
check("FAQ ページ: 注意なし", faqWarn === null, `注意=${faqWarn ?? "なし"}`);
check("FAQ ページ: スコア", faq.score > 5, `スコア=${faq.score} / 年間工数=${faq.yearHours}h / ${faq.formula}`);

// ---- ケース2: 毎回人が動く施策 ----
const lineInput = {
  impact: 3,
  asset: 1,
  automation: 1,
  initialHours: 2,
  ongoingHoursPerMonth: 8,
  staffDependency: 5,
  ownerDependency: 3,
};
const lineText = "来館が減った会員 31 名に個別 LINE を送り、来館を促す";
const line = computeLeverage(lineInput);
const lineType = checkType("A", lineInput);
const lineWarn = leverageWarning({ type: lineType.type, text: lineText, manualReason: null, ongoingHoursPerMonth: lineInput.ongoingHoursPerMonth });
check("個別 LINE: A から降格", lineType.type !== "A", `分類=${lineType.type} 注記=${lineType.note ?? "なし"}`);
check("個別 LINE: 抑制対象として検知", findDiscouraged(lineText).length > 0, findDiscouraged(lineText).map((h) => h.label).join("、") || "検知なし");
check("個別 LINE: 注意が出る", lineWarn !== null, lineWarn ?? "注意なし");
check("個別 LINE: FAQ よりスコアが低い", line.score < faq.score, `スコア=${line.score} / 年間工数=${line.yearHours}h / ${line.formula}`);

// ---- ケース3: C に分類し理由を書けば注意は出ない ----
const cWarn = leverageWarning({ type: "C" as TaskType, text: lineText, manualReason: "退会理由の分類データが無く、まず 1 か月だけ人が聞き取る必要があるため", ongoingHoursPerMonth: 8 });
check("C + 理由あり: 注意なし", cWarn === null, `注意=${cWarn ?? "なし"}`);
const cNoReason = leverageWarning({ type: "C" as TaskType, text: lineText, manualReason: null, ongoingHoursPerMonth: 8 });
check("C + 理由なし: 注意あり", cNoReason !== null, cNoReason ?? "注意なし");

// ---- ケース4: B の継続工数が多すぎれば C ----
const heavyB = checkType("B", { ...lineInput, ongoingHoursPerMonth: 16 });
check("継続 16h の B: C に降格", heavyB.type === "C", `分類=${heavyB.type} 注記=${heavyB.note ?? "なし"}`);


// ---- ケース5: 否定文は拾わない ----
const negations = [
  "声かけを増やすより、自分で選べる状態を作る方が人の仕事を増やさずに効く",
  "毎日 SNS 投稿を前提にしない。検索から入る記事を資産として積み上げる",
  "スタッフが毎回案内しなくても始められるよう、館内に掲示する",
  "個別 LINE を送る代わりに、よくある質問ページで自己解決できるようにする",
];
for (const text of negations) {
  const hit = findDiscouraged(text);
  check(`否定文を拾わない: ${text.slice(0, 18)}…`, hit.length === 0, hit.map((h) => h.label).join("、") || "検知なし");
}

// ---- ケース6: 否定語が別の文にあっても、実行する文は拾う ----
const mixed = "毎日 SNS 投稿は前提にしない。来館が減った会員 31 名に個別 LINE を送る";
check("別文の実行内容は拾う", findDiscouraged(mixed).some((h) => h.id === "individual_line"), findDiscouraged(mixed).map((h) => h.label).join("、") || "検知なし");

console.log(failed === 0 ? "\nすべて期待どおりです。" : `\n${failed} 件が期待と違います。`);
process.exit(failed === 0 ? 0 : 1);
