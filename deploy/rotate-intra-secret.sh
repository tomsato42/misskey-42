#!/usr/bin/env bash
# SPDX-FileCopyrightText: syuilo and misskey-project
# SPDX-License-Identifier: AGPL-3.0-only

# 42 intra のアプリで発行した「次の SECRET」を default.yml に入れて、Misskey を再起動するスクリプト。
#
# 使い方 (VPS 上で、misskey ユーザーとして。Windows からは ssh -t misskey-vps '~/42times/rotate-intra-secret.sh'):
#   ~/42times/rotate-intra-secret.sh [default.yml のパス]
#   SECRET は画面に表示せずに入力する。標準入力から 1 行で渡してもよい
#
# 42 のアプリの SECRET には期限がある。期限の前に intra のアプリのページで次の SECRET を発行できるので、
# それをこのスクリプトに渡しておくと、今の SECRET が期限切れで拒否 (401) されたときに backend が自動で次の SECRET に切り替える。
#
# 書き換えのしかた:
# - intra.clientSecretNext が空なら、渡した SECRET を clientSecretNext に入れる (clientSecret はそのまま)
# - clientSecretNext が入っていれば、それはもう使われている (または次に使われる) SECRET なので clientSecret に移し、
#   渡した SECRET を新しい clientSecretNext にする
# - 渡した SECRET がすでに入っていれば何もしない
#
# 書き換えの前後で、42 API にそれぞれの SECRET でトークンを取れるかを試して表示する (SECRET とトークンは表示しない)。
# 書き換えた後は docker compose restart で Misskey を再起動する (--no-restart で再起動しない)。

set -euo pipefail
umask 077

RESTART=1
CONFIG=""
for arg in "$@"; do
	case "$arg" in
		--no-restart) RESTART=0 ;;
		-h|--help) sed -n '5,21p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
		*) CONFIG="$arg" ;;
	esac
done
CONFIG="${CONFIG:-$HOME/42times/.config/default.yml}"
APP_DIR="$(dirname "$(dirname "$CONFIG")")"

if [[ ! -f "$CONFIG" ]]; then
	echo "設定ファイルが見つかりません: $CONFIG" >&2
	exit 1
fi
if [[ ! -w "$CONFIG" ]]; then
	echo "設定ファイルに書き込めません: $CONFIG" >&2
	exit 1
fi
command -v python3 >/dev/null || { echo "python3 が必要です" >&2; exit 1; }
command -v curl >/dev/null || { echo "curl が必要です" >&2; exit 1; }

# intra.<key> の値を返す (無ければ空)。引用符は外す
get_value() {
	KEY="$1" CONFIG="$CONFIG" python3 - <<'PY'
import os, yaml
with open(os.environ['CONFIG'], encoding='utf-8') as f:
	intra = (yaml.safe_load(f) or {}).get('intra') or {}
value = intra.get(os.environ['KEY'])
print('' if value is None else str(value), end='')
PY
}

# intra.<key> の値を書き換える。行が無ければ intra.clientSecret の次の行に足す。値は環境変数 NEW_VALUE で渡す
set_value() {
	KEY="$1" CONFIG="$CONFIG" python3 - <<'PY'
import os, re
key, path = os.environ['KEY'], os.environ['CONFIG']
value = os.environ['NEW_VALUE']
if '\n' in value or '\r' in value:
	raise SystemExit('値に改行を含めることはできません')
quoted = "'" + value.replace("'", "''") + "'"
with open(path, encoding='utf-8') as f:
	lines = f.readlines()
current = ''
target = None
anchor = None
for i, line in enumerate(lines):
	if re.match(r'^[A-Za-z_]', line):
		current = line.split(':', 1)[0].strip()
	if current != 'intra':
		continue
	# コメントアウトした行 (  #clientSecretNext: ...) も書き換える
	if re.match(rf'^  #?\s*{re.escape(key)}:', line) and target is None:
		target = i
	if re.match(r'^  clientSecret:', line):
		anchor = i
new_line = f'  {key}: {quoted}\n'
if target is not None:
	lines[target] = new_line
elif anchor is not None:
	lines.insert(anchor + 1, new_line)
else:
	raise SystemExit('intra.clientSecret の行が見つかりません')
# 所有者・グループ・パーミッションを保つため、ファイルを置き換えずに中身だけを書き直す
with open(path, 'r+', encoding='utf-8') as f:
	f.seek(0)
	f.writelines(lines)
	f.truncate()
PY
}

# SECRET で client_credentials のトークンを取れるかを試し、HTTP のステータスを返す。SECRET は環境変数と標準入力で渡し、コマンドラインに出さない
check_secret() {
	local secret="$1" base
	base="$(get_value apiBaseUrl)"
	base="${base:-https://api.intra.42.fr}"
	CLIENT_ID="$(get_value clientId)" CLIENT_SECRET="$secret" python3 -c '
import os, urllib.parse, sys
sys.stdout.write(urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": os.environ["CLIENT_ID"], "client_secret": os.environ["CLIENT_SECRET"]}))
' | curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST "${base%/}/oauth/token" \
		-H 'Content-Type: application/x-www-form-urlencoded' --data-binary @- 2>/dev/null || true
}

describe() {
	case "$1" in
		200) echo "使える" ;;
		401) echo "拒否された (期限切れか、まだ有効になっていない)" ;;
		000) echo "42 API に繋がらなかった" ;;
		*) echo "確かめられなかった ($1)" ;;
	esac
}

# 次の SECRET を受け取る
if [[ -t 0 ]]; then
	while true; do
		read -r -s -p "42 で発行した次の SECRET: " NEW_SECRET; echo
		[[ -n "$NEW_SECRET" ]] || { echo "  空にはできません。"; continue; }
		read -r -s -p "確認のためもう一度: " again; echo
		[[ "$NEW_SECRET" == "$again" ]] && break
		echo "  一致しませんでした。もう一度入力してください。"
	done
else
	IFS= read -r NEW_SECRET || true
fi
NEW_SECRET="${NEW_SECRET//$'\r'/}"
NEW_SECRET="${NEW_SECRET#"${NEW_SECRET%%[![:space:]]*}"}"
NEW_SECRET="${NEW_SECRET%"${NEW_SECRET##*[![:space:]]}"}"
if [[ -z "$NEW_SECRET" ]]; then
	echo "SECRET が空です。" >&2
	exit 1
fi

CURRENT="$(get_value clientSecret)"
NEXT="$(get_value clientSecretNext)"

if [[ "$NEW_SECRET" == "$CURRENT" || "$NEW_SECRET" == "$NEXT" ]]; then
	echo "この SECRET はすでに default.yml に入っています。何も変えません。"
	exit 0
fi

echo "書き換える前に、42 API でそれぞれの SECRET を試します。"
echo "  今の clientSecret: $(describe "$(check_secret "$CURRENT")")"
[[ -n "$NEXT" ]] && echo "  今の clientSecretNext: $(describe "$(check_secret "$NEXT")")"
echo "  渡した SECRET: $(describe "$(check_secret "$NEW_SECRET")")"
echo

if [[ -n "$NEXT" ]]; then
	NEW_VALUE="$NEXT" set_value clientSecret
	NEW_VALUE="$NEW_SECRET" set_value clientSecretNext
	echo "clientSecretNext に入っていた SECRET を clientSecret に移し、渡した SECRET を clientSecretNext に入れました。"
else
	NEW_VALUE="$NEW_SECRET" set_value clientSecretNext
	echo "渡した SECRET を clientSecretNext に入れました (clientSecret はそのまま)。"
fi
unset NEW_SECRET NEXT CURRENT

CONFIG="$CONFIG" python3 -c 'import os, yaml; yaml.safe_load(open(os.environ["CONFIG"], encoding="utf-8"))' \
	|| { echo "default.yml を YAML として読めなくなりました。手で直してください。" >&2; exit 1; }

if (( ! RESTART )); then
	echo "--no-restart なので再起動しません。反映するには Misskey を再起動してください。"
	exit 0
fi

echo "Misskey を再起動します。"
cd "$APP_DIR"
IMAGE_TAG="$(cat state/current-tag)" docker compose restart web
echo "再起動しました。今の SECRET が拒否されると、自動で clientSecretNext に切り替わります。"
