/**
 * 経営判断 3 軸（老子 / 孫子 / 孔子）の動作確認。
 *   npm run frames:check
 * ご指定の提案例 3 つと同じ評価が出るか、上限ルールが効くかを確かめる。
 */
import { compareForRanking, evaluateFrames, frameWarning, type FrameInput } from "../src/analysis/frames";

let failed = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`${ok ? "OK  " : "NG  "} ${label}\n     ${detail}`);
  if (!ok) failed++;
}

const marks = (i: FrameInput) => {
  const r = evaluateFrames(i);
  return { r, line: `老子 ${r.laozi.mark} / 孫子 ${r.sunzi.mark} / 孔子 ${r.confucius.mark}（合計 ${r.total} 点）` };
};

// ---- 提案例 1: 来館が減った会員へ毎週 LINE → C / 老子 × / 孫子 △ / 孔子 ○ ----
const weeklyLine: FrameInput = {
  taskType: "C",
  ongoingHoursPerMonth: 8, asset: 1, automation: 1, selfService: 1,
  staffDependency: 5, ownerDependency: 3, initialHours: 2,
  headOnCompetition: 3, usesStrength: 2, winnableSegment: 3, priceCompetition: false,
  customerTrust: 4, staffBurden: 3, brandLongTerm: 3, shortTermBias: false,
};
const a = marks(weeklyLine);
check("例1 来館が減った会員へ毎週 LINE", a.r.laozi.mark === "×" && a.r.sunzi.mark === "△" && a.r.confucius.mark === "○", a.line);
check("例1 × があるので注意文が出る", frameWarning(a.r) !== null, (frameWarning(a.r) ?? "注意なし").slice(0, 80) + "…");

// ---- 提案例 2: 目的別セルフメニューを Web 化 → A / 3 軸とも ◎ ----
const selfMenu: FrameInput = {
  taskType: "A",
  ongoingHoursPerMonth: 1, asset: 5, automation: 3, selfService: 5,
  staffDependency: 2, ownerDependency: 1, initialHours: 8,
  headOnCompetition: 1, usesStrength: 5, winnableSegment: 5, priceCompetition: false,
  customerTrust: 5, staffBurden: 1, brandLongTerm: 5, shortTermBias: false,
};
const b = marks(selfMenu);
check("例2 目的別セルフメニューを Web 化", b.r.laozi.mark === "◎" && b.r.sunzi.mark === "◎" && b.r.confucius.mark === "◎", b.line);
check("例2 注意文は出ない", frameWarning(b.r) === null, frameWarning(b.r) ?? "注意なし");

// ---- 提案例 3: SEO・MEO・FAQ を積み上げる → A / 老子 ◎ / 孫子 ◎ / 孔子 ○ ----
const seo: FrameInput = {
  taskType: "A",
  ongoingHoursPerMonth: 0.5, asset: 5, automation: 3, selfService: 5,
  staffDependency: 1, ownerDependency: 2, initialHours: 6,
  headOnCompetition: 1, usesStrength: 5, winnableSegment: 4, priceCompetition: false,
  customerTrust: 3, staffBurden: 2, brandLongTerm: 5, shortTermBias: false,
};
const c = marks(seo);
check("例3 SEO・MEO・FAQ を積み上げる", c.r.laozi.mark === "◎" && c.r.sunzi.mark === "◎" && c.r.confucius.mark === "○", c.line);

// ---- 上限ルール ----
const pricePush: FrameInput = { ...selfMenu, priceCompetition: true };
check("価格競争なら孫子は △ 止まり", marks(pricePush).r.sunzi.mark === "△", marks(pricePush).r.sunzi.cap ?? "上限なし");

const headOn: FrameInput = { ...selfMenu, headOnCompetition: 5, priceCompetition: false };
check("大手と同じ土俵なら孫子は △ 止まり", marks(headOn).r.sunzi.mark === "△", marks(headOn).r.sunzi.cap ?? "上限なし");

const shortTerm: FrameInput = { ...selfMenu, shortTermBias: true };
check("短期利益偏重なら孔子は △ 止まり", marks(shortTerm).r.confucius.mark === "△", marks(shortTerm).r.confucius.cap ?? "上限なし");

const heavyStaff: FrameInput = { ...selfMenu, staffBurden: 5 };
check("社員負担が大きければ孔子は △ 止まり", marks(heavyStaff).r.confucius.mark === "△", marks(heavyStaff).r.confucius.cap ?? "上限なし");

const cType: FrameInput = { ...selfMenu, taskType: "C" };
check("C 分類なら老子は △ 止まり", marks(cType).r.laozi.mark === "△", marks(cType).r.laozi.cap ?? "上限なし");

// ---- 並び順: × のある施策は下に落ちる ----
// 「人は楽だが大手と正面衝突し、短期の売上だけを狙う」施策。仕組みスコアは高い
const efficientButWrong: FrameInput = {
  taskType: "A",
  ongoingHoursPerMonth: 0, asset: 5, automation: 5, selfService: 5,
  staffDependency: 1, ownerDependency: 1, initialHours: 2,
  headOnCompetition: 5, usesStrength: 1, winnableSegment: 1, priceCompetition: true,
  customerTrust: 1, staffBurden: 1, brandLongTerm: 1, shortTermBias: true,
};
const wrong = { frames: evaluateFrames(efficientButWrong), leverageScore: 20 };
const right = { frames: evaluateFrames(selfMenu), leverageScore: 2.5 };
const order = [wrong, right].sort(compareForRanking);
check(
  "仕組みスコアが高くても、× のある施策は下に落ちる",
  order[0] === right,
  `1位=${order[0] === right ? "セルフメニュー（スコア 2.5）" : "値下げ施策（スコア 20）"} / 値下げ施策の評価: 老子 ${wrong.frames.laozi.mark} 孫子 ${wrong.frames.sunzi.mark} 孔子 ${wrong.frames.confucius.mark}`,
);

// 同じく × 無しどうしなら、3 軸の合計点が高い方が上
const orderB = [{ frames: c.r, leverageScore: 3.75 }, { frames: b.r, leverageScore: 2.5 }].sort(compareForRanking);
check("× が無ければ 3 軸の合計点が高い方が上", orderB[0].frames.total === b.r.total, `セルフメニュー ${b.r.total} 点 vs SEO ${c.r.total} 点`);

console.log(failed === 0 ? "\nすべて期待どおりです。" : `\n${failed} 件が期待と違います。`);
process.exit(failed === 0 ? 0 : 1);
