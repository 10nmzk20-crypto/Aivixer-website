import type { Project, ToolReview } from "./api";

/**
 * ChatGPT に貼り付けるテキストを組み立てる。
 *
 * 画面に出ている内容だけを使うので、通信も待ち時間もない。
 * 外部 AI は呼ばない。入力されていない項目は 0 にせず「未入力」と書く。
 */

const NA = "未入力";
const num = (n: number | undefined, unit = ""): string => (n === undefined ? NA : `${n.toLocaleString("ja-JP")}${unit}`);

/** 5 領域それぞれの、レポートに出す数字の並び */
const NUMBER_BLOCKS: Array<{ owner: string; heading: string; rows: Array<[string, string, string]> }> = [
  {
    owner: "search",
    heading: "1. Google Search Console",
    rows: [
      ["gsc_impressions", "検索表示回数", " 回"],
      ["gsc_clicks", "検索クリック数", " 回"],
      ["gsc_position", "平均掲載順位", " 位"],
    ],
  },
  {
    owner: "map",
    heading: "2. Google ビジネスプロフィール",
    rows: [
      ["gbp_impressions", "プロフィール表示回数", " 回"],
      ["gbp_website_clicks", "Web サイトクリック数", " 回"],
      ["gbp_calls", "電話件数", " 件"],
      ["gbp_directions", "ルート検索数", " 回"],
      ["gbp_reviews_total", "口コミ件数（累計）", " 件"],
      ["gbp_rating", "口コミ平均評価", ""],
      ["gbp_reviews_new", "当月の新規口コミ数", " 件"],
    ],
  },
  {
    owner: "site",
    heading: "3. Google Analytics 4",
    rows: [
      ["ga4_users", "ユーザー数", " 人"],
      ["ga4_sessions", "セッション数", " 回"],
      ["ga4_new_users", "新規ユーザー数", " 人"],
      ["ga4_organic_users", "Google 自然検索からのユーザー数", " 人"],
      ["ga4_maps_users", "Google マップ等からの流入数", " 人"],
      ["ga4_pv_top", "トップページ閲覧数", " 回"],
      ["ga4_pv_price", "料金ページ閲覧数", " 回"],
      ["ga4_pv_trial", "見学・体験ページ閲覧数", " 回"],
      ["ga4_cta_trial", "見学・体験 CTA クリック数", " 回"],
      ["ga4_cta_line", "LINE クリック数", " 回"],
      ["ga4_cta_tel", "電話クリック数", " 回"],
      ["ga4_booking_page", "Web 予約ページへの遷移数", " 回"],
    ],
  },
  {
    owner: "behavior",
    heading: "4. Microsoft Clarity",
    rows: [
      ["clarity_scroll", "平均スクロール率", "%"],
      ["clarity_cta_reach", "CTA 到達率", "%"],
      ["clarity_cta_clicks", "主要 CTA クリック数", " 回"],
      ["clarity_dead_clicks", "デッドクリック数", " 回"],
      ["clarity_rage_clicks", "レイジクリック数", " 回"],
    ],
  },
  {
    owner: "booking",
    heading: "5. hacomono・受付",
    rows: [
      ["inquiries", "問い合わせ数", " 件"],
      ["book_web", "Web からの見学・体験予約数", " 件"],
      ["book_tel", "電話からの見学・体験予約数", " 件"],
      ["book_line", "LINE からの見学・体験予約数", " 件"],
      ["book_other", "紹介等その他からの予約数", " 件"],
      ["visits", "実際の見学・体験人数", " 人"],
      ["trials", "30日お試し 開始人数", " 人"],
      ["direct_joins", "見学から直接 本入会", " 人"],
      ["trial_joins", "30日お試しから 本入会", " 人"],
      ["new_members", "新規入会者数（合計）", " 人"],
      ["churn", "退会者数", " 人"],
      ["members", "月末会員数", " 人"],
      ["sales", "売上", " 円"],
    ],
  },
];

/** その領域の「入力された数字」。Search Console と Clarity は数字以外も足す */
function numbersFor(project: Project, owner: string, rows: Array<[string, string, string]>): string[] {
  const v = project.input_data?.values ?? {};
  const out = rows.map(([id, label, unit]) => `・${label}: ${num(v[id], unit)}`);

  if (owner === "search") {
    const kws = project.input_data?.keywords ?? [];
    if (kws.length === 0) {
      out.push("・重要検索キーワード: 未入力");
    } else {
      out.push("・重要検索キーワード:");
      for (const k of kws) {
        const ctr = k.ctr !== null && k.ctr !== undefined ? `${k.ctr}%` : NA;
        out.push(`  - ${k.keyword}: 表示 ${num(k.impressions ?? undefined, " 回")} / クリック ${num(k.clicks ?? undefined, " 回")} / CTR ${ctr} / 平均順位 ${num(k.position ?? undefined, " 位")}`);
      }
    }
  }
  if (owner === "behavior") {
    const note = (project.input_data?.notes?.heatmap ?? "").trim();
    out.push(`・録画を見て気づいたこと: ${note || NA}`);
  }
  return out;
}

/** アプリの分析（現状・傾向・問題点・改善案・判断根拠） */
function analysisFor(r: ToolReview | undefined): string[] {
  if (!r) return ["（この領域の分析はありません）"];
  const out: string[] = [];

  out.push("【現状】");
  if (r.verdict === "no_data") out.push("・数字が入力されていないため、分析していません。");
  else if (r.current.length === 0) out.push("・（表示できる数字がありません）");
  else for (const t of r.current) out.push(`・${t}`);

  out.push("", "【傾向】");
  if (r.trend.length === 0) out.push("・前月の入力がないため、傾向は出していません。");
  else for (const t of r.trend) out.push(`・${t}`);

  out.push("", "【問題点】");
  if (r.findings.length === 0) out.push(r.verdict === "no_data" ? "・判断できません（数字が未入力）。" : "・目立った問題は見つかりませんでした。");
  else r.findings.forEach((f, i) => out.push(`${i + 1}. ${f.problem}`));

  out.push("", "【改善案】");
  if (r.findings.length === 0) out.push("・なし");
  else r.findings.forEach((f, i) => out.push(`${i + 1}. ${f.fix}`));

  out.push("", "【判断根拠】");
  if (r.findings.length === 0) out.push("・どのしきい値にも触れませんでした。");
  // 判断根拠を持たない古い記録があるため、無いときはその旨を書く
  else r.findings.forEach((f, i) => out.push(`${i + 1}. ${f.basis || "（この分析には判断根拠が記録されていません。もう一度分析すると付きます）"}`));

  if (r.missing.length > 0) {
    out.push("", "【この判断に足りていない数字】");
    for (const t of r.missing) out.push(`・${t}`);
  }
  return out;
}

/** ChatGPT への依頼文。代表が指定した文をそのまま入れる */
const INSTRUCTION = `# ChatGPTへの依頼

あなたはLife Design ViXerのWeb集客・経営判断を補助する役割です。

上記5領域を個別に評価するだけではなく、
Search Console、Googleビジネスプロフィール、GA4、Clarity、hacomono・受付の数字を横断して、
ViXerの集客全体として分析してください。

重要なのは、
「各担当の改善案を並べること」ではなく、
数字同士のつながり・因果関係を考えて、
集客ファネルのどこが最も詰まっているのかを判断することです。

ViXerの基本的な集客導線は、

検索・Googleマップで発見
↓
HPへ流入
↓
料金・施設・特徴などを見る
↓
見学・体験ページへ進む
↓
見学・体験予約
↓
実際に見学・体験
↓
30日お試しまたは本入会

です。

最終成果に近い数字ほど重要度を高く考えてください。

Search Console、Googleビジネスプロフィール、GA4、Clarityは
「なぜ成果につながっていないのかを調べるためのデータ」として扱い、

hacomono・受付の
見学・体験・30日お試し・本入会を最終成果として重視してください。

また、ViXerは
「小さく、強く、暇な会社」
を目指しています。

そのため、

・人が毎回動かなければ成立しない施策
・毎日のSNS投稿
・個別追客
・スタッフの作業量が増える施策

を安易に優先せず、

・一度作れば何度も働く
・Webサイト改善
・SEO
・MEO
・導線改善
・自動化
・仕組み化

を優先してください。

以下の順番で回答してください。

1. 今月の最大のボトルネック
2. そう判断した根拠
3. 数字同士から見える集客全体の状態
4. 今月やるべきこと最大3つ
5. その中で最優先の1つ
6. 今月はやらなくていいこと
7. アプリ側の分析で間違っている、弱い、または判断材料が不足している部分
8. 次月確認すべき数字
9. 今月の結論を一言で

改善案は最大3つまでにしてください。

数字が不足していて断定できない場合は、
無理に判断せず「判断できない理由」と「次に必要な数字」を示してください。`;

/** ① GPT 用レポート（数字 + アプリの分析 + 依頼文） */
export function buildGptReport(project: Project): string {
  const review = project.review;
  const byId = new Map((review?.reviews ?? []).map((r) => [r.id, r]));
  const L: string[] = [];

  L.push("# ViXer Web集客 月次分析レポート", "");
  L.push(`対象月：${project.period_label ?? "未設定"}`, "");

  for (const block of NUMBER_BLOCKS) {
    L.push(`## ${block.heading}`, "");
    L.push("【入力された数字】");
    L.push(...numbersFor(project, block.owner, block.rows));
    L.push("", "【アプリの分析】");
    L.push(...analysisFor(byId.get(block.owner)));
    L.push("", "---", "");
  }

  L.push("# アプリが選んだ「今月やるべきこと」", "");
  if (review && review.actions.length > 0) {
    review.actions.forEach((a) => {
      L.push(`${a.rank}. ${a.action}`);
      L.push(`   （理由: ${a.why}）`);
      L.push(`   （${a.from}の指摘）`);
    });
  } else {
    L.push("1. （アプリが選んだ改善点はありません）");
  }
  if (review?.headline) L.push("", `アプリの総合判断: ${review.headline}`);
  if (review?.noDataOwners.length) L.push("", `数字が未入力で分析できなかった領域: ${review.noDataOwners.join("・")}`);

  L.push("", "---", "", INSTRUCTION);
  return L.join("\n");
}

/** ② 生データだけ（アプリの分析文は入れない） */
export function buildRawNumbers(project: Project): string {
  const L: string[] = [];
  L.push("# ViXer Web集客 入力データ", "");
  L.push(`対象月：${project.period_label ?? "未設定"}`, "");
  for (const block of NUMBER_BLOCKS) {
    L.push(`## ${block.heading}`, "");
    L.push(...numbersFor(project, block.owner, block.rows));
    L.push("");
  }
  L.push("---", "");
  L.push("これは ViXer の Web 集客の生データです。アプリ側の分析は含めていません。");
  L.push("この数字だけを見て、集客全体としてどこが最も詰まっているかをゼロから判断してください。");
  L.push("未入力の項目は 0 ではなく、データが無いという意味です。推測で数字を補わないでください。");
  return L.join("\n");
}
