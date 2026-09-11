/**
 * 公開前の確認。貼り忘れ・設定漏れを、公開して失敗する前に見つける。
 *   npm run preflight
 *
 * Cloudflare には接続しない。手元のファイルを見るだけ。
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
let stop = 0;
let warn = 0;

function ok(label: string, detail = "") {
  console.log(`  OK    ${label}${detail ? `\n        ${detail}` : ""}`);
}
function bad(label: string, how: string) {
  console.log(`  要対応  ${label}\n        → ${how}`);
  stop++;
}
function note(label: string, how: string) {
  console.log(`  確認    ${label}\n        → ${how}`);
  warn++;
}

console.log("\nViXer AI Company 公開前チェック\n");

// ---------- 1. D1 の database_id ----------
const wranglerText = readFileSync(resolve(root, "wrangler.jsonc"), "utf8");
if (wranglerText.includes("REPLACE_WITH_YOUR_D1_DATABASE_ID")) {
  bad(
    "D1 の database_id がまだ貼られていません",
    "`npx wrangler d1 create vixer-ai-company-db` を実行し、表示された database_id を wrangler.jsonc の REPLACE_WITH_YOUR_D1_DATABASE_ID と差し替えてください。",
  );
} else {
  const id = /"database_id":\s*"([^"]+)"/.exec(wranglerText)?.[1] ?? "";
  ok("D1 の database_id が入っています", id);
}

// ---------- 2. マイグレーション ----------
const migrations = readdirSync(resolve(root, "migrations")).filter((f) => f.endsWith(".sql")).sort();
ok(`マイグレーション ${migrations.length} 件`, `${migrations[0]} 〜 ${migrations[migrations.length - 1]}`);
note(
  "本番の D1 にテーブルを入れましたか",
  "まだなら `npm run db:migrate` を実行してください（--remote 付きで本番に入ります）。二度実行しても安全です。",
);

// ---------- 3. 外部 AI の設定 ----------
const provider = /"AI_PROVIDER":\s*"([^"]+)"/.exec(wranglerText)?.[1] ?? "";
if (provider === "mock") {
  bad(
    "AI_PROVIDER が mock（固定回答）のままです",
    "wrangler.jsonc の AI_PROVIDER を none に戻してください。mock は本番では拒否されますが、設定として残すべきではありません。",
  );
} else if (provider === "claude") {
  note(
    "AI_PROVIDER が claude です",
    "`npx wrangler secret put ANTHROPIC_API_KEY` で API キーを登録済みか確認してください。外部 AI を使わない運用なら none に戻します。",
  );
} else {
  ok("AI_PROVIDER = none", "外部 AI を呼びません。API キーは不要です。");
}

// ---------- 4. 入口の鍵 ----------
const team = /"CF_ACCESS_TEAM_DOMAIN":\s*"([^"]*)"/.exec(wranglerText)?.[1] ?? "";
const aud = /"CF_ACCESS_AUD":\s*"([^"]*)"/.exec(wranglerText)?.[1] ?? "";
if (team && aud) {
  ok("Cloudflare Access が設定されています", `チーム: ${team}`);
} else {
  note(
    "入口の鍵（必須）",
    "Cloudflare Access を使わないなら `npx wrangler secret put APP_PASSWORD` と `npx wrangler secret put APP_SESSION_SECRET` を登録してください。" +
      "どちらも無いと、公開しても API はすべて「認証が設定されていません」で拒否されます（データは漏れません）。",
  );
}

// ---------- 5. 秘密情報がコードに混ざっていないか ----------
let leaked = "";
try {
  leaked = execSync(
    `grep -rInE "(sk-ant-[A-Za-z0-9_-]{8,}|CLOUDFLARE_API_TOKEN\\s*=\\s*[A-Za-z0-9_-]{8,})" src web migrations scripts 2>/dev/null || true`,
    { cwd: root, encoding: "utf8" },
  ).trim();
} catch {
  leaked = "";
}
if (leaked) bad("API キーらしき文字列がコードに含まれています", `取り除いてください:\n${leaked}`);
else ok("コードに API キーは含まれていません");

// ---------- 6. ビルドできるか ----------
try {
  execSync("npm run build", { cwd: root, stdio: "pipe" });
  ok("画面のビルドが通ります", existsSync(resolve(root, "dist/index.html")) ? "dist/index.html を確認" : "");
} catch {
  bad("画面のビルドが失敗します", "`npm run build` を実行して、出たエラーを直してください。");
}

// ---------- 7. 型と判定ロジック ----------
for (const [label, cmd] of [
  ["型チェック", "npm run typecheck"],
  ["仕組みスコアの確認", "npm run leverage:check"],
  ["3 軸の確認", "npm run frames:check"],
] as const) {
  try {
    execSync(cmd, { cwd: root, stdio: "pipe" });
    ok(label);
  } catch {
    bad(`${label}が失敗します`, `\`${cmd}\` を実行して、出たエラーを直してください。`);
  }
}

console.log(
  stop === 0
    ? `\n公開できます。${warn > 0 ? `（「確認」が ${warn} 件あります。上の内容を見てから）` : ""}\n次: npm run deploy\n`
    : `\n${stop} 件を直してから公開してください。\n`,
);
process.exit(stop === 0 ? 0 : 1);
