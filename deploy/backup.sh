#!/usr/bin/env bash

# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only

# misskey-42 (https://42times.kinachan.com) のバックアップを取るスクリプト。
# 配置先: /home/misskey/42times/backup.sh (compose.yml と同じディレクトリ)
#
# 使い方:
#   - misskey ユーザーの crontab から 1 日 1 回実行する (設定は README.md の「バックアップ」)
#   - 手で実行する: ~/42times/backup.sh
#
# 1 回の実行で、次のファイルを 1 つの tar (42times-<日本時間の YYYYmmdd-HHMMSS>.tar) にまとめる:
#   - misskey42.dump : DB misskey42 の pg_dump (カスタム形式。pg_restore で戻す)
#   - default.yml    : .config/default.yml (秘密の値を含む)
#   - files.tar.zst  : files/ (R2 を設定する前にアップロードされたファイル)
#   - SHA256SUMS     : 上のファイルの SHA-256
#
# 処理の流れ:
#   1. 保存先の空き容量を確かめる (DB と同じディスクなので、足りなければ何もせずに終わる)
#   2. 作業用ディレクトリに書き出し、pg_restore --list でダンプを読めることを確かめる
#   3. tar にまとめて保存先 (/home/misskey/42times-backups) に置く
#   4. .config/backup-r2.env があれば、R2 のバケットにもアップロードする
#   5. 保存先の古いものを消し、新しい 7 個だけ残す (R2 側はバケットのライフサイクルルールで消す)
#
# DB のダンプに失敗したら tar を作らずに終わる。files/ と R2 へのアップロードに失敗したときは、
# 残りの処理を続けてから終了コード 1 で終わる。

set -euo pipefail
umask 077

DEPLOY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly DEPLOY_DIR
readonly CONFIG_FILE="${DEPLOY_DIR}/.config/default.yml"
readonly R2_ENV_FILE="${DEPLOY_DIR}/.config/backup-r2.env"
readonly FILES_DIR="${DEPLOY_DIR}/files"
readonly CURRENT_TAG_FILE="${DEPLOY_DIR}/state/current-tag"
readonly IMAGE_REPO="ghcr.io/tomsato42/misskey-42"
readonly TAG_PATTERN='^sha-[0-9a-f]{7,40}$'
# コンテナの中の misskey ユーザー。files/ の持ち主
readonly CONTAINER_UID_GID="991:991"
BACKUP_DIR="${BACKUP_DIR:-$(dirname -- "$DEPLOY_DIR")/42times-backups}"
readonly BACKUP_DIR
# 残す数 (1 日 1 回なので 7 で 1 週間分)
readonly KEEP="${BACKUP_KEEP:-7}"
# 始める前に必要な空き容量 (MB)
readonly MIN_FREE_MB="${BACKUP_MIN_FREE_MB:-5120}"

log() {
	printf '[backup %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

die() {
	log "エラー: $*"
	exit 1
}

check_free_space() {
	local free_mb
	free_mb=$(df -Pm -- "$BACKUP_DIR" | awk 'NR == 2 { print $4 }')
	if [[ ! "$free_mb" =~ ^[0-9]+$ ]]; then
		die "${BACKUP_DIR} の空き容量を調べられませんでした"
	fi
	if ((free_mb < MIN_FREE_MB)); then
		die "空き容量が ${free_mb}MB しかありません (${MIN_FREE_MB}MB 以上必要)。DB と同じディスクなので、バックアップを取らずに終わります"
	fi
}

# DB misskey42 を pg_dump のカスタム形式で書き出す。第 1 引数が出力先、第 2 引数がパスワードファイルの置き場所
dump_db() {
	local out=$1 pass_file=$2 conn host port name user

	# 接続先は default.yml の db から読む。パスワードはコマンドラインや環境変数に出さず、
	# 作業用ディレクトリのパスワードファイル (PGPASSFILE) で渡す。
	# CONFIG_FILE は readonly なので、python3 には別の名前の環境変数で渡す
	conn=$(MISSKEY_CONFIG="$CONFIG_FILE" PASS_FILE="$pass_file" python3 - <<'PY'
import os, yaml
with open(os.environ['MISSKEY_CONFIG'], encoding='utf-8') as f:
	db = (yaml.safe_load(f) or {}).get('db') or {}
fields = [str(db.get('host', 'localhost')), str(db.get('port', 5432)), str(db['db']), str(db['user'])]
password = str(db.get('pass') or '')
def escape(s):
	return s.replace('\\', '\\\\').replace(':', '\\:')
fd = os.open(os.environ['PASS_FILE'], os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
with os.fdopen(fd, 'w', encoding='utf-8') as f:
	f.write(':'.join(escape(s) for s in fields + [password]) + '\n')
print('\n'.join(fields))
PY
	) || die "${CONFIG_FILE} から DB の接続先を読めませんでした"
	{ read -r host; read -r port; read -r name; read -r user; } <<< "$conn"

	log "DB ${name} をダンプします"
	PGPASSFILE="$pass_file" nice -n 10 pg_dump \
		--host="$host" --port="$port" --username="$user" --dbname="$name" \
		--no-password --format=custom --lock-wait-timeout=300s --file="$out" \
		|| die "pg_dump に失敗しました"
	pg_restore --list "$out" > /dev/null || die "書き出したダンプを pg_restore で読めませんでした"
	rm -f -- "$pass_file"
}

# files/ を tar にして zstd で圧縮する。files/ はコンテナの misskey ユーザー (UID 991) しか読めないので、
# 動いているイメージを使って読み取り専用でマウントしたコンテナの中で tar を実行する
dump_files() {
	local out=$1 tag

	if [[ ! -f "$CURRENT_TAG_FILE" ]]; then
		log "${CURRENT_TAG_FILE} が無いので、files/ を読むためのイメージが分かりません"
		return 1
	fi
	tag=$(< "$CURRENT_TAG_FILE")
	if [[ ! "$tag" =~ $TAG_PATTERN ]]; then
		log "${CURRENT_TAG_FILE} の内容が正しくありません"
		return 1
	fi

	log "files/ をまとめます (${IMAGE_REPO}:${tag} のコンテナで読みます)"
	# --log-driver none: tar の出力をコンテナのログ (json-file) に書かせない
	docker run --rm --pull never --network none --log-driver none \
		--user "$CONTAINER_UID_GID" \
		--volume "${FILES_DIR}:/files:ro" \
		--entrypoint tar \
		"${IMAGE_REPO}:${tag}" \
		-C /files -cf - . \
		| nice -n 10 zstd -q -3 > "$out"
}

# R2 にアップロードする。第 1 引数がファイル、第 2 引数がオブジェクトのキー。
# 設定ファイルの変数がほかに漏れないよう、サブシェルで実行する
upload_r2() (
	local file=$1 key=$2

	# shellcheck source=/dev/null
	source "$R2_ENV_FILE"
	[[ "${R2_ACCOUNT_ID:-}" =~ ^[0-9a-f]{32}$ ]] || die "${R2_ENV_FILE} の R2_ACCOUNT_ID が正しくありません"
	[[ "${R2_BUCKET:-}" =~ ^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$ ]] || die "${R2_ENV_FILE} の R2_BUCKET が正しくありません"
	[[ "${R2_ACCESS_KEY_ID:-}" =~ ^[A-Za-z0-9]+$ ]] || die "${R2_ENV_FILE} の R2_ACCESS_KEY_ID が正しくありません"
	[[ "${R2_SECRET_ACCESS_KEY:-}" =~ ^[A-Za-z0-9]+$ ]] || die "${R2_ENV_FILE} の R2_SECRET_ACCESS_KEY が正しくありません"

	log "R2 のバケット ${R2_BUCKET} にアップロードします"
	# 鍵はコマンドラインに出さず、curl の設定ファイル (プロセス置換) で渡す
	curl --fail-with-body --silent --show-error \
		--retry 3 --retry-delay 30 --connect-timeout 30 --max-time 3600 \
		--aws-sigv4 'aws:amz:auto:s3' \
		--config <(printf 'user = "%s:%s"\n' "$R2_ACCESS_KEY_ID" "$R2_SECRET_ACCESS_KEY") \
		--header 'Content-Type: application/x-tar' \
		--upload-file "$file" \
		"https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com/${R2_BUCKET}/${key}" >&2
)

# 新しいものから KEEP 個だけ残す。名前に日時が入っているので、名前の順が古い順になる
prune_local() {
	local -a archives
	local i remove

	mapfile -t archives < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name '42times-*.tar' -printf '%f\n' | sort)
	remove=$((${#archives[@]} - KEEP))
	for ((i = 0; i < remove; i++)); do
		rm -f -- "${BACKUP_DIR}/${archives[i]}"
		log "古いバックアップを消しました: ${archives[i]}"
	done
}

main() {
	local failed=0 name work data archive

	[[ "$KEEP" =~ ^[1-9][0-9]*$ ]] || die "BACKUP_KEEP は 1 以上の整数にしてください"
	[[ "$MIN_FREE_MB" =~ ^[0-9]+$ ]] || die "BACKUP_MIN_FREE_MB は整数にしてください"
	[[ -f "$CONFIG_FILE" ]] || die "${CONFIG_FILE} がありません"
	local cmd
	for cmd in pg_dump pg_restore python3 zstd docker curl flock sha256sum; do
		command -v "$cmd" > /dev/null || die "${cmd} が見つかりません"
	done

	mkdir -p -m 700 "$BACKUP_DIR"

	# 同時に 2 つ動かないようにする
	exec 9> "${BACKUP_DIR}/.backup.lock"
	flock -n 9 || die "別のバックアップが実行中です"

	# 前回が途中で止まったときの作業用ディレクトリを消す (ロックを取っているので、ほかに使っている人はいない)
	find "$BACKUP_DIR" -maxdepth 1 -type d -name '.work-*' -exec rm -rf -- {} +

	check_free_space

	name="42times-$(TZ=Asia/Tokyo date +%Y%m%d-%H%M%S).tar"
	work=$(mktemp -d "${BACKUP_DIR}/.work-XXXXXX")
	# shellcheck disable=SC2064 # work の値はここで決まっているので、今の値で登録する
	trap "rm -rf -- '${work}'" EXIT
	data="${work}/data"
	mkdir -m 700 "$data"

	dump_db "${data}/misskey42.dump" "${work}/pgpass"

	cp -- "$CONFIG_FILE" "${data}/default.yml"

	if [[ -d "$FILES_DIR" ]]; then
		if ! dump_files "${data}/files.tar.zst"; then
			log "files/ をまとめられませんでした。files/ を含めずに続けます"
			rm -f -- "${data}/files.tar.zst"
			failed=1
		fi
	else
		log "${FILES_DIR} が無いので、files/ は含めません"
	fi

	(cd -- "$data" && sha256sum -- * > SHA256SUMS)
	archive="${work}/${name}"
	tar -C "$data" -cf "$archive" .
	mv -- "$archive" "${BACKUP_DIR}/${name}"
	log "バックアップを作りました: ${BACKUP_DIR}/${name} ($(du -h -- "${BACKUP_DIR}/${name}" | cut -f1))"

	if [[ -f "$R2_ENV_FILE" ]]; then
		if upload_r2 "${BACKUP_DIR}/${name}" "$name"; then
			log "R2 にアップロードしました: ${name}"
		else
			log "R2 へのアップロードに失敗しました。VPS の中のバックアップは残っています"
			failed=1
		fi
	else
		log "${R2_ENV_FILE} が無いので、R2 にはアップロードしません"
	fi

	prune_local

	if ((failed)); then
		log "一部が失敗しました"
		return 1
	fi
	log "完了しました"
}

main "$@"
