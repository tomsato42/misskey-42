#!/usr/bin/env bash
# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only

# VPS の default.yml に秘密の値を対話形式で書き込むスクリプト。
#
# 使い方 (VPS 上で、misskey ユーザーとして):
#   ~/42times/configure.sh [default.yml のパス]
#
# - パスワードや SECRET は画面に表示せずに入力する
# - 値は環境変数で python3 に渡すので、ps などのコマンドラインには出ない
# - YAML のコメントは残したまま、該当する行の値だけを書き換える
# - mediaGate.secret は自動で生成し、Worker に設定するためのファイル (media-gate-secret) も作る
# - 2 回目以降は、設定済みの項目ごとに上書きするかを確認する

set -euo pipefail
umask 077

CONFIG="${1:-$HOME/42times/.config/default.yml}"
CONFIG_DIR="$(dirname "$CONFIG")"
MEDIA_SECRET_FILE="$CONFIG_DIR/media-gate-secret"
PLACEHOLDER_MARK='ここに'

if [[ ! -f "$CONFIG" ]]; then
	echo "設定ファイルが見つかりません: $CONFIG" >&2
	exit 1
fi
if [[ ! -w "$CONFIG" ]]; then
	echo "設定ファイルに書き込めません: $CONFIG" >&2
	exit 1
fi
command -v python3 >/dev/null || { echo "python3 が必要です" >&2; exit 1; }
command -v openssl >/dev/null || { echo "openssl が必要です" >&2; exit 1; }

# section.key の現在の値を返す (section が空ならトップレベルのキー)
get_value() {
	SECTION="$1" KEY="$2" CONFIG="$CONFIG" python3 - <<'PY'
import os, re
section, key, path = os.environ['SECTION'], os.environ['KEY'], os.environ['CONFIG']
current = ''
with open(path, encoding='utf-8') as f:
	for line in f:
		if re.match(r'^[A-Za-z_]', line):
			current = line.split(':', 1)[0].strip()
		pattern = rf'^{re.escape(key)}:\s*(.*)$' if section == '' else rf'^  {re.escape(key)}:\s*(.*)$'
		if (section == '' and re.match(pattern, line)) or (section != '' and current == section and re.match(pattern, line)):
			print(re.match(pattern, line).group(1).strip())
			break
PY
}

# section.key の値を書き換える。値は環境変数 NEW_VALUE で渡す
set_value() {
	SECTION="$1" KEY="$2" CONFIG="$CONFIG" python3 - <<'PY'
import os, re
section, key, path = os.environ['SECTION'], os.environ['KEY'], os.environ['CONFIG']
value = os.environ['NEW_VALUE']
if '\n' in value or '\r' in value:
	raise SystemExit('値に改行を含めることはできません')
quoted = "'" + value.replace("'", "''") + "'"
with open(path, encoding='utf-8') as f:
	lines = f.readlines()
current = ''
replaced = False
for i, line in enumerate(lines):
	if re.match(r'^[A-Za-z_]', line):
		current = line.split(':', 1)[0].strip()
	if section == '':
		m = re.match(rf'^({re.escape(key)}:\s*)', line)
	else:
		m = re.match(rf'^(  {re.escape(key)}:\s*)', line) if current == section else None
	if m:
		lines[i] = m.group(1) + quoted + '\n'
		replaced = True
		break
if not replaced:
	raise SystemExit(f'{section + "." if section else ""}{key} の行が見つかりません')
# 所有者・グループ・パーミッションを保つため、ファイルを置き換えずに中身だけを書き直す
with open(path, 'r+', encoding='utf-8') as f:
	f.seek(0)
	f.writelines(lines)
	f.truncate()
PY
}

# 設定済みなら上書きするかを確認する。0 = 入力する / 1 = スキップ
should_ask() {
	local label="$1" current="$2"
	if [[ -z "$current" || "$current" == *"$PLACEHOLDER_MARK"* || "$current" == "''" ]]; then
		return 0
	fi
	local answer
	read -r -p "$label は設定済みです。上書きしますか? [y/N] " answer
	[[ "$answer" == "y" || "$answer" == "Y" ]]
}

read_secret_twice() {
	local label="$1" min_len="$2" first second
	while true; do
		read -r -s -p "$label: " first; echo
		if (( ${#first} < min_len )); then
			echo "  $min_len 文字以上にしてください。"
			continue
		fi
		read -r -s -p "$label (確認のためもう一度): " second; echo
		if [[ "$first" != "$second" ]]; then
			echo "  一致しませんでした。もう一度入力してください。"
			continue
		fi
		REPLY_VALUE="$first"
		return 0
	done
}

read_visible() {
	local label="$1" value
	while true; do
		read -r -p "$label: " value
		if [[ -n "$value" ]]; then
			REPLY_VALUE="$value"
			return 0
		fi
		echo "  空にはできません。"
	done
}

echo "設定ファイル: $CONFIG"
echo

# 1. setupPassword
if should_ask "setupPassword (最初の管理者を作るときのパスワード)" "$(get_value '' setupPassword)"; then
	read_secret_twice "setupPassword (最初の管理者を作るときのパスワード)" 12
	NEW_VALUE="$REPLY_VALUE" set_value '' setupPassword
	echo "  setupPassword を書き込みました。"
fi

# 2. db.pass
if should_ask "db.pass (PostgreSQL の misskey42 ロールのパスワード)" "$(get_value db pass)"; then
	read_secret_twice "db.pass (PostgreSQL の misskey42 ロールのパスワード)" 1
	NEW_VALUE="$REPLY_VALUE" set_value db pass
	echo "  db.pass を書き込みました。"
fi

# 2b. redis.pass (既存の Misskey と同じ Redis を使うので、既存の設定からコピーできる)
EXISTING_CONFIG="$HOME/misskey/.config/default.yml"
if should_ask "redis.pass (Redis のパスワード)" "$(get_value redis pass)"; then
	copied=0
	if [[ -r "$EXISTING_CONFIG" ]]; then
		read -r -p "既存の Misskey の設定 ($EXISTING_CONFIG) から Redis のパスワードをコピーしますか? [Y/n] " answer
		if [[ "$answer" != "n" && "$answer" != "N" ]]; then
			if existing_redis_pass="$(EXISTING_CONFIG="$EXISTING_CONFIG" python3 -c 'import os, yaml; print((yaml.safe_load(open(os.environ["EXISTING_CONFIG"])).get("redis") or {}).get("pass") or "", end="")')" && [[ -n "$existing_redis_pass" ]]; then
				NEW_VALUE="$existing_redis_pass" set_value redis pass
				unset existing_redis_pass
				copied=1
				echo "  redis.pass を既存の設定からコピーしました。"
			else
				echo "  既存の設定に redis.pass が見つかりませんでした。"
			fi
		fi
	fi
	if (( ! copied )); then
		read_secret_twice "redis.pass (Redis のパスワード)" 1
		NEW_VALUE="$REPLY_VALUE" set_value redis pass
		echo "  redis.pass を書き込みました。"
	fi
fi

# 3. intra.clientId (秘密ではないので表示する)
if should_ask "intra.clientId (42 intra のアプリの UID)" "$(get_value intra clientId)"; then
	read_visible "intra.clientId (42 intra のアプリの UID)"
	NEW_VALUE="$REPLY_VALUE" set_value intra clientId
	echo "  intra.clientId を書き込みました。"
fi

# 4. intra.clientSecret
if should_ask "intra.clientSecret (42 intra のアプリの SECRET)" "$(get_value intra clientSecret)"; then
	read_secret_twice "intra.clientSecret (42 intra のアプリの SECRET)" 1
	NEW_VALUE="$REPLY_VALUE" set_value intra clientSecret
	echo "  intra.clientSecret を書き込みました。"
fi

# 5. mediaGate.secret (自動生成)
current_media="$(get_value mediaGate secret)"
generate_media=0
if [[ -z "$current_media" || "$current_media" == *"$PLACEHOLDER_MARK"* ]]; then
	generate_media=1
else
	echo "mediaGate.secret は設定済みです。作り直すと、発行済みの画像用 Cookie がすべて無効になり、Worker の MEDIA_GATE_SECRET も設定し直す必要があります。"
	read -r -p "作り直しますか? [y/N] " answer
	[[ "$answer" == "y" || "$answer" == "Y" ]] && generate_media=1
fi
if (( generate_media )); then
	openssl rand -hex 32 > "$MEDIA_SECRET_FILE"
	chmod 600 "$MEDIA_SECRET_FILE"
	NEW_VALUE="$(cat "$MEDIA_SECRET_FILE")" set_value mediaGate secret
	echo "  mediaGate.secret を生成して書き込みました。"
	echo "  Worker に設定するための同じ値を $MEDIA_SECRET_FILE に保存しました (Worker に設定したら削除してください)。"
fi

# 確認: YAML として読めるか、プレースホルダーが残っていないか
echo
CONFIG="$CONFIG" python3 - <<'PY'
import os, yaml
with open(os.environ['CONFIG'], encoding='utf-8') as f:
	text = f.read()
yaml.safe_load(text)
print('YAML として読み込めました。')
PY
if grep -qE "^[^#]*$PLACEHOLDER_MARK" "$CONFIG"; then
	echo "まだ「$PLACEHOLDER_MARK」と書かれた値が残っています:"
	grep -nE "^[^#]*$PLACEHOLDER_MARK" "$CONFIG" | sed -E "s/:.*/: (値は表示しません)/"
else
	echo "未設定の値は残っていません。"
fi

# 権限の設定 (sudo)
echo
echo "コンテナの中の misskey ユーザー (UID・GID 991) が設定を読めて、files/ に書き込めるようにします (sudo を使います)。"
read -r -p "今実行しますか? [Y/n] " answer
if [[ "$answer" != "n" && "$answer" != "N" ]]; then
	sudo chown "$(id -un)":991 "$CONFIG"
	sudo chmod 640 "$CONFIG"
	sudo install -d -o 991 -g 991 -m 700 "$(dirname "$CONFIG_DIR")/files"
	ls -l "$CONFIG"
	echo "権限を設定しました。"
fi
