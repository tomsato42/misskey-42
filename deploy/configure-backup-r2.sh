#!/usr/bin/env bash

# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only

# backup.sh がバックアップを R2 に送るときの鍵 (.config/backup-r2.env) を、対話形式で書き込むスクリプト。
# 配置先: /home/misskey/42times/configure-backup-r2.sh (backup.sh と同じディレクトリ)
#
# 使い方 (VPS 上で、misskey ユーザーとして):
#   ~/42times/configure-backup-r2.sh
#
# - Secret Access Key は画面に表示せずに入力する
# - 2 回目以降は今の値が既定値になり、Enter だけで残せる
# - 書き込む前に、小さなオブジェクトを R2 にアップロードして消し、鍵が使えるかを確かめる。
#   アップロードは backup.sh と同じ curl --aws-sigv4 で行う
# - 鍵はコマンドラインに出さず、curl の設定ファイル (プロセス置換) で渡す
# - backup-r2.env は backup.sh が bash の source で読むので、値は英数字などに限って書き込む

set -euo pipefail
umask 077

DEPLOY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly DEPLOY_DIR
readonly ENV_FILE="${DEPLOY_DIR}/.config/backup-r2.env"
readonly DEFAULT_BUCKET="42times-backups"
# backup.sh の upload_r2 と同じ条件
readonly ACCOUNT_PATTERN='^[0-9a-f]{32}$'
readonly BUCKET_PATTERN='^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$'
readonly KEY_PATTERN='^[A-Za-z0-9]+$'

die() {
	echo "エラー: $*" >&2
	exit 1
}

# 前後の空白と CR を取り除く (貼り付けたときに付くことがある)
trim() {
	local value=$1
	value="${value//$'\r'/}"
	value="${value#"${value%%[![:space:]]*}"}"
	value="${value%"${value##*[![:space:]]}"}"
	printf '%s' "$value"
}

# 今の backup-r2.env から NAME の値を読む。source すると中身が実行されるので、行を読むだけにする
current_value() {
	local name=$1 line
	[[ -f "$ENV_FILE" ]] || return 0
	while IFS= read -r line || [[ -n "$line" ]]; do
		if [[ "$line" == "${name}="* ]]; then
			trim "${line#*=}"
			return 0
		fi
	done < "$ENV_FILE"
}

# 表示して入力する。第 1 引数が説明、第 2 引数が今の値 (Enter で残す)、第 3 引数が値の条件
read_visible() {
	local label=$1 current=$2 pattern=$3 value
	while true; do
		if [[ -n "$current" ]]; then
			read -r -p "${label} [${current}]: " value
			value=$(trim "$value")
			[[ -z "$value" ]] && value=$current
		else
			read -r -p "${label}: " value
			value=$(trim "$value")
		fi
		if [[ "$value" =~ $pattern ]]; then
			REPLY_VALUE=$value
			return 0
		fi
		echo "  形式が正しくありません。もう一度入力してください。"
	done
}

# アカウント ID を入力する。S3 API のエンドポイントの URL を貼り付けても、そこから取り出す
read_account_id() {
	local current=$1 value
	while true; do
		if [[ -n "$current" ]]; then
			read -r -p "アカウント ID (エンドポイントの URL でも可) [${current}]: " value
			value=$(trim "$value")
			[[ -z "$value" ]] && value=$current
		else
			read -r -p "アカウント ID (エンドポイントの URL でも可): " value
			value=$(trim "$value")
		fi
		value=${value,,}
		if [[ "$value" =~ ^https?://([0-9a-f]{32})\.r2\.cloudflarestorage\.com(/.*)?$ ]]; then
			value=${BASH_REMATCH[1]}
		fi
		if [[ "$value" =~ $ACCOUNT_PATTERN ]]; then
			REPLY_VALUE=$value
			return 0
		fi
		echo "  32 文字の 16 進数か、https://<アカウント ID>.r2.cloudflarestorage.com の形で入力してください。"
	done
}

# 表示せずに入力する。今の値があれば Enter で残す
read_secret() {
	local label=$1 current=$2 value
	while true; do
		if [[ -n "$current" ]]; then
			read -r -s -p "${label} (Enter で今の値を残す): " value
		else
			read -r -s -p "${label}: " value
		fi
		echo
		value=$(trim "$value")
		[[ -z "$value" && -n "$current" ]] && value=$current
		if [[ "$value" =~ $KEY_PATTERN ]]; then
			REPLY_VALUE=$value
			return 0
		fi
		echo "  形式が正しくありません (英数字だけ)。もう一度入力してください。"
	done
}

# R2 に S3 API でリクエストを送る。第 1 引数がメソッド、第 2 引数がオブジェクトのキー、残りは curl の引数
r2_request() {
	local method=$1 key=$2
	shift 2
	curl --fail-with-body --silent --show-error \
		--connect-timeout 30 --max-time 120 \
		--aws-sigv4 'aws:amz:auto:s3' \
		--config <(printf 'user = "%s:%s"\n' "$ACCESS_KEY_ID" "$SECRET_ACCESS_KEY") \
		--request "$method" \
		"$@" \
		"https://${ACCOUNT_ID}.r2.cloudflarestorage.com/${BUCKET}/${key}"
}

# 小さなオブジェクトをアップロードして消す。失敗したら 1 を返す
test_connection() {
	local key test_file

	key="configure-backup-r2-test-$(date -u +%Y%m%dT%H%M%SZ).txt"
	test_file=$(mktemp)
	printf 'configure-backup-r2.sh の接続の確認\n' > "$test_file"

	echo "R2 のバケット ${BUCKET} に ${key} をアップロードして確かめます..."
	# backup.sh と同じく、ファイルを --upload-file で送る (PUT)
	if ! r2_request PUT "$key" --header 'Content-Type: text/plain' --upload-file "$test_file" >&2; then
		rm -f -- "$test_file"
		return 1
	fi
	rm -f -- "$test_file"
	echo "  アップロードできました。"

	if r2_request DELETE "$key" >&2; then
		echo "  確認用のオブジェクトを消しました。"
	else
		echo "  確認用のオブジェクト ${key} を消せませんでした。ライフサイクルルールで消えるので、そのままでも構いません。"
	fi
}

write_env_file() {
	local tmp
	tmp=$(mktemp "${ENV_FILE}.XXXXXX")
	printf '%s\n' \
		'# backup.sh が R2 にバックアップを送るときの設定。configure-backup-r2.sh が書き込む' \
		"R2_ACCOUNT_ID=${ACCOUNT_ID}" \
		"R2_BUCKET=${BUCKET}" \
		"R2_ACCESS_KEY_ID=${ACCESS_KEY_ID}" \
		"R2_SECRET_ACCESS_KEY=${SECRET_ACCESS_KEY}" \
		> "$tmp"
	chmod 600 "$tmp"
	mv -f -- "$tmp" "$ENV_FILE"
}

main() {
	[[ -t 0 ]] || die "対話形式で使うスクリプトです。端末から実行してください"
	command -v curl > /dev/null || die "curl が見つかりません"
	[[ -d "$(dirname -- "$ENV_FILE")" ]] || die "$(dirname -- "$ENV_FILE") がありません"

	echo "バックアップを送る R2 の鍵を設定します: ${ENV_FILE}"
	echo "Cloudflare のダッシュボードで、バケット ${DEFAULT_BUCKET} だけを対象にした「オブジェクトの読み取りと書き込み」の API トークンを作っておいてください。"
	if [[ -f "$ENV_FILE" ]]; then
		echo "設定済みの値があります。[ ] の中が今の値で、Enter だけで残せます。"
	fi
	echo

	local current_bucket
	current_bucket=$(current_value R2_BUCKET)

	read_account_id "$(current_value R2_ACCOUNT_ID)"
	ACCOUNT_ID=$REPLY_VALUE
	read_visible "バケット" "${current_bucket:-$DEFAULT_BUCKET}" "$BUCKET_PATTERN"
	BUCKET=$REPLY_VALUE
	read_visible "Access Key ID" "$(current_value R2_ACCESS_KEY_ID)" "$KEY_PATTERN"
	ACCESS_KEY_ID=$REPLY_VALUE
	read_secret "Secret Access Key" "$(current_value R2_SECRET_ACCESS_KEY)"
	SECRET_ACCESS_KEY=$REPLY_VALUE
	echo

	if ! test_connection; then
		echo
		echo "R2 にアップロードできませんでした。上のエラーを確かめてください。"
		echo "  InvalidAccessKeyId / SignatureDoesNotMatch: Access Key ID か Secret Access Key が違います"
		echo "  NoSuchBucket: バケットの名前か、アカウント ID が違います"
		echo "  AccessDenied: トークンの権限か、対象のバケットが違います"
		local answer
		read -r -p "それでも書き込みますか? [y/N] " answer
		if [[ "$answer" != "y" && "$answer" != "Y" ]]; then
			echo "書き込まずに終わります。"
			exit 1
		fi
	fi

	write_env_file
	echo
	echo "${ENV_FILE} に書き込みました。"
	echo "次の backup.sh (毎日 3:15) から R2 にも送ります。すぐに確かめるときは ~/42times/backup.sh を実行してください。"
}

main "$@"
