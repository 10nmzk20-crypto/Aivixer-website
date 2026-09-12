/**
 * 「新しい分析」で入力する項目の定義。
 *
 * ViXer の集客導線に合わせて 7 つのブロックに分けている:
 *   Google 検索・マップ・その他認知 → ホームページ → 見学・体験予約 → 実際の見学・体験
 *   → 30 日お試し または 本入会 → 30 日お試しから本入会
 *
 * `source` は「どの計測ツールの数字か」。集計方法が違う数字を同じものとして扱わないために使い、
 * 将来 API 連携するときの取り込み先にもなる。
 */

export type MetricSource = "manual" | "gbp" | "gsc" | "ga4" | "clarity" | "internal";

export interface MetricDef {
  /** 分析の判定に使う項目か。false のものは「その他」に畳んで、入力の手数を減らす */
  optional?: boolean;
  id: string;
  label: string;
  unit: string;
  source: MetricSource;
  /** 入力欄の下に出す補足 */
  hint?: string;
}

export interface MetricGroupDef {
  id: string;
  label: string;
  /** このブロックが導線のどこを見ているか */
  description: string;
  source: MetricSource;
  /** 最初から開いておくか（基本項目だけ true） */
  open: boolean;
  metrics: MetricDef[];
}

/** ① 基本（最初に開いているブロック） */
const BASIC: MetricDef[] = [
  { id: "visits", label: "実際の見学・体験人数", unit: "名", source: "internal", hint: "予約数ではなく、実際に来た人数" },
  { id: "trials", label: "30日お試し 開始人数", unit: "名", source: "internal" },
  { id: "direct_joins", label: "見学から直接 本入会", unit: "名", source: "internal" },
  { id: "trial_joins", label: "30日お試しから 本入会", unit: "名", source: "internal" },
  { id: "new_members", label: "新規入会者数（合計）", unit: "名", source: "internal" },
  { id: "churn", label: "退会者数", unit: "名", source: "internal" },
  { id: "members", label: "月末会員数", unit: "名", source: "internal" },
  { id: "sales", optional: true, label: "売上", unit: "円", source: "internal" },
];

/** ② Google ビジネスプロフィール */
const GBP: MetricDef[] = [
  { id: "gbp_impressions", label: "プロフィール表示回数（合計）", unit: "回", source: "gbp" },
  { id: "gbp_impressions_search", label: "Google 検索での表示回数", unit: "回", source: "gbp" },
  { id: "gbp_impressions_maps", label: "Google マップでの表示回数", unit: "回", source: "gbp" },
  { id: "gbp_website_clicks", label: "Web サイトクリック数", unit: "回", source: "gbp" },
  { id: "gbp_calls", label: "電話件数", unit: "件", source: "gbp" },
  { id: "gbp_directions", label: "ルート検索数", unit: "回", source: "gbp" },
  { id: "gbp_reviews_total", label: "口コミ件数（累計）", unit: "件", source: "gbp" },
  { id: "gbp_rating", label: "口コミ平均評価", unit: "点", source: "gbp" },
  { id: "gbp_reviews_new", optional: true, label: "当月の新規口コミ数", unit: "件", source: "gbp" },
];

/** ③ Google Search Console */
const GSC: MetricDef[] = [
  { id: "gsc_impressions", label: "検索表示回数", unit: "回", source: "gsc" },
  { id: "gsc_clicks", label: "検索クリック数", unit: "回", source: "gsc" },
  { id: "gsc_ctr", label: "検索 CTR", unit: "%", source: "gsc", hint: "空欄なら表示回数とクリック数から計算します" },
  { id: "gsc_position", label: "平均掲載順位", unit: "位", source: "gsc" },
];

/** ④ Google Analytics 4 */
const GA4: MetricDef[] = [
  { id: "ga4_users", label: "ユーザー数", unit: "人", source: "ga4" },
  { id: "ga4_sessions", optional: true, label: "セッション数", unit: "回", source: "ga4" },
  { id: "ga4_new_users", optional: true, label: "新規ユーザー数", unit: "人", source: "ga4" },
  { id: "ga4_organic_users", optional: true, label: "Google 自然検索からのユーザー数", unit: "人", source: "ga4" },
  { id: "ga4_maps_users", optional: true, label: "Google マップ等からの流入数", unit: "人", source: "ga4", hint: "分かる場合のみ" },
  { id: "ga4_pv_top", label: "トップページ閲覧数", unit: "回", source: "ga4" },
  { id: "ga4_pv_price", label: "料金ページ閲覧数", unit: "回", source: "ga4" },
  { id: "ga4_pv_trial", label: "見学・体験ページ閲覧数", unit: "回", source: "ga4" },
  { id: "ga4_cta_trial", label: "見学・体験 CTA クリック数", unit: "回", source: "ga4" },
  { id: "ga4_cta_line", optional: true, label: "LINE クリック数", unit: "回", source: "ga4" },
  { id: "ga4_cta_tel", optional: true, label: "電話クリック数", unit: "回", source: "ga4" },
  { id: "ga4_booking_page", optional: true, label: "Web 予約ページへの遷移数", unit: "回", source: "ga4" },
];

/** ⑤ ヒートマップ・行動分析（Microsoft Clarity など） */
const CLARITY: MetricDef[] = [
  { id: "clarity_scroll", label: "平均スクロール率", unit: "%", source: "clarity" },
  { id: "clarity_cta_reach", label: "CTA 到達率", unit: "%", source: "clarity" },
  { id: "clarity_cta_clicks", label: "主要 CTA クリック数", unit: "回", source: "clarity" },
  { id: "clarity_dead_clicks", label: "デッドクリック数", unit: "回", source: "clarity" },
  { id: "clarity_rage_clicks", label: "レイジクリック数", unit: "回", source: "clarity" },
];

/** ⑥ 見学・体験予約（予約数と実来館数を必ず分ける） */
const BOOKING: MetricDef[] = [
  { id: "inquiries", label: "問い合わせ数（合計）", unit: "件", source: "internal" },
  { id: "book_web", label: "Web からの見学・体験予約数", unit: "件", source: "internal" },
  { id: "book_tel", label: "電話からの見学・体験予約数", unit: "件", source: "internal" },
  { id: "book_line", label: "LINE からの見学・体験予約数", unit: "件", source: "internal" },
  { id: "book_other", label: "紹介等その他からの予約数", unit: "件", source: "internal" },
];

/** ⑦ 認知経路（見学・体験者に聞いた「何で知りましたか」） */
const AWARENESS: MetricDef[] = [
  { id: "aw_google_search", label: "Google 検索", unit: "名", source: "internal" },
  { id: "aw_google_maps", label: "Google マップ", unit: "名", source: "internal" },
  { id: "aw_billboard", label: "大型ビジョン", unit: "名", source: "internal" },
  { id: "aw_referral", label: "紹介", unit: "名", source: "internal" },
  { id: "aw_instagram", label: "Instagram", unit: "名", source: "internal" },
  { id: "aw_sns_other", label: "その他 SNS", unit: "名", source: "internal" },
  { id: "aw_passerby", label: "通りがかり", unit: "名", source: "internal" },
  { id: "aw_other", label: "その他", unit: "名", source: "internal" },
  { id: "aw_unknown", label: "不明", unit: "名", source: "internal" },
];

export const METRIC_GROUPS: MetricGroupDef[] = [
  // 並びは集客の流れ順。見つけてもらう → 見てもらう → 迷いを見る → 決まったか。
  // 各ブロックは担当が 1 人ずつ決まっている（GROUP_OWNER）。
  { id: "gsc", label: "① Google Search Console", description: "検索担当が見ます。どんな言葉で検索され、何位に出て、どれだけ押されたか。", source: "gsc", open: true, metrics: GSC },
  { id: "gbp", label: "② Google ビジネスプロフィール", description: "地図担当が見ます。地図と検索で見つけてもらえたか、そこから何をされたか。", source: "gbp", open: false, metrics: GBP },
  { id: "ga4", label: "③ Google Analytics 4", description: "サイト担当が見ます。何人来て、どのページを見て、どのボタンが押されたか。", source: "ga4", open: false, metrics: GA4 },
  { id: "clarity", label: "④ ヒートマップ・行動分析", description: "行動担当が見ます。どこまで読まれ、どこで迷い、つまずいたか。", source: "clarity", open: false, metrics: CLARITY },
  { id: "basic", label: "⑤ 予約・入会・会員", description: "予約・入会担当が見ます。実際に何人来て、何人が入会したか。ここだけでも分析できます。", source: "internal", open: true, metrics: BASIC },
  { id: "booking", label: "⑤-2 見学・体験予約の経路", description: "予約・入会担当が見ます。予約が入った経路と件数。実来館数と比べて来館率を出します。", source: "internal", open: false, metrics: BOOKING },
];

/** 全項目を平らにした一覧（id で引くため） */
/**
 * どの入力ブロックを、どの AI 社員が担当するか。
 * 1 人 1 ツール。数字が 1 つも入っていないツールの担当は呼ばない。
 */
export const GROUP_OWNER: Record<string, string> = {
  gsc: "search", // Search Console … サイトに来る「前」
  ga4: "site", // GA4 … 「何が」起きたか
  clarity: "behavior", // ヒートマップ・録画 … 「なぜ」そうなったか
  gbp: "map", // Google ビジネスプロフィール … 地図で見つけられたか
  basic: "booking", // 予約・入会・会員 … 実際にどうなったか
  booking: "booking",
  awareness: "booking",
};

/** 担当ごとの「何を答える人か」。画面とレポートの見出しに使う */
export const OWNER_QUESTION: Record<string, { tool: string; question: string }> = {
  search: { tool: "Google Search Console", question: "どんな言葉で検索され、何位だったか" },
  site: { tool: "Google Analytics 4", question: "何人来て、どこを見て、何を押したか" },
  behavior: { tool: "ヒートマップ・録画", question: "なぜそこで止まったか" },
  map: { tool: "Google ビジネスプロフィール", question: "地図で見つけてもらえたか" },
  booking: { tool: "予約システム・受付", question: "実際に予約・入会したか" },
};

export const ALL_METRICS: MetricDef[] = METRIC_GROUPS.flatMap((g) => g.metrics);
export const METRIC_MAP: Record<string, MetricDef> = Object.fromEntries(ALL_METRICS.map((m) => [m.id, m]));
export const METRIC_GROUP_OF: Record<string, string> = Object.fromEntries(METRIC_GROUPS.flatMap((g) => g.metrics.map((m) => [m.id, g.id])));

/** 計測ツールの表示名。集計方法が違うことを AI に伝えるために使う */
export const SOURCE_LABEL: Record<MetricSource, string> = {
  manual: "手入力",
  gbp: "Google ビジネスプロフィール",
  gsc: "Google Search Console",
  ga4: "Google Analytics 4",
  clarity: "ヒートマップ（Clarity 等）",
  internal: "店舗の実績記録",
};

/** 検索キーワードごとの数字（何個でも追加できる） */
export interface KeywordRow {
  keyword: string;
  impressions: number | null;
  clicks: number | null;
  ctr: number | null;
  position: number | null;
}

/** 以前の平らな形式で使っていた項目名 → 今の項目名。既存データを読むために使う */
const LEGACY_ALIAS: Record<string, string> = {
  conversions: "trial_joins", // 「本入会（お試し経由）」
  web_bookings: "book_web", // 「HP からの見学予約」
  reviews: "gbp_reviews_new", // 「Google 口コミ数」
};

/** 入力欄に出さないが、以前のデータには入っている項目 */
const LEGACY_ONLY: Record<string, { label: string; unit: string }> = {
  personal_users: { label: "パーソナル利用者", unit: "名" },
  avg_visits: { label: "平均来館回数（月）", unit: "回" },
};

export interface NormalizedInput {
  /** 項目 id → 数値。空欄は入らない */
  values: Record<string, number>;
  /** 検索キーワードごとの数字 */
  keywords: KeywordRow[];
  /** ヒートマップで分かったことなどの自由記述 */
  notes: Record<string, string>;
}

/**
 * 保存された input_data_json を今の形に揃える。
 * 古い平らな形式（{visits: 31}）も、新しいブロック形式（{values: {...}, keywords: [...]}）も読める。
 */
export function normalizeInputData(raw: unknown): NormalizedInput {
  const out: NormalizedInput = { values: {}, keywords: [], notes: {} };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;

  const source = obj.values && typeof obj.values === "object" ? (obj.values as Record<string, unknown>) : obj;
  for (const [k, v] of Object.entries(source)) {
    if (k === "keywords" || k === "notes" || k === "values") continue;
    const n = typeof v === "number" ? v : Number(String(v).replace(/[,，\s]/g, ""));
    if (!Number.isFinite(n)) continue;
    out.values[LEGACY_ALIAS[k] ?? k] = n;
  }

  if (Array.isArray(obj.keywords)) {
    for (const row of obj.keywords as Array<Record<string, unknown>>) {
      const keyword = String(row?.keyword ?? "").trim();
      if (!keyword) continue;
      // 未入力は null のまま返す。Number("") は 0 になるため、空かどうかを先に見る
      const num = (x: unknown) => {
        if (x === null || x === undefined) return null;
        if (typeof x === "number") return Number.isFinite(x) ? x : null;
        const t = String(x).replace(/[,，\s%]/g, "").trim();
        if (t === "") return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
      };
      out.keywords.push({ keyword: keyword.slice(0, 60), impressions: num(row.impressions), clicks: num(row.clicks), ctr: num(row.ctr), position: num(row.position) });
    }
  }

  if (obj.notes && typeof obj.notes === "object") {
    for (const [k, v] of Object.entries(obj.notes as Record<string, unknown>)) {
      const s = String(v ?? "").trim();
      if (s) out.notes[k.slice(0, 40)] = s.slice(0, 4000);
    }
  }
  return out;
}

/** 項目 id の表示名（単位つき）。以前だけの項目にも対応する */
/**
 * 入力された数字とメモから、呼ぶべき担当を決める。AI には選ばせない。
 * 数字が 1 つも入っていないツールの担当は、言えることが無いので呼ばない。
 */
export function ownersWithData(input: NormalizedInput): string[] {
  const owners = new Set<string>();
  for (const [id, value] of Object.entries(input.values)) {
    if (value === undefined) continue;
    const group = METRIC_GROUP_OF[id];
    const owner = group ? GROUP_OWNER[group] : undefined;
    if (owner) owners.add(owner);
  }
  // 検索キーワードの表は Search Console のもの
  if (input.keywords.length > 0) owners.add("search");
  // ヒートマップのメモだけでも、行動担当は見るものがある
  for (const [id, text] of Object.entries(input.notes)) {
    if (!text || !text.trim()) continue;
    const field = NOTE_FIELDS.find((f) => f.id === id);
    const owner = field ? GROUP_OWNER[field.group] : undefined;
    if (owner) owners.add(owner);
  }
  // 並びはファネルの順（見つかる → 見る → 迷う → 決める）に揃える
  const order = ["search", "map", "site", "behavior", "booking"];
  return order.filter((o) => owners.has(o));
}

export function metricLabel(id: string): string {
  const m = METRIC_MAP[id];
  if (m) return `${m.label}（${m.unit}）`;
  const legacy = LEGACY_ONLY[id];
  if (legacy) return `${legacy.label}（${legacy.unit}）`;
  return id;
}

/** 自由記述の欄 */
export const NOTE_FIELDS: Array<{ id: string; label: string; placeholder: string; group: string }> = [
  {
    id: "heatmap",
    label: "ヒートマップで分かったこと",
    placeholder: "例: 料金ページまで見ている人が多い / トップページの途中で離脱が多い / 見学 CTA までスクロールされていない / LINE ボタンはほとんど押されていない",
    group: "clarity",
  },
];
