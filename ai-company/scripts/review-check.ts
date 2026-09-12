/**
 * 5 人の分析（現状・傾向・問題点・改善案）と総合レポートの動作確認。
 *   npm run review:check
 */
import { reviewAll } from "../src/analysis/tool-review";
import { compare, toPeriodKey } from "../src/analysis/compare";
import { normalizeInputData } from "../src/metrics";

let failed = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}\n     ${detail}`);
  if (!ok) failed++;
}

const build = (values: Record<string, number>, notes: Record<string, string> = {}, keywords: unknown[] = []) =>
  normalizeInputData({ values, notes, keywords });

// ---- 前月と比べられるように、2 か月分を用意する ----
const prev = build({
  gsc_impressions: 20000, gsc_clicks: 900, gsc_position: 8,
  gbp_impressions: 16000, gbp_website_clicks: 700,
  ga4_users: 1800, ga4_pv_trial: 400, ga4_cta_trial: 70,
  visits: 30, new_members: 16, churn: 12, members: 410,
});
const now = build(
  {
    // 検索: 表示は増えたのにクリックは減った。順位も 10 位より下
    gsc_impressions: 24000, gsc_clicks: 700, gsc_position: 14,
    // 地図: 表示に対してサイトクリックが 1% 台、口コミも少ない
    gbp_impressions: 18000, gbp_website_clicks: 200, gbp_reviews_total: 8, gbp_rating: 4.3,
    // GA4: 見学ページ到達 5%、CTA 押下 5%
    ga4_users: 2000, ga4_pv_trial: 100, ga4_cta_trial: 5, ga4_pv_price: 300,
    // Clarity: ボタンまで届いていない
    clarity_scroll: 42, clarity_cta_reach: 25, clarity_cta_clicks: 10, clarity_dead_clicks: 30,
    // hacomono: 来館率も入会率も低い
    inquiries: 50, book_web: 20, book_tel: 5, visits: 15, trials: 3, direct_joins: 1, trial_joins: 1,
    new_members: 8, churn: 14, members: 404,
  },
  { heatmap: "料金を見た直後に離脱が多い。" },
  [{ keyword: "高知 ジム", impressions: 5000, clicks: 60, ctr: null, position: 15 }],
);

const key = toPeriodKey("2027 年 3 月")!;
const cmp = compare(now, key, [{ periodKey: toPeriodKey("2027 年 2 月")!, input: prev }]);
const r = reviewAll(now, cmp);

console.log("\n===== 5 人の判定 =====");
for (const rev of r.reviews) {
  console.log(`\n■ ${rev.name}（${rev.verdict}）`);
  console.log(`  現状 ${rev.current.length} 行 / 傾向 ${rev.trend.length} 行 / 問題点 ${rev.findings.length} 件 / 不足 ${rev.missing.length} 件`);
  for (const f of rev.findings) console.log(`   - [重さ ${f.weight}] ${f.problem.slice(0, 56)}…`);
}

console.log("\n===== 総合 =====");
console.log(r.headline);
for (const a of r.actions) console.log(`  ${a.rank}. ${a.action.slice(0, 60)}…\n     ← ${a.from}: ${a.why.slice(0, 50)}…`);

console.log("\n===== 確認 =====");
const byId = Object.fromEntries(r.reviews.map((x) => [x.id, x]));
check("5 人すべてが判定される", r.reviews.length === 5, r.reviews.map((x) => x.name).join("・"));
check("検索: 表示増・クリック減を拾う", byId.search.findings.some((f) => f.problem.includes("選ばれていません")), byId.search.findings.map((f) => f.problem.slice(0, 22)).join(" / "));
check("検索: 順位 14 位を問題にする", byId.search.findings.some((f) => f.problem.includes("14 位")), byId.search.verdict);
check("地図: クリック率の低さを拾う", byId.map.findings.some((f) => f.problem.includes("だけです")), byId.map.verdict);
check("GA4: 見学ページ到達率の低さを拾う", byId.site.findings.some((f) => f.problem.includes("入口で終わって")), byId.site.verdict);
check("Clarity: ボタンに届いていないことを拾う", byId.behavior.findings.some((f) => f.problem.includes("気づかないまま")), byId.behavior.verdict);
check("hacomono: 純減を拾う", byId.booking.findings.some((f) => f.problem.includes("純減")), byId.booking.verdict);
check("今月やるべきことは最大 3 つ", r.actions.length > 0 && r.actions.length <= 3, `${r.actions.length} 件`);
check("同じ担当に偏らない", new Set(r.actions.map((a) => a.from)).size === r.actions.length, r.actions.map((a) => a.from).join("・"));
check("いちばん詰まっている段階は上流から選ぶ", r.weakest === "search", `weakest=${r.weakest}`);
check("傾向は前月比が入る", byId.search.trend.length > 0, byId.search.trend[0] ?? "なし");

// ---- 数字が無い担当は「データなし」 ----
const only = build({ gsc_impressions: 10000, gsc_clicks: 500 });
const r2 = reviewAll(only, null);
check(
  "入力の無い担当はデータなしになる",
  r2.reviews.filter((x) => x.verdict === "no_data").length === 4,
  r2.noDataOwners.join("・"),
);
check("数字が 1 つも無ければ、その旨を出す", reviewAll(build({}), null).headline.includes("分析できません"), reviewAll(build({}), null).headline);

// ---- 良い数字なら問題を作らない ----
const good = build({
  gsc_impressions: 30000, gsc_clicks: 2400, gsc_position: 4,
  gbp_impressions: 20000, gbp_website_clicks: 1400, gbp_reviews_total: 90, gbp_rating: 4.7,
  ga4_users: 2500, ga4_pv_trial: 700, ga4_cta_trial: 180,
  clarity_scroll: 78, clarity_cta_reach: 70, clarity_cta_clicks: 120, clarity_dead_clicks: 2,
  inquiries: 60, book_web: 40, book_tel: 8, visits: 46, trials: 20, direct_joins: 12, trial_joins: 14,
  new_members: 26, churn: 9, members: 430,
});
const r3 = reviewAll(good, null);
check("良い数字なら問題点を作らない", r3.actions.length === 0, `${r3.actions.length} 件 / ${r3.headline.slice(0, 40)}`);
check("良い数字なら判定は good", r3.reviews.every((x) => x.verdict === "good"), r3.reviews.map((x) => `${x.name}=${x.verdict}`).join(" "));

console.log(failed === 0 ? "\nすべて期待どおりです。" : `\n${failed} 件が期待と違います。`);
process.exit(failed === 0 ? 0 : 1);
