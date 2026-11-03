#!/usr/bin/env bash

# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only

# misskey-42 (https://42times.kinachan.com) で、オブジェクトストレージ (R2) を設定する前に VPS に保存された
# ドライブのファイル (files/) を、オブジェクトストレージに移すスクリプト。1 回だけ使う。
# 配置先: /home/misskey/42times/migrate-files-to-r2.sh と migrate-files-to-r2.mjs (compose.yml と同じディレクトリ)。
# migrate-files-to-r2.mjs はコンテナの misskey ユーザー (UID 991) が読めるよう chmod 644 にしておく。
#
# 使い方 (先にコントロールパネルでオブジェクトストレージを設定しておく):
#   ~/42times/migrate-files-to-r2.sh                           移行の計画を表示する (何も書き込まない)
#   ~/42times/migrate-files-to-r2.sh migrate --apply --limit 3 最初の 3 件だけ移す (試すとき)
#   ~/42times/migrate-files-to-r2.sh migrate --apply           残りをすべて移す
#   ~/42times/migrate-files-to-r2.sh cleanup                   どこからも参照されていない files/ のファイルを数える
#   ~/42times/migrate-files-to-r2.sh cleanup --apply           それを消す
#
# migrate --apply は、ファイルを 1 件ずつアップロードして確かめ、drive_file の行と、URL をコピーして持っている列
# (アバター・バナー・絵文字・サーバーのアイコンなど) を 1 つのトランザクションで書き換える。途中で止めても、
# もう一度実行すれば移行していないものから続けられる。files/ のファイルは消さないので、表示と画面を確かめてから
# cleanup --apply で消す。移行した後は Misskey を再起動する (メモリのキャッシュに古い URL が残るため)。
#
# 中身は migrate-files-to-r2.mjs で、動いているタグのイメージのコンテナの中で実行する。
# コンテナの中なら node_modules にある pg・@aws-sdk/client-s3 などを使え、UID 991 しか読めない files/ も読めるため。
# files/ は cleanup --apply のときだけ書き込めるようにマウントする。

set -euo pipefail
umask 077

DEPLOY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly DEPLOY_DIR
readonly CONFIG_FILE="${DEPLOY_DIR}/.config/default.yml"
readonly FILES_DIR="${DEPLOY_DIR}/files"
readonly SCRIPT_FILE="${DEPLOY_DIR}/migrate-files-to-r2.mjs"
readonly STATE_DIR="${DEPLOY_DIR}/state"
readonly CURRENT_TAG_FILE="${STATE_DIR}/current-tag"
readonly LOCK_FILE="${STATE_DIR}/migrate-files-to-r2.lock"
readonly IMAGE_REPO="ghcr.io/tomsato42/misskey-42"
readonly TAG_PATTERN='^sha-[0-9a-f]{7,40}$'
# コンテナの中の misskey ユーザー
readonly CONTAINER_UID=991
readonly CONTAINER_GID=991
# スクリプトを packages/backend の中に置くと、import するパッケージが packages/backend/node_modules から見つかる
readonly CONTAINER_SCRIPT="/misskey/packages/backend/migrate-files-to-r2.mjs"

log() {
	printf '[migrate-files %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

die() {
	log "エラー: $*"
	exit 1
}

# コンテナの misskey ユーザー (UID・GID 991) がファイルを読めるかを、持ち主・グループ・パーミッションから判断する
readable_by_container() {
	local file=$1 info uid gid mode
	info=$(stat -c '%u %g %a' -- "$file") || return 1
	read -r uid gid mode <<< "$info"
	[[ "$uid" =~ ^[0-9]+$ && "$gid" =~ ^[0-9]+$ && "$mode" =~ ^[0-7]+$ ]] || return 1
	mode=$((8#$mode))
	if ((uid == CONTAINER_UID)); then
		((mode & 8#400))
	elif ((gid == CONTAINER_GID)); then
		((mode & 8#040))
	else
		((mode & 8#004))
	fi
}

main() {
	local arg tag files_mount=ro has_cleanup=0 has_apply=0

	command -v docker > /dev/null || die "docker が見つかりません"
	command -v flock > /dev/null || die "flock が見つかりません"

	[[ -f "$SCRIPT_FILE" ]] || die "${SCRIPT_FILE} がありません。deploy/migrate-files-to-r2.mjs をこのスクリプトと同じディレクトリに置いてください"
	readable_by_container "$SCRIPT_FILE" \
		|| die "${SCRIPT_FILE} をコンテナの misskey ユーザー (UID 991) が読めません。chmod 644 ${SCRIPT_FILE} を実行してください"
	[[ -f "$CONFIG_FILE" ]] || die "${CONFIG_FILE} がありません"
	readable_by_container "$CONFIG_FILE" \
		|| die "${CONFIG_FILE} をコンテナの misskey ユーザー (UID 991) が読めません。Misskey と同じく、グループを 991、パーミッションを 640 にしてください (sudo chgrp 991 ${CONFIG_FILE} && sudo chmod 640 ${CONFIG_FILE})"
	[[ -d "$FILES_DIR" ]] || die "${FILES_DIR} がありません"

	# 動いている Misskey と同じイメージを使う。DB のスキーマと、import するパッケージのバージョンを Misskey と合わせるため
	[[ -f "$CURRENT_TAG_FILE" ]] || die "${CURRENT_TAG_FILE} が無いので、使うイメージが分かりません"
	tag=$(< "$CURRENT_TAG_FILE")
	[[ "$tag" =~ $TAG_PATTERN ]] || die "${CURRENT_TAG_FILE} の内容が正しくありません"
	docker image inspect "${IMAGE_REPO}:${tag}" > /dev/null 2>&1 \
		|| die "イメージ ${IMAGE_REPO}:${tag} がありません。deploy.sh でデプロイした後に実行してください"

	# 引数の解釈は migrate-files-to-r2.mjs が行う。ここではマウントの方法を決めるためだけに見る。
	# 判断を誤っても、読み取り専用のマウントで削除が失敗するだけで済む
	for arg in "$@"; do
		case "$arg" in
			cleanup) has_cleanup=1 ;;
			--apply) has_apply=1 ;;
		esac
	done
	if ((has_cleanup && has_apply)); then
		files_mount=rw
	fi

	# 同時に 2 つ動かないようにする。exec の後も docker run がこのファイルを開いたままにするので、終わるまでロックが続く
	exec 9> "$LOCK_FILE"
	flock -n 9 || die "別の migrate-files-to-r2.sh が実行中です"

	log "${IMAGE_REPO}:${tag} のコンテナで実行します"
	# --init: Ctrl-C を node に届ける (node がコンテナの PID 1 だとシグナルで止まらない)
	# --log-driver none: ファイル名などの出力をコンテナのログ (json-file) に残さない
	exec docker run --rm --init --pull never --network host --log-driver none \
		--user "${CONTAINER_UID}:${CONTAINER_GID}" \
		--volume "${CONFIG_FILE}:/misskey/.config/default.yml:ro" \
		--volume "${FILES_DIR}:/misskey/files:${files_mount}" \
		--volume "${SCRIPT_FILE}:${CONTAINER_SCRIPT}:ro" \
		--entrypoint node \
		"${IMAGE_REPO}:${tag}" \
		"$CONTAINER_SCRIPT" "$@"
}

main "$@"
