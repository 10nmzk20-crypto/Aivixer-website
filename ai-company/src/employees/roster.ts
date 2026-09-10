import { ANALYSIS_PROMPTS } from "./prompts-analysis";
import { COMMANDER_PROMPTS } from "./prompts-command";
import { EXECUTION_PROMPTS } from "./prompts-execution";

export type Department = "analysis" | "command" | "execution";

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

const ANALYSTS: Array<[string, string]> = [
  ["data", "データ分析担当"],
  ["marketing", "マーケ分析担当"],
  ["customer", "顧客・継続分析担当"],
  ["sales", "営業・入会分析担当"],
  ["web", "Web・SEO 分析担当"],
  ["product", "商品・料金分析担当"],
  ["profit", "収益分析担当"],
  ["competitor", "競合・市場分析担当"],
];

const EXECUTORS: Array<[string, string, string]> = [
  ["planner", "企画設計担当", "plan"],
  ["content", "コンテンツ制作担当", "content"],
  ["webdev", "Web 実装担当", "web_spec"],
  ["growth", "集客実行担当", "growth_plan"],
  ["line", "LINE・営業担当", "line_script"],
  ["retention", "会員継続担当", "retention_plan"],
  ["kpi", "KPI 検証担当", "kpi_review"],
  ["knowledge", "ナレッジ担当", "knowledge_note"],
];

export const EMPLOYEES: EmployeeDef[] = [
  ...ANALYSTS.map(([id, name]) => ({ id, name, department: "analysis" as const, systemPrompt: ANALYSIS_PROMPTS[id] })),
  { id: "commander", name: "経営司令塔", department: "command", systemPrompt: COMMANDER_PROMPTS.synthesize },
  ...EXECUTORS.map(([id, name, outputKind]) => ({ id, name, department: "execution" as const, systemPrompt: EXECUTION_PROMPTS[id], outputKind })),
];

export const EMPLOYEE_MAP: Record<string, EmployeeDef> = Object.fromEntries(EMPLOYEES.map((e) => [e.id, e]));
export const ANALYST_IDS = ANALYSTS.map(([id]) => id);
/** 司令塔が施策の担当として選べる実行 AI（KPI 検証・ナレッジは施策の担当にはならない） */
export const EXECUTOR_IDS = EXECUTORS.map(([id]) => id).filter((id) => id !== "kpi" && id !== "knowledge");

export function employeeName(id: string): string {
  return EMPLOYEE_MAP[id]?.name ?? id;
}
