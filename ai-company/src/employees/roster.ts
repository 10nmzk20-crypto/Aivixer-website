import { ANALYSIS_PROMPTS } from "./prompts-analysis";
import { COMMANDER_PROMPTS } from "./prompts-command";
import { EXECUTION_PROMPTS } from "./prompts-execution";

export type Department = "analysis" | "command" | "execution" | "verification";

export interface EmployeeDef {
  id: string;
  name: string;
  department: Department;
  /** 役割説明（AI に渡す system prompt） */
  systemPrompt: string;
  /** 成果物の種類（実行部のみ） */
  outputKind?: string;
}

/** ViXer に共通する前提。すべての AI 社員のプロンプトの先頭に付ける。 */
export const COMPANY_CONTEXT = `あなたは「Life Design ViXer」（高知市のフィットネスジム）の社内 AI 社員です。
ViXer の基本情報:
- 高知市で運営するフィットネスジム。月会費制。プランは 月会費 / 年間プラン / DAY / ナイト / パーソナル / 30日お試し がある。
- 主要な入会導線は「問い合わせ → 見学・体験 → 30日お試し または 本入会」。Web からの直接入会は主要導線として扱わない。
- 経営判断は代表が行う。AI は分析・文章作成・企画・仕様作成までを担当し、HP 公開・広告出稿・SNS 投稿・LINE 送信・料金変更・会員データ変更は必ず代表の承認と人の操作を経る。
- 会員名などの個人情報は扱わない。集計値（人数・金額・率）だけを扱う。

共通ルール:
- 日本語で、専門用語を避け、経営者がそのまま読める文章で書く。
- 数字を根拠に「事実」と「仮説」をはっきり分ける。データにない推測は仮説として書く。
- 存在しない数字を作らない。入力にない数値が必要なら「追加で必要なデータ」として挙げる。
- 冗長にしない。要点を先に、理由は短く。`;

/**
 * AI 社員 5 人。1 ツール 1 担当。
 * 「現状・傾向・問題点・改善案」はアプリが数字から組み立てる（src/analysis/tool-review.ts）。
 * 5 人分をまとめた「今月やるべきこと」もアプリが計算するので、まとめ役の社員は置かない。
 */
const ANALYSTS: Array<[string, string]> = [
  ["search", "Search Console 担当"], // サイトに来る「前」
  ["map", "Google ビジネスプロフィール担当"], // 地図で見つけられたか
  ["site", "GA4 担当"], // 「何が」起きたか
  ["behavior", "Clarity 担当"], // 「なぜ」そうなったか
  ["booking", "hacomono 担当"], // 実際に予約・入会したか
];

export const EMPLOYEES: EmployeeDef[] = ANALYSTS.map(([id, name]) => ({
  id,
  name,
  department: "analysis" as const,
  systemPrompt: ANALYSIS_PROMPTS[id],
}));

/**
 * 以前の体制で作られた記録を読むための名前表。
 * 過去の分析や施策が「content」のような id のまま表示されないようにする。
 */
const LEGACY_NAMES: Record<string, string> = {
  commander: "経営まとめ担当（旧）",
  data: "データ分析担当（旧）", marketing: "マーケ分析担当（旧）", customer: "顧客・継続分析担当（旧）",
  sales: "営業・入会分析担当（旧）", web: "Web・SEO 分析担当（旧）", product: "商品・料金分析担当（旧）",
  profit: "収益分析担当（旧）", competitor: "競合・市場分析担当（旧）",
  planner: "仕組み設計担当（旧）", content: "資産コンテンツ担当（旧）", webdev: "Web 実装担当（旧）",
  growth: "資産型集客担当（旧）", line: "摩擦削減担当（旧）", retention: "セルフ利用設計担当（旧）",
  kpi: "KPI 検証担当（旧）", improve: "自動化・改善担当（旧）", knowledge: "ナレッジ担当（旧）",
};

export const EMPLOYEE_MAP: Record<string, EmployeeDef> = Object.fromEntries(EMPLOYEES.map((e) => [e.id, e]));
export const ANALYST_IDS: string[] = ANALYSTS.map(([id]) => id);

/**
 * 施策の担当。MVP では施策管理を画面から外しているので使わない。
 * 施策の流れ（採用 → 成果物 → KPI 検証）のコードは残してあり、
 * 外部 AI を接続して再開するときにここへ担当を戻す。
 */
export const EXECUTOR_IDS: string[] = [];

export function employeeName(id: string): string {
  return EMPLOYEE_MAP[id]?.name ?? LEGACY_NAMES[id] ?? id;
}
