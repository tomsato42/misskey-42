#!/usr/bin/env bash

# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only

# カスタム絵文字をまとめて登録するスクリプト。
# 配置先: /home/misskey/42times/emojis/add-emojis.sh (add-emojis.mjs と同じディレクトリ)
#
# 使い方:
#   ~/42times/emojis/add-emojis.sh <emojis.json と画像のあるディレクトリ> [--update] [--dry-run]
#
# ディレクトリを web のコンテナにコピーし、コンテナの中の node で add-emojis.mjs を実行する
# (VPS に node は入れない)。API は host ネットワークの http://127.0.0.1:3001 に送る。
# アクセストークン (管理者で「絵文字を操作する」「ドライブを見る」「ドライブを操作する」の権限) は環境変数 MISSKEY_TOKEN か、無ければ入力する。

set -euo pipefail

CONTAINER="${CONTAINER:-misskey42-web-1}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

if [ $# -lt 1 ] || [ ! -f "$1/emojis.json" ]; then
	echo "使い方: $0 <emojis.json のあるディレクトリ> [--update] [--dry-run]" >&2
	exit 1
fi
SRC="$(cd "$1" && pwd)"
shift

if [ -z "${MISSKEY_TOKEN:-}" ]; then
	read -rsp 'アクセストークン: ' MISSKEY_TOKEN
	echo
fi
export MISSKEY_TOKEN

WORK="/tmp/add-emojis-$$"
cleanup() { docker exec -u root "$CONTAINER" rm -rf "$WORK" >/dev/null 2>&1 || true; }
trap cleanup EXIT

docker cp "$SRC" "$CONTAINER:$WORK" >/dev/null
docker exec -u root "$CONTAINER" chmod -R a+rX "$WORK"
docker exec -i -e MISSKEY_TOKEN -e EMOJI_DIR="$WORK" -e MISSKEY_URL "$CONTAINER" \
	node --input-type=module - "$@" < "$SCRIPT_DIR/add-emojis.mjs"
