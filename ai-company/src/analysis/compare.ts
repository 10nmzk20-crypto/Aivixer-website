import type { NormalizedInput } from "../metrics";
import { metricLabel } from "../metrics";
import { computeDerived, type DerivedKpi } from "./derived";

/** 前月・過去平均との比較。数字はすべてコードで計算する（AI には計算させない） */

export interface ComparisonRow {
  id: string;
  label: string;
  unit: string;
  current: number | null;
  previous: number | null;
  /** 増減数 */
  delta: number | null;
  /** 増減率（%）。前月が 0 なら null */
  deltaPct: number | null;
  /** 過去 3 か月平均 */
  avg3: number | null;
  /** 過去 6 か月平均 */
  avg6: number | null;
  kind: "input" | "derived";
}

export interface ComparisonResult {
  /** 比較できた前月の対象月（例: 2026-07）。無ければ null */
  previousPeriod: string | null;
  rows: ComparisonRow[];
}

const round = (n: number) => Math.round(n * 10) / 10;

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return round(values.reduce((a, b) => a + b, 0) / values.length);
}

/** 対象月（2026-08）の 1 か月前を返す */
export function previousPeriodKey(periodKey: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(periodKey);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = new Date(Date.UTC(y, mo - 1, 1));
  d.setUTCMonth(d.getUTCMonth() - 1);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export interface HistoryEntry {
  periodKey: string;
  input: NormalizedInput;
}

/**
 * 今回の入力と、過去の案件（新しい順）を比べる。
 * history は今回より前の月だけを、新しい順で渡すこと。
 */
export function compare(current: NormalizedInput, currentPeriodKey: string | null, history: HistoryEntry[]): ComparisonResult {
  const prevKey = currentPeriodKey ? previousPeriodKey(currentPeriodKey) : null;
  // 前月の案件があればそれを使う。無ければ「1 つ前の案件」を前月扱いにしない（月が飛ぶと誤解を生むため）
  const prev = prevKey ? history.find((h) => h.periodKey === prevKey) : undefined;

  const currentDerived = new Map(computeDerived(current).map((k) => [k.id, k]));
  const prevDerived = prev ? new Map(computeDerived(prev.input).map((k) => [k.id, k])) : new Map<string, DerivedKpi>();
  const historyDerived = history.map((h) => new Map(computeDerived(h.input).map((k) => [k.id, k])));

  const rows: ComparisonRow[] = [];

  // 入力値の比較
  const ids = [...new Set([...Object.keys(current.values), ...(prev ? Object.keys(prev.input.values) : [])])];
  for (const id of ids) {
    const cur = current.values[id] ?? null;
    const pre = prev?.input.values[id] ?? null;
    rows.push({
      id,
      label: metricLabel(id),
      unit: "",
      current: cur,
      previous: pre,
      delta: cur !== null && pre !== null ? round(cur - pre) : null,
      deltaPct: cur !== null && pre !== null && pre !== 0 ? round(((cur - pre) / pre) * 100) : null,
      avg3: average(history.slice(0, 3).map((h) => h.input.values[id]).filter((n): n is number => n !== undefined)),
      avg6: average(history.slice(0, 6).map((h) => h.input.values[id]).filter((n): n is number => n !== undefined)),
      kind: "input",
    });
  }

  // 派生 KPI の比較
  for (const [id, kpi] of currentDerived) {
    const pre = prevDerived.get(id)?.value ?? null;
    const cur = kpi.value;
    rows.push({
      id,
      label: kpi.label,
      unit: kpi.unit,
      current: cur,
      previous: pre,
      delta: cur !== null && pre !== null ? round(cur - pre) : null,
      deltaPct: cur !== null && pre !== null && pre !== 0 ? round(((cur - pre) / pre) * 100) : null,
      avg3: average(historyDerived.slice(0, 3).map((m) => m.get(id)?.value).filter((n): n is number => n !== null && n !== undefined)),
      avg6: average(historyDerived.slice(0, 6).map((m) => m.get(id)?.value).filter((n): n is number => n !== null && n !== undefined)),
      kind: "derived",
    });
  }

  return { previousPeriod: prev ? prev.periodKey : null, rows };
}

/** 対象期間の文字列（「2026 年 8 月」など）から 2026-08 を作る */
export function toPeriodKey(label: string | null | undefined): string | null {
  if (!label) return null;
  const t = label.replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  const ym = /(\d{4})\s*[-/年]\s*(\d{1,2})/.exec(t);
  if (ym) return `${ym[1]}-${String(Number(ym[2])).padStart(2, "0")}`;
  const iso = /^(\d{4})-(\d{2})$/.exec(t.trim());
  if (iso) return `${iso[1]}-${iso[2]}`;
  return null;
}
