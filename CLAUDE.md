# Misskey – Claude Code Guide

ルール本体は [AGENTS.md](AGENTS.md) (Codex / Copilot と共有する単一ソース)。本ファイルは Claude Code 用の薄いラッパーで、`@AGENTS.md` 構文で本体規約をセッション開始時にコンテキストへ展開する。

Claude Code 固有の補助 (skills / agents / slash commands / docs) は `.claude/` 配下にコミット済。個人ローカル設定は `.claude/settings.local.json` に、MCP 認証情報は `.claude/.credentials.json` に置く (いずれも `.gitignore` 済)。

@AGENTS.md

## このフォーク (misskey-42) 固有の補足

42 intra ログイン専用の学内SNS (`https://42times.kinachan.com`)。ベースは upstream tag 2026.10.0。リモートは `origin` = tomsato42/misskey-42 (private、デプロイ用)、`public` = tomsato42/42times (公開用、Actions 無効。main への push を `.github/workflows/fork-mirror.yml` が早送りで自動反映する。鍵は Secret `MIRROR_DEPLOY_KEY`)、`upstream` = misskey-dev/misskey (push 無効)。コミットのメールは noreply (`git config --local` 済み)。VPS の接続先はファイルに書かずリポジトリ変数 `DEPLOY_*` に置く。`gh` は `-R tomsato42/misskey-42` を付けるか `gh repo set-default` 済みの状態で使う (付けないと upstream を見ることがある)。

### 機能の場所とスイッチ
- `config.intra` (`packages/backend/src/config.ts`) があると「学内SNSモード」。無ければ upstream と同じ挙動 (upstream の e2e を壊さないため、制限はすべてこの条件の内側に置く)。フロントは meta の `intraLoginEnabled` で判定する
- 42 API・ログイン・同期は `packages/backend/src/core/intra/`。`intra-*.ts` は DI 不要の純粋関数、`Intra*Service.ts` はサービス。ルートは `/api/intra/authorize`・`callback`・`exchange`
- 自動ロール (`intra_role.kind`) は level / campus / pool (Piscine YY/MM) / cohort (Cursus YY/MM、ピシンの年月を 1〜4 月→当年 04・5〜10 月→当年 10・11〜12 月→翌年 04 に丸める。42cursus の begin_at は入学時期より遅れることがあるので使わない。ピシンの年月が無い人だけ begin_at から) の 4 種類。`IntraSyncService` が `isExplorable: true` で作り、ログイン時と毎時のジョブで付け替える。Lv.0〜21 のロールは毎時のジョブの最初に先に作る (`ensureLevelRoles`)。レベルのロールのアイコンは `config.intra.levelBadgeUrl` (`{level}` を置換) があるときだけ、作成時と、アイコン未設定の既存ロールに設定する (本番では未設定にしてアイコンを付けていない)。バッジの SVG は `deploy/badges/generate-level-badges.cjs` で `deploy/instance-assets/badges/` に書き出し、VPS の `~/42times-assets/badges/` に置く
- ペア募集は `src/core/pair/` (`pair-recruitment.ts` が判定の純粋関数、`PairRecruitmentService`)、pack は `core/entities/PairRecruitmentEntityService.ts`、API は `pair-recruitments/*` (エラー定義は `server/api/pair-recruitment-errors.ts` に共通化)。`intra_project` の行は課題が登録できなくなると消えるので、`pair_recruitment` は外部キーにせず課題名と人数を作成時の値で持つ。期限切れは一覧・取得で締め切り扱いにし、毎時のジョブ `closeExpiredPairRecruitments` で status を閉じて通知する
- 学内SNSモードでは `federation` と `ugcVisibilityForVisitor` を `'none'` に固定 (`intra-visitor.ts` の `INTRA_FIXED_META`、update-meta でも拒否)。未ログインの API は許可リスト (`INTRA_VISITOR_ALLOWED_ENDPOINTS`) 以外 401
- 画像の保護は `config.mediaGate` (署名付き Cookie)。backend は `src/core/media-gate/` と `src/server/media-gate-hooks.ts`、R2 からの配信は `cloudflare/media-worker/` (ルートとは別の pnpm workspace。トークン形式を変えるときは backend・Worker・`test/token-vectors.json` を同時に更新)
- `/api/intra/exchange` と `/api/media-session` は Cookie を使うので、フロントは misskeyApi (credentials: 'omit') ではなく `fetch(..., { credentials: 'same-origin' })` で呼ぶ
- 本番デプロイは `.github/workflows/fork-deploy.yml` と `deploy/` (手順は `deploy/README.md`)

### ローカル環境 (Windows)
- Node / pnpm は PATH に無い。`export PATH="/c/Users/windows11/AppData/Local/misskey-42-tools/node-v26.4.0-win-x64:/c/Users/windows11/AppData/Local/misskey-42-tools/pnpm:$PATH"`
- Docker・PostgreSQL・Redis は無い。e2e と check-migrations は検証用 PR (tomsato42/misskey-42#1、main → ci-base、マージしない) の GitHub Actions で確認する
- 新しい worktree では `pnpm install --frozen-lockfile` の後に `pnpm --filter misskey-js --filter misskey-reversi --filter i18n --filter misskey-bubble-game build` が必要 (無いと typecheck が通らない)
- `pnpm build-misskey-js-with-types` には `.config/default.yml` が必要。`cp .config/example.yml .config/default.yml` で用意し、コミットしない
- DB 不要のユニットテスト: backend は `packages/backend` で `pnpm exec vitest run --config vitest.config.unit.ts <file>`、frontend は `packages/frontend` で `pnpm exec vitest --run --globals --config vitest.config.unit.ts <file>` (`--config` が無いと `window is not defined`)

### 変更時の注意
- プロフィールに出す intra 情報は login と Piscine だけ。BH (`blackholed_at`) はペースシステムやフリーズを反映せず古い値が残り、ペース期日は公開 API に無いため表示しない (値は DB と API には残っている)
- `admin/roles/update-default-policies` は基本ポリシーを丸ごと置き換える。基本ポリシーの初期値は migration で入れているので、それを上書きする処理 (初期設定ウィザードなど) を足さない
- `locales/ja-JP.yml` を変えたら `packages/i18n/src/autogen/locale.ts` (git 管理) も再生成してコミットする
- UserDetailed に項目を足すときは `WebhookTestService.ts` のダミー、`test/e2e/users.ts` の `userDetailedNotMe`、`packages/frontend/.storybook/fakes.ts` も更新する
- モデレーションログ種別の追加は `backend/src/types.ts`・`misskey-js/src/consts.ts`・`ja-JP.yml` の `_moderationLogTypes`・`frontend/src/pages/admin/modlog.ModLog.vue` の 4 か所
- 通知の種類の追加は backend の `types.ts`・`models/Notification.ts`・`models/json-schema/notification.ts`・`NotificationEntityService.ts`、受け取り設定の `models/json-schema/user.ts`・`endpoints/i/update.ts`・`endpoints/admin/show-user.ts`、`misskey-js/src/consts.ts`、`ja-JP.yml` の `_notification._types` (無いと frontend の typecheck が通らない)。通知は Redis に JSON で入るので migration は不要
- migration の制約・インデックス名は TypeORM の `DefaultNamingStrategy` (`primaryKeyName` / `indexName` / `foreignKeyName`) を `packages/backend` で node から呼べば DB 無しで求められる (`1792318861358-intra-projects.js` の名前と一致する)
- `@bindThis` のメソッドはテストでインスタンスに代入できない (`Object.defineProperty` で差し替える)
- `<SearchMarker>` の直下に HTML コメントを置くと、本番ビルドの create-search-index が `Unexpected EOF in comment` で失敗する (typecheck や dev では検出されない)。設定画面ではコメントを `<script>` 側に書く。本番ビルドの確認は `pnpm --filter icons-subsetter build` の後に `pnpm --filter frontend build`
