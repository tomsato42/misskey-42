#!/usr/bin/env bash

# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only

# misskey-42 (https://42times.kinachan.com) を VPS 上で更新するスクリプト。
# 配置先: /home/misskey/42times/deploy.sh (compose.yml と同じディレクトリ)
#
# 使い方:
#   - GitHub Actions から: デプロイ鍵の authorized_keys に command="/home/misskey/42times/deploy.sh" を付けて
#     このスクリプトを強制的に実行させる。ssh に渡した文字列 (イメージのタグ) が SSH_ORIGINAL_COMMAND に入る
#   - 手で実行する (前のタグに戻すときなど): ./deploy.sh sha-0123abc
#
# 処理の流れ:
#   1. タグの形式 (sha-<16進数 7〜40 文字>) を確かめる
#   2. docker compose pull でイメージを取得する (失敗したら、動いているコンテナには触らずに終わる)
#   3. docker compose up -d でコンテナを作り直し、ヘルスチェックが healthy になるまで待つ
#   4. 成功したら state/current-tag にタグを記録し、古いイメージを消す
#   5. 失敗したら state/current-tag に記録されている前のタグで起動し直し、終了コード 1 で終わる
#
# 注意: 新しいイメージのマイグレーションが実行された後に前のタグへ戻しても、DB のスキーマは戻らない。

set -euo pipefail
umask 077

DEPLOY_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
readonly DEPLOY_DIR
readonly COMPOSE_FILE="${DEPLOY_DIR}/compose.yml"
readonly STATE_DIR="${DEPLOY_DIR}/state"
readonly CURRENT_TAG_FILE="${STATE_DIR}/current-tag"
readonly HISTORY_FILE="${STATE_DIR}/history.log"
readonly LOCK_FILE="${STATE_DIR}/deploy.lock"
readonly IMAGE_REPO="ghcr.io/tomsato42/misskey-42"
readonly IMAGE_SOURCE_LABEL="org.opencontainers.image.source=https://github.com/tomsato42/misskey-42"
readonly SERVICE="web"
readonly TAG_PATTERN='^sha-[0-9a-f]{7,40}$'
# ヘルスチェックを待つ時間 (秒)。compose.yml の start_period (300 秒) より長くする
readonly HEALTH_TIMEOUT_SEC="${HEALTH_TIMEOUT_SEC:-600}"

log() {
	printf '[deploy %s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*" >&2
}

die() {
	log "エラー: $*"
	exit 1
}

# compose を、指定したタグで実行する。第 1 引数がタグ、残りが docker compose のサブコマンドと引数
compose() {
	local tag=$1
	shift
	IMAGE_TAG="$tag" docker compose --project-directory "$DEPLOY_DIR" -f "$COMPOSE_FILE" "$@"
}

# コンテナが指定したイメージで動いていて、ヘルスチェックが healthy になるまで待つ
wait_healthy() {
	local tag=$1
	local expected_image="${IMAGE_REPO}:${tag}"
	local deadline=$((SECONDS + HEALTH_TIMEOUT_SEC))
	local cid state image

	while ((SECONDS < deadline)); do
		cid=$(compose "$tag" ps -a -q "$SERVICE" 2>/dev/null || true)
		if [[ -n "$cid" ]]; then
			image=$(docker inspect -f '{{.Config.Image}}' "$cid" 2>/dev/null || true)
			state=$(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$cid" 2>/dev/null || true)
			if [[ "$image" != "$expected_image" ]]; then
				log "コンテナのイメージが ${image:-不明} です (期待値 ${expected_image})"
				return 1
			fi
			case "$state" in
				'running healthy')
					log "ヘルスチェックが通りました"
					return 0
					;;
				'running unhealthy')
					log "ヘルスチェックが失敗しました"
					return 1
					;;
				running*)
					;;
				*)
					# exited・restarting・dead など。起動直後に異常終了している
					log "コンテナが動いていません (${state:-不明})"
					return 1
					;;
			esac
		fi
		sleep 5
	done

	log "${HEALTH_TIMEOUT_SEC} 秒待ってもヘルスチェックが通りませんでした"
	return 1
}

# 指定したタグでコンテナを作り直し、healthy になるまで待つ
start_tag() {
	local tag=$1
	log "${IMAGE_REPO}:${tag} でコンテナを起動します"
	compose "$tag" up -d --no-build --remove-orphans "$SERVICE" || return 1
	wait_healthy "$tag"
}

show_logs() {
	local tag=$1
	log "コンテナのログ (最後の 80 行):"
	compose "$tag" logs --no-color --tail 80 "$SERVICE" >&2 || true
}

record_success() {
	local tag=$1 previous=$2
	printf '%s\n' "$tag" > "${CURRENT_TAG_FILE}.tmp"
	mv -f "${CURRENT_TAG_FILE}.tmp" "$CURRENT_TAG_FILE"
	printf '%s deployed=%s previous=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$tag" "${previous:--}" >> "$HISTORY_FILE"
}

# 今のタグと前のタグ以外の、このリポジトリのイメージを消す (戻すときに使うので前のタグは残す)
prune_images() {
	local keep1=$1 keep2=$2 ref
	while IFS= read -r ref; do
		if [[ "$ref" == "${IMAGE_REPO}:${keep1}" || "$ref" == "${IMAGE_REPO}:${keep2}" ]]; then
			continue
		fi
		docker image rm "$ref" > /dev/null 2>&1 || true
	done < <(docker image ls "$IMAGE_REPO" --format '{{.Repository}}:{{.Tag}}' 2>/dev/null || true)
	docker image prune -f --filter "label=${IMAGE_SOURCE_LABEL}" > /dev/null 2>&1 || true
}

main() {
	# 手で実行したときは第 1 引数、強制コマンドで実行されたときは SSH_ORIGINAL_COMMAND からタグを受け取る
	local tag="${1:-${SSH_ORIGINAL_COMMAND:-}}"
	if [[ ! "$tag" =~ $TAG_PATTERN ]]; then
		die "タグの形式が正しくありません。sha-<コミットの短い SHA> を指定してください (例: sha-0123abc)"
	fi

	[[ -f "$COMPOSE_FILE" ]] || die "${COMPOSE_FILE} がありません"
	[[ -f "${DEPLOY_DIR}/.config/default.yml" ]] || die "${DEPLOY_DIR}/.config/default.yml がありません"

	mkdir -p "$STATE_DIR"

	# 同時に 2 つのデプロイが動かないようにする
	exec 9> "$LOCK_FILE"
	if ! flock -w 300 9; then
		die "別のデプロイが実行中です"
	fi

	local previous=""
	if [[ -f "$CURRENT_TAG_FILE" ]]; then
		previous=$(< "$CURRENT_TAG_FILE")
		if [[ ! "$previous" =~ $TAG_PATTERN ]]; then
			log "${CURRENT_TAG_FILE} の内容が正しくないので、前のタグは無いものとして扱います"
			previous=""
		fi
	fi
	log "デプロイするタグ: ${tag} (前のタグ: ${previous:-なし})"

	log "イメージを取得します"
	compose "$tag" pull --quiet "$SERVICE" || die "イメージを取得できませんでした。動いているコンテナはそのままです"

	if start_tag "$tag"; then
		record_success "$tag" "$previous"
		prune_images "$tag" "$previous"
		log "デプロイが完了しました: ${tag}"
		return 0
	fi

	log "デプロイに失敗しました: ${tag}"
	show_logs "$tag"

	if [[ -n "$previous" && "$previous" != "$tag" ]]; then
		log "前のタグ ${previous} に戻します"
		if start_tag "$previous"; then
			log "前のタグ ${previous} に戻しました"
		else
			log "前のタグ ${previous} にも戻せませんでした。VPS で状態を確かめてください"
			show_logs "$previous"
		fi
	else
		log "戻す先のタグがありません"
	fi

	return 1
}

main "$@"
