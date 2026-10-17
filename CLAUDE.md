# Misskey – Claude Code Guide

ルール本体は [AGENTS.md](AGENTS.md) (Codex / Copilot と共有する単一ソース)。本ファイルは Claude Code 用の薄いラッパーで、`@AGENTS.md` 構文で本体規約をセッション開始時にコンテキストへ展開する。

Claude Code 固有の補助 (skills / agents / slash commands / docs) は `.claude/` 配下にコミット済。個人ローカル設定は `.claude/settings.local.json` に、MCP 認証情報は `.claude/.credentials.json` に置く (いずれも `.gitignore` 済)。

@AGENTS.md

## このフォーク (misskey-42) 固有の補足

- 42 intra 連携の設定は `packages/backend/src/config.ts` の `intra` セクション。未設定なら `config.intra` は `undefined` になり、連携機能全体を無効にする (upstream の e2e を壊さないため)
- 42 API まわりは `packages/backend/src/core/intra/` に置く。`intra-user.ts` は DI 不要の純粋関数、`IntraApiService.ts` は HTTP クライアント (CoreModule 登録済)
- 新しい worktree で `pnpm --filter backend typecheck` を通すには、先に `pnpm --filter misskey-js --filter misskey-reversi --filter i18n build` が必要
- DB 不要のユニットテストは `.config/test.yml` 無しでも、`packages/backend` で `pnpm exec vitest run --config vitest.config.unit.ts <file>` として単体実行できる
