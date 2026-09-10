/**
 * 代表の承認なしに AI が行ってはいけない行為。
 * Worker にはこれらを実行する機能が存在しない（AI は文章を返すだけ）。
 * ここでは「施策にこれらが含まれるか」を判定して画面に印を付ける。
 */
export const RESTRICTED_ACTIONS = {
  publish_hp: "HP の本番公開",
  run_ads: "広告の出稿",
  post_sns: "SNS 投稿",
  send_line: "LINE の送信",
  change_price: "料金の変更",
  edit_member_data: "会員データの変更",
} as const;

export type RestrictedAction = keyof typeof RESTRICTED_ACTIONS;

export const RESTRICTED_ACTION_IDS = Object.keys(RESTRICTED_ACTIONS) as RestrictedAction[];

export function restrictedLabel(id: string): string {
  return (RESTRICTED_ACTIONS as Record<string, string>)[id] ?? id;
}

/** 施策の文章から、承認が必要な行為をキーワードで補完する（AI の申告漏れ対策） */
export function detectRestrictedActions(text: string, declared: string[] = []): RestrictedAction[] {
  const found = new Set<RestrictedAction>(declared.filter((d): d is RestrictedAction => d in RESTRICTED_ACTIONS));
  const rules: Array<[RestrictedAction, RegExp]> = [
    ["send_line", /LINE.{0,12}(送信|配信|一斉|メッセージを送)/i],
    ["post_sns", /(Instagram|インスタ|SNS|X|Twitter|TikTok|Facebook).{0,12}(投稿|配信)/i],
    ["run_ads", /(広告).{0,12}(出稿|配信|開始|運用)/],
    ["publish_hp", /(HP|ホームページ|LP|サイト).{0,16}(公開|本番|反映|デプロイ)/i],
    ["change_price", /(料金|価格|会費|プラン).{0,10}(変更|改定|値上げ|値下げ)/],
    ["edit_member_data", /(会員|顧客).{0,8}(データ|情報).{0,8}(変更|更新|編集|削除)/],
  ];
  for (const [id, re] of rules) if (re.test(text)) found.add(id);
  return [...found];
}
