import type { NormalizedInput } from "../metrics";
import type { DerivedKpi } from "./derived";

/**
 * AI が挙げた数字が、入力された数値かシステムが計算した KPI に実在するかを確かめる。
 * 実在しない数字は「未確認」として印を付け、画面と保存データに残す。
 * （AI が数字を作っていないかを、人が見なくても分かるようにするため）
 */

export interface NumberCheck {
  /** 見つからなかった数字（そのまま表示する） */
  unverified: string[];
  /** 確かめた数字の個数 */
  checked: number;
}

/** 文章から数字らしき並びを取り出す（1,234 / 12.5 / 29% など） */
function extractNumbers(text: string): string[] {
  const out: string[] = [];
  const re = /-?\d[\d,，]*(?:\.\d+)?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.push(m[0]);
  return out;
}

const toNumber = (s: string): number | null => {
  const n = Number(s.replace(/[,，]/g, ""));
  return Number.isFinite(n) ? n : null;
};

/** 年・月・日付・順位など、照合しても意味がない数字は除く */
function isIgnorable(raw: string, text: string, index: number): boolean {
  const n = toNumber(raw);
  if (n === null) return true;
  if (Number.isInteger(n) && n >= 1900 && n <= 2100) return true; // 年
  if (Math.abs(n) <= 12 && /月|日|回目|段階|位|つ|名の内訳/.test(text.slice(index + raw.length, index + raw.length + 3))) return true;
  return false;
}

/**
 * 許容する数字の集合を作る。
 * 入力値そのもの、計算済み KPI の値、およびそれらを四捨五入した値を許す。
 */
function allowedNumbers(input: NormalizedInput, kpis: DerivedKpi[], extra: number[]): Set<number> {
  const set = new Set<number>();
  const add = (n: number | null | undefined) => {
    if (n === null || n === undefined || !Number.isFinite(n)) return;
    set.add(n);
    set.add(Math.round(n));
    set.add(Math.round(n * 10) / 10);
  };
  for (const v of Object.values(input.values)) add(v);
  for (const k of input.keywords) {
    add(k.impressions);
    add(k.clicks);
    add(k.ctr);
    add(k.position);
  }
  for (const k of kpis) add(k.value);
  for (const n of extra) add(n);
  // 入力値どうしの合計（例: 予約数の合計）も許す
  const values = Object.values(input.values);
  for (let i = 0; i < values.length; i++) {
    for (let j = i + 1; j < values.length; j++) add(values[i] + values[j]);
  }
  return set;
}

/**
 * 文章に出てくる数字を照合する。
 * 割合（%）は小数第 1 位まで、それ以外は完全一致で確かめる。
 */
export function checkNumbers(texts: string[], input: NormalizedInput, kpis: DerivedKpi[], extra: number[] = []): NumberCheck {
  const allowed = allowedNumbers(input, kpis, extra);
  const unverified = new Set<string>();
  let checked = 0;

  for (const text of texts) {
    if (!text) continue;
    const re = /-?\d[\d,，]*(?:\.\d+)?/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const raw = m[0];
      if (isIgnorable(raw, text, m.index)) continue;
      const n = toNumber(raw);
      if (n === null) continue;
      checked++;
      if (allowed.has(n) || allowed.has(Math.round(n)) || allowed.has(Math.round(n * 10) / 10)) continue;
      // 割合は丸め方の違いを許す（±0.2 まで）
      const nearby = [...allowed].some((a) => Math.abs(a - n) <= 0.2);
      if (nearby) continue;
      unverified.add(raw);
    }
  }
  return { unverified: [...unverified].slice(0, 20), checked };
}

export { extractNumbers };
