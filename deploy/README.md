# VPS へのデプロイ (42times.kinachan.com)

misskey-42 を `https://42times.kinachan.com` として VPS で動かすためのファイルと、初回セットアップの手順です。

## 構成

```
GitHub (main に push / 手動実行)
  └─ .github/workflows/fork-deploy.yml
       1. build : Dockerfile からイメージを作り GHCR (ghcr.io/tomsato42/misskey-42) に push
       2. deploy: Tailscale で tailnet に入り、デプロイ鍵で VPS に SSH → deploy.sh が実行される
       3. verify: 公開 URL を curl で確認

利用者 ─→ Cloudflare (プロキシ) ─┬─ /media/*  → Cloudflare Worker → R2 (42times-files)
                                 └─ それ以外  → VPS の nginx (443) → Misskey (Docker、ポート 3001)
                                                                       ├→ PostgreSQL 15 (VPS に直接、DB misskey42)
                                                                       └→ Redis 8 (VPS に直接、DB 番号 1)
```

- 既存の Misskey (mi.kinachan.com、ポート 3000、systemd) とは、PostgreSQL・Redis・nginx を共有します。DB とロール、Redis の DB 番号は分けます。
- VPS ではビルドしません (メモリが 2GB しかないため)。GitHub Actions でビルドしたイメージを pull して動かします。

## ファイル

| ファイル | VPS での置き場所 | 内容 |
| --- | --- | --- |
| `compose.yml` | `/home/misskey/42times/compose.yml` | サービス `web` の定義 (host ネットワーク、メモリ上限 768MB、ログのローテーション) |
| `deploy.sh` | `/home/misskey/42times/deploy.sh` | タグを受け取って pull → 起動 → ヘルスチェック待ち。失敗したら前のタグに戻す |
| `backup.sh` | `/home/misskey/42times/backup.sh` | 1 日 1 回のバックアップ (DB・設定・`files/`)。7 個残し、R2 にも送る ([バックアップ](#バックアップ)) |
| `default.yml.example` | `/home/misskey/42times/.config/default.yml` (コピーして編集) | 本番用の設定の例。秘密の値はダミー |
| `nginx/42times.kinachan.com.conf` | `/etc/nginx/conf.d/42times.kinachan.com.conf` | nginx の server ブロック |

VPS の `/home/misskey/42times/` は最終的に次のようになります。

```
/home/misskey/42times/
├── compose.yml
├── deploy.sh
├── backup.sh
├── .config/default.yml   (秘密の値を含む。グループ 991 が読める 640)
├── .config/backup-r2.env (バックアップを送る R2 の鍵。600)
├── nginx/                (nginx の設定の控え。実際に読まれるのは /etc/nginx/conf.d/ のもの)
├── files/                (コンテナの misskey ユーザー (UID 991) が書き込む)
└── state/                (deploy.sh が作る。current-tag に動いているタグ、history.log に履歴。backup.log はバックアップのログ)

/home/misskey/42times-backups/   (backup.sh が作る。42times-<日時>.tar を新しい 7 個だけ残す)
```

このディレクトリのファイルは、リポジトリを更新しても自動では VPS に反映されません。`compose.yml`・`deploy.sh`・`backup.sh` を変えたときは、手順 3 と同じ方法で置き直してください。ワークフローは `deploy/` だけの変更では走りません。

## 初回セットアップ

各手順の見出しに担当を書いています。

- **ユーザー**: sudo が必要な作業、各サービスのダッシュボードでの操作、秘密の値の入力。Claude には sudo のパスワードや秘密の値を渡さないでください。
- **Claude**: sudo を使わずにできる作業。頼まれたときに Claude が実行できます。

### 1. Docker Compose と docker グループ (ユーザー)

VPS の Docker は Ubuntu の `docker.io` パッケージなので、Compose も Ubuntu のパッケージを入れます。

```sh
sudo apt update
sudo apt install docker-compose-v2
sudo usermod -aG docker misskey
```

グループの追加は、次にログインしたときから効きます。一度ログアウトしてから、次で確認します。

```sh
docker compose version
docker ps
```

`docker` グループに入ったユーザーは、実質的に root と同じ権限を持ちます。デプロイ鍵は手順 12 で `deploy.sh` しか実行できないように制限します。

### 2. PostgreSQL のロールと DB (ユーザー)

パスワードがシェルや psql の履歴に残らないように、`\password` で設定します。

```sh
sudo -u postgres psql
```

```sql
CREATE ROLE misskey42 LOGIN;
\password misskey42
CREATE DATABASE misskey42 OWNER misskey42 ENCODING 'UTF8' TEMPLATE template0;
\q
```

設定したパスワードは、手順 10 で `default.yml` の `db.pass` に入れます。

### 3. VPS にファイルを置く (Claude)

ディレクトリを作り、リポジトリの `deploy/` のファイルを置きます。秘密の値はまだ入れません (手順 10 で入れます)。ここは sudo なしでできます。

```sh
# ローカルの PC (リポジトリのルート) で
ssh misskey-vps 'install -d -m 700 /home/misskey/42times /home/misskey/42times/.config /home/misskey/42times/nginx'
scp deploy/compose.yml deploy/deploy.sh misskey-vps:/home/misskey/42times/
scp deploy/default.yml.example misskey-vps:/home/misskey/42times/.config/default.yml
scp deploy/nginx/42times.kinachan.com.conf misskey-vps:/home/misskey/42times/nginx/
ssh misskey-vps 'chmod 700 /home/misskey/42times/deploy.sh && chmod 600 /home/misskey/42times/compose.yml /home/misskey/42times/.config/default.yml'
```

### 4. Cloudflare の DNS と SSL/TLS (ユーザー)

Cloudflare のダッシュボードで `kinachan.com` のゾーンを開きます。

1. DNS に A レコードを追加します。名前は `42times`、IP アドレスは `mi` のレコードと同じ、プロキシは有効 (オレンジの雲) にします。`mi` に AAAA レコードがあれば、`42times` にも同じものを追加します。
2. SSL/TLS の暗号化モードが「フル (厳密)」(Full (strict)) になっていることを確認します。VPS には Let's Encrypt の正式な証明書を置くので、このモードで動きます。
3. Security の Bot Fight Mode などで GitHub Actions のランナーからのアクセスがチャレンジされると、ワークフローの verify ジョブが失敗します。失敗したときは、Security のイベントログで止められていないかを確認してください。

### 5. 証明書の取得 (ユーザー)

既存の mi.kinachan.com と同じく、certbot の dns-cloudflare プラグインで取ります (VPS の `/etc/letsencrypt/renewal/mi.kinachan.com.conf` と同じ方法)。

```sh
sudo certbot certonly \
  --dns-cloudflare \
  --dns-cloudflare-credentials /etc/cloudflare/cloudflare.ini \
  --dns-cloudflare-propagation-seconds 60 \
  -d 42times.kinachan.com
```

証明書は `/etc/letsencrypt/live/42times.kinachan.com/` に入ります。更新は certbot のタイマーが行います。更新後に nginx に読み込ませるには、`--deploy-hook "systemctl reload nginx"` を付けておくか、`/etc/letsencrypt/renewal-hooks/deploy/` に reload するスクリプトを置きます (今は `ntpsec` だけが置かれています)。

### 6. nginx の設定 (ユーザー)

ログイン画面のアイコン用のディレクトリを作ります。これは sudo なしでできます (Claude でもできます)。

```sh
mkdir -p /home/misskey/42times-assets
chmod 755 /home/misskey/42times-assets
```

nginx は `nginx` ユーザーで動いていて、`/home/misskey` (パーミッション 750) の中を読めません。`nginx` ユーザーにだけ、`/home/misskey` を通る権限 (x) を与えます。VPS には `setfacl` が入っていないので、先に `acl` パッケージを入れます。

```sh
sudo apt install acl
sudo setfacl -m u:nginx:x /home/misskey
```

この権限があると、`nginx` ユーザーは `/home/misskey` の下で「その他」に読み取りが許されているファイルを、パスを知っていれば読めます (一覧は見られません)。避けたい場合は、アイコンの置き場所を `/var/www/42times-assets` などに変え、設定の `alias` も合わせて変えてください。

設定ファイルを置いて、構文を確かめてから読み込ませます。

```sh
sudo cp /home/misskey/42times/nginx/42times.kinachan.com.conf /etc/nginx/conf.d/42times.kinachan.com.conf
sudo nginx -t
sudo systemctl reload nginx
```

(上の `cp` 元は、手順 3 で Claude にリポジトリの `deploy/nginx/42times.kinachan.com.conf` を置いてもらう場所の例です。手で置く場合はどこからでも構いません。)

設定ファイルの中身について:

- `map $http_upgrade $connection_upgrade` は `mi.kinachan.com.conf` で定義済みのものを使います。同じ変数をもう一度定義すると `nginx -t` がエラーになるので、このファイルには入れていません。
- クライアントの IP は、Cloudflare の IP 範囲から来たリクエストのときだけ `CF-Connecting-IP` を信頼して取り出し、`X-Forwarded-For` をその値 1 つで上書きして Misskey に渡します。Misskey の `trustProxy` はループバックだけにします。こうすると nginx のログと fail2ban にも本当の IP が出て、Cloudflare の IP 範囲を nginx の設定 1 か所で管理できます。Cloudflare の IP 範囲 (https://www.cloudflare.com/ips/) が変わったら更新してください。
- 既存の設定と違い、`proxy_cache` は使いません。ログインした人にだけ見せる内容を共有のキャッシュに入れないためです。

### 7. ファイアウォールの確認 (ユーザー、外からの確認は Claude)

Misskey はホストの `0.0.0.0:3000` (既存) と `0.0.0.0:3001` (新しいもの) で待ち受けます。ufw で、この 2 つのポートが外部に開いていないことを確認します。

```sh
sudo ufw status verbose
```

- `Default: deny (incoming)` になっていること
- 3000 と 3001 を許可する規則が無いこと (80・443・<SSH のポート> など、必要なものだけが許可されていること)

`compose.yml` は host ネットワークを使うので、Docker が iptables に規則を足すことはなく、ufw の設定がそのまま効きます (`ports:` でポートを公開する方式だと ufw を素通りします)。

外からの確認は、Tailscale を経由しない回線から VPS のグローバル IP に接続して、つながらないことを見ます (Claude でもできます)。

```sh
curl -sS --max-time 5 http://<VPS のグローバル IP>:3000/ ; echo "exit=$?"
curl -sS --max-time 5 http://<VPS のグローバル IP>:3001/ ; echo "exit=$?"
```

どちらもタイムアウトか接続拒否 (`exit=28` か `exit=7`) になれば問題ありません。

### 8. 42 intra でのアプリケーション登録 (ユーザー)

42 intra の API の設定画面で新しいアプリケーションを登録します。

- Redirect URI: `https://42times.kinachan.com/api/intra/callback`
- 表示される UID と SECRET を控えます。手順 10 で `default.yml` の `intra.clientId` と `intra.clientSecret` に入れます。

### 9. R2 の API トークン、Worker のデプロイ (ユーザー)

手順は [cloudflare/media-worker/README.md](../cloudflare/media-worker/README.md) にあります。ここでは次の 3 つを行います。

1. 署名用の秘密の値を作る (`openssl rand -base64 48`)。手順 10 で `default.yml` の `mediaGate.secret` に入れ、Worker の `MEDIA_GATE_SECRET` にも同じ値を設定します。
2. R2 の API トークンを作る (バケット `42times-files` だけ、オブジェクトの読み取りと書き込み)。Access Key ID と Secret Access Key は手順 15 で Misskey の管理画面に入れます。
3. Worker をデプロイする (`wrangler secret put MEDIA_GATE_SECRET`、`wrangler deploy`)。

Worker が無いと、手順 15 のワークフローの verify ジョブが `/media/` の確認で失敗します。

### 10. default.yml の秘密の値と権限 (ユーザー)

VPS で `~/42times/configure.sh` を実行すると、下の表の値を対話形式で入力でき、mediaGate の secret の生成と権限の設定までまとめて行えます (`deploy/configure.sh` を手順 3 と同じ方法で置いておきます)。手で編集する場合は、`/home/misskey/42times/.config/default.yml` を開き、「ここに入れる」と書いた値をすべて書き換えます。

| 項目 | 入れる値 |
| --- | --- |
| `setupPassword` | 最初の管理者を作るときのパスワード (新しく決める) |
| `db.pass` | 手順 2 のパスワード |
| `redis.pass` | VPS の Redis のパスワード (既存の Misskey の `~/misskey/.config/default.yml` の `redis.pass` と同じ。`configure.sh` はそこからコピーできる) |
| `intra.clientId` / `intra.clientSecret` | 手順 8 の UID と SECRET |
| `mediaGate.secret` | 手順 9 で作った値 |

次に、コンテナの中の `misskey` ユーザー (UID・GID 991) が設定を読めて、`files/` に書き込めるようにします。

```sh
sudo chown misskey:991 /home/misskey/42times/.config/default.yml
sudo chmod 640 /home/misskey/42times/.config/default.yml
sudo install -d -o 991 -g 991 -m 700 /home/misskey/42times/files
```

`default.yml` を編集し直した後は、`ls -l` でグループが 991 のままか確認してください。エディタによってはファイルを作り直してグループが変わります。

### 11. GHCR にログインする (ユーザー)

イメージは GHCR の private パッケージなので、VPS から pull するにはログインが必要です。

1. GitHub の Settings → Developer settings → Personal access tokens → Tokens (classic) で、スコープを `read:packages` だけにしたトークンを作ります (GHCR は fine-grained トークンに対応していないため classic を使います)。有効期限を付けた場合は、切れる前に作り直してください。
2. VPS で次を実行し、パスワードの入力欄にトークンを貼り付けます。

```sh
docker login ghcr.io -u tomsato42
```

トークンは `/home/misskey/.docker/config.json` に保存されます (暗号化はされません。ファイルは misskey ユーザーしか読めません)。パッケージ `ghcr.io/tomsato42/misskey-42` は、手順 15 の最初のビルドで作られます。

### 12. デプロイ鍵 (ユーザー)

GitHub Actions が VPS に SSH するための専用の鍵を作ります。秘密鍵は VPS 上で作り、GitHub の secret に登録したら VPS からも消します。手元の PC には保存しません。

VPS で:

```sh
ssh-keygen -t ed25519 -N '' -C 'github-actions-deploy@42times' -f ~/42times-deploy-key
```

公開鍵を `authorized_keys` に、強制コマンドと制限を付けて追加します。

```sh
printf 'restrict,from="100.64.0.0/10",command="/home/misskey/42times/deploy.sh" %s\n' "$(cat ~/42times-deploy-key.pub)" >> ~/.ssh/authorized_keys
```

- `command=`: この鍵で接続すると、何を指定しても `deploy.sh` だけが実行されます。ssh に渡した文字列 (イメージのタグ) は `SSH_ORIGINAL_COMMAND` として `deploy.sh` に届き、`deploy.sh` が形式を確かめます。
- `restrict`: ポート転送、エージェント転送、X11 転送、PTY の割り当て、`~/.ssh/rc` の実行をすべて禁止します。
- `from="100.64.0.0/10"`: Tailscale のアドレス (100.64.0.0/10) からの接続だけ受け付けます。

秘密鍵の中身を表示して、GitHub の secret `DEPLOY_SSH_KEY` に貼り付けます (登録先は手順 14)。`-----BEGIN` の行から `-----END` の行まで全部を貼ります。

```sh
cat ~/42times-deploy-key
```

登録できたら、VPS の秘密鍵を消します。VPS には公開鍵 (`authorized_keys` に追加済み) だけがあれば足ります。

```sh
shred -u ~/42times-deploy-key
rm ~/42times-deploy-key.pub
```

コピーに使ったクリップボードは、ほかの文字列をコピーして上書きしておいてください。

### 13. Tailscale の OAuth クライアントと ACL (ユーザー)

Tailscale の管理画面で行います。

1. Access controls (ポリシーファイル) に、タグ `tag:ci` と、そのタグから VPS の SSH ポートだけへの通信を許す規則を追加します。

   ```jsonc
   {
     "tagOwners": {
       "tag:ci": ["autogroup:admin"],
     },
     "hosts": {
       "misskey-vps": "<VPS の Tailscale IP>",
     },
     "acls": [
       // 自分の端末どうしの通信。タグ付きの端末 (tag:ci) は autogroup:member に含まれない
       {"action": "accept", "src": ["autogroup:member"], "dst": ["*:*"]},
       // GitHub Actions のランナーからは、VPS の SSH (<SSH のポート>) だけ
       {"action": "accept", "src": ["tag:ci"], "dst": ["misskey-vps:<SSH のポート>"]},
     ],
   }
   ```

   これは例です。今のポリシーに既存の規則があれば、それに追記してください。ポリシーが初期状態 (`"src": ["*"], "dst": ["*:*"]`) のままだと、`tag:ci` の端末も tailnet のすべての端末に接続できてしまいます。その場合は、上のように `src` を `autogroup:member` に変えてください。

2. Settings → Trust credentials (以前の名前は OAuth clients) で新しい OAuth クライアントを作ります。スコープは Auth Keys の Write、タグは `tag:ci` にします。
3. 表示された Client ID と Client secret を、GitHub の secret `TS_OAUTH_CLIENT_ID` と `TS_OAUTH_SECRET` に登録します (手順 14)。Client secret は作成時にしか表示されません。

ワークフローが作るノードはエフェメラルで、ジョブが終わると tailnet から消えます。

### 14. GitHub の environment `production` と secret (ユーザー)

1. リポジトリの Settings → Environments で `production` を作ります。
2. Deployment branches and tags で `main` だけを許可します。必要なら Required reviewers を設定すると、デプロイの前に承認が必要になります。
3. `production` の Environment secrets に次の 3 つを登録します。

| secret | 値 |
| --- | --- |
| `TS_OAUTH_CLIENT_ID` | 手順 13 の Client ID |
| `TS_OAUTH_SECRET` | 手順 13 の Client secret |
| `DEPLOY_SSH_KEY` | 手順 12 の秘密鍵 |

GitHub のドキュメントでは、Free プランの private リポジトリでは environment の secret と保護ルールを使えないとされています。その場合は、同じ名前でリポジトリの secret (Settings → Secrets and variables → Actions) に登録してください。ワークフローはどちらに登録しても同じように読めます。

4. VPS の接続先は、公開リポジトリのファイルに書かず、リポジトリの secret (Settings → Secrets and variables → Actions → Secrets) に登録します。リポジトリが public なので、Actions のログで伏せ字にならない Variables には置きません。ワークフロー全体の env で読むので、environment ではなくリポジトリの secret にします。

| secret | 値 |
| --- | --- |
| `DEPLOY_HOST` | VPS の Tailscale の IP |
| `DEPLOY_PORT` | VPS の SSH のポート |
| `DEPLOY_USER` | `misskey` |
| `DEPLOY_KNOWN_HOSTS` | VPS のホスト公開鍵 (`ssh-keyscan -p <SSH のポート> <VPS の Tailscale IP>` の結果を、known_hosts の形式のまま) |

### 15. 初回デプロイと動作確認 (実行は Claude、管理画面の操作はユーザー)

1. GitHub の Actions タブで「Fork deploy (42times)」を開き、Run workflow で main を実行します (Claude が `gh workflow run fork-deploy.yml --ref main` で実行することもできます)。ビルドには 20 分前後かかります。
2. 初回は、build ジョブが終わった時点で GHCR にパッケージができます。パッケージの設定で、可視性が Private になっていることを確認します。
3. deploy ジョブが成功したら、`https://42times.kinachan.com/` を開きます。管理者がまだいないので、ログイン画面の代わりに初期設定の画面が出ます。`setupPassword` に設定したパスワードを入れて、最初の管理者を作ります。
4. 管理画面のオブジェクトストレージを、[cloudflare/media-worker/README.md の「Misskey を設定する」](../cloudflare/media-worker/README.md#3-misskey-を設定する) の表のとおりに設定します。
5. verify ジョブの結果を確認します。確認している内容は次のとおりです。
   - `POST /api/meta` が 200 を返し、`intraLoginEnabled` が `true`
   - 未ログインの `POST /api/notes/local-timeline` が 401
   - `/@admin` の HTML に、ユーザー情報のメタタグ (`misskey:user-id` や OGP) が含まれない
   - Cookie なしの `/media/...` (Worker) と `/files/...` (Misskey) が 401
6. 42 intra のアカウントでログインできること、画像をアップロードして表示できること、ログアウトした別のブラウザでは画像の URL が 401 になることを、ブラウザで確かめます。

## 日常の運用

- 管理者のパスワード・パスキーでのログインは、通常のログイン画面には表示しない。`https://42times.kinachan.com/?admin-login` を開くと表示される。

- `main` に push すると、自動でビルドとデプロイが走ります。`deploy/`・`cloudflare/`・`.claude/` などだけの変更では走りません。手で走らせるときは Actions タブの Run workflow を使います。
- デプロイに失敗すると、`deploy.sh` が前回成功したタグ (`state/current-tag`) に戻します。ワークフローは失敗になります。
- 前のバージョンに手で戻すときは、VPS で `state/history.log` からタグを選び、`/home/misskey/42times/deploy.sh sha-xxxxxxx` を実行します。VPS に残っているイメージは、今のタグと前のタグの 2 つだけです (それより古いタグは GHCR から pull し直します)。
- 新しいイメージでマイグレーションが走った後に前のタグに戻しても、DB のスキーマは戻りません。マイグレーションを含む変更は、戻せない前提で出してください。
- コンテナはホストのポート 3001 で待ち受けるので、更新のたびに古いコンテナを止めてから新しいコンテナを起動します。起動してヘルスチェックが通るまで (1〜2 分程度の見込み、未計測) はサイトにつながりません。
- ログの確認:

  ```sh
  cd /home/misskey/42times
  IMAGE_TAG=$(cat state/current-tag) docker compose logs --tail 200 -f web
  ```

### コアリションのアイコン

コアリションのロールのアイコンは、42 の CDN の画像を `/home/misskey/42times-assets/coalitions/<コアリション ID>.svg` に保存して、nginx の `/instance-assets/` から配信します。VPS で次を実行します (コアリションの一覧は web のコンテナの中で本番の設定を使って 42 API から取り、画像はホストの curl で保存します)。

```sh
mkdir -p /home/misskey/42times-assets/coalitions
curl -fsSL https://raw.githubusercontent.com/tomsato42/misskey-42/main/deploy/coalitions/list-coalition-icons.mjs \
  | docker exec -i -w /misskey/packages/backend misskey42-web-1 node --input-type=module - \
  | while IFS="$(printf '\t')" read -r id url name; do
      curl -fsSL "$url" -o "/home/misskey/42times-assets/coalitions/$id.svg" && echo "saved $id ($name): $url"
    done
chmod 644 /home/misskey/42times-assets/coalitions/*
```

画像の URL が `.svg` で終わっていない (PNG など) と表示されたら、拡張子が合わないので `coalitionIconUrl` の拡張子も合わせます。保存できたら `.config/default.yml` の `intra.coalitionIconUrl` を次のようにして、`docker restart misskey42-web-1` で設定を読み直させます (起動のたびに設定を読み直すので、次のデプロイでも反映されます)。

```yaml
intra:
  coalitionIconUrl: 'https://42times.kinachan.com/instance-assets/coalitions/{id}.svg'
```

アイコンは次の毎時の同期 (毎時 15 分) で、アイコンが未設定のコアリションのロールに付きます。管理画面でアイコンを設定したロールは上書きしません。

## バックアップ

misskey ユーザーの crontab から、毎日 3:15 (日本時間。VPS のタイムゾーンは JST) に `backup.sh` を実行します。1 回の実行で `42times-<日本時間の YYYYmmdd-HHMMSS>.tar` を 1 つ作り、VPS の `/home/misskey/42times-backups/` と R2 のバケット `42times-backups` の両方に置きます。どちらも 7 日分を残します。

| tar の中のファイル | 内容 |
| --- | --- |
| `misskey42.dump` | DB `misskey42` の `pg_dump` (カスタム形式)。作った直後に `pg_restore --list` で読めることを確かめている |
| `default.yml` | `.config/default.yml` (秘密の値を含む) |
| `files.tar.zst` | `files/` (R2 を設定する前にアップロードされたファイル)。`files/` は UID 991 しか読めないので、動いているイメージのコンテナで読み取り専用にマウントして tar にする |
| `SHA256SUMS` | 上のファイルの SHA-256 |

含めないもの:

- R2 のバケット `42times-files` のファイル (ドライブの画像など)。R2 のファイルは消されない限り残るので、DB を戻せば表示できます。バックアップの後に消されたファイルは戻りません。
- Redis。通知は Redis に入っているので、DB を戻しても通知の一覧は戻りません。
- PostgreSQL のロール `misskey42` (初回セットアップの手順 2 で作ります)。

動きの細かいところ:

- 空き容量が 5GB を切っているときは、何もせずに終わります。DB と同じディスクに書くためです。
- DB のダンプに失敗したときは tar を作らず、古いバックアップも消しません。`files/` や R2 へのアップロードに失敗したときは、残りを続けてから終了コード 1 で終わります。
- VPS の側は、新しいものから 7 個を残して古いものを消します (日数ではなく個数で数えるので、失敗が続いても成功した 7 個は残ります)。R2 の側は、バケットのライフサイクルルールで 7 日たったものを消します。
- R2 へは `curl --aws-sigv4` で送ります。VPS に新しいソフトは入れません。
- 失敗しても通知は来ません。ときどき `tail ~/42times/state/backup.log` で確かめてください。
- VPS には既存の Misskey 用に pgBackRest もあり、PostgreSQL のクラスタ全体 (`misskey42` も含む) の WAL を R2 に送っています (`postgresql.conf` の `archive_command`)。フルバックアップを定期的に取っているかは未確認です。`backup.sh` はそれとは別に、`misskey42` だけを取ります。

### 設定の手順

#### 1. R2 のバケットと API トークン (ユーザー)

Cloudflare のダッシュボードで R2 を開きます。

1. バケット `42times-backups` を作ります。公開はしません (r2.dev の URL もカスタムドメインも無効のまま)。
2. バケットの Settings → Object lifecycle rules で、アップロードから 7 日たったオブジェクトを削除するルールを追加します。
3. API トークンを作ります。権限は「オブジェクトの読み取りと書き込み」(Object Read & Write)、対象のバケットは `42times-backups` だけにします。`42times-files` 用のトークンは使い回しません。
4. Access Key ID と Secret Access Key、S3 API のエンドポイント `https://{アカウントID}.r2.cloudflarestorage.com` のアカウント ID を控えます。

#### 2. VPS にスクリプトと鍵を置く (スクリプトは Claude、鍵はユーザー)

```sh
# ローカルの PC (リポジトリのルート) で
scp deploy/backup.sh misskey-vps:/home/misskey/42times/
ssh misskey-vps 'chmod 700 /home/misskey/42times/backup.sh'
```

VPS で鍵のファイルを作ります。`backup.sh` は bash の `source` で読むので、`=` の前後に空白を入れません。

```sh
install -m 600 /dev/null ~/42times/.config/backup-r2.env
nano ~/42times/.config/backup-r2.env
```

```sh
R2_ACCOUNT_ID=<アカウント ID>
R2_BUCKET=42times-backups
R2_ACCESS_KEY_ID=<Access Key ID>
R2_SECRET_ACCESS_KEY=<Secret Access Key>
```

このファイルが無いと、`backup.sh` は R2 には送らず、VPS の中にだけ残します。

#### 3. 手で 1 回実行する (Claude)

```sh
~/42times/backup.sh
ls -lh ~/42times-backups/
```

最後に「完了しました」と出て、R2 のダッシュボードのバケットに同じ名前のオブジェクトがあれば成功です。

#### 4. cron に登録する (Claude)

```sh
( crontab -l 2>/dev/null; echo '15 3 * * * /home/misskey/42times/backup.sh >> /home/misskey/42times/state/backup.log 2>&1' ) | crontab -
crontab -l
```

### 戻し方

1. 戻す tar を選びます。VPS が無事なら `~/42times-backups/` から、VPS ごと失ったときは R2 のダッシュボードからダウンロードして VPS に置きます。

   ```sh
   mkdir -m 700 ~/42times-restore && cd ~/42times-restore
   tar -xf ~/42times-backups/42times-YYYYmmdd-HHMMSS.tar
   sha256sum -c SHA256SUMS
   ```

2. Misskey を止めます。

   ```sh
   cd ~/42times && IMAGE_TAG=$(cat state/current-tag) docker compose stop web
   ```

3. 今の DB を別の名前に変えて残し、空の DB を作ります (ユーザー、sudo)。

   ```sh
   sudo -u postgres psql -c 'ALTER DATABASE misskey42 RENAME TO misskey42_old' -c "CREATE DATABASE misskey42 OWNER misskey42 ENCODING 'UTF8' TEMPLATE template0"
   ```

4. ダンプを戻します。パスワードは `default.yml` の `db.pass` です。

   ```sh
   pg_restore --host=localhost --username=misskey42 --dbname=misskey42 --no-owner --single-transaction ~/42times-restore/misskey42.dump
   ```

5. `files/` も戻すときは、コンテナの中で展開します。

   ```sh
   zstd -dc ~/42times-restore/files.tar.zst | docker run --rm -i --network none --user 991:991 \
     -v /home/misskey/42times/files:/files --entrypoint tar \
     "ghcr.io/tomsato42/misskey-42:$(cat ~/42times/state/current-tag)" -C /files -xf -
   ```

6. `default.yml` を失ったときは、`~/42times-restore/default.yml` を `~/42times/.config/default.yml` に置き、初回セットアップの手順 10 と同じ権限 (`misskey:991`、640) にします。
7. Misskey を起動します。ダンプが今のイメージより古いバージョンのものなら、起動時にマイグレーションが走ります。

   ```sh
   ~/42times/deploy.sh "$(cat ~/42times/state/current-tag)"
   ```

8. 動作を確かめたら、秘密の値を含む作業用のディレクトリと、古い DB を消します。

   ```sh
   rm -rf ~/42times-restore
   sudo -u postgres psql -c 'DROP DATABASE misskey42_old'
   ```

## 検討したほかの方法

- **bridge ネットワーク + `ports: 127.0.0.1:3001:3001`**: 3001 をループバックだけで待ち受けられますが、コンテナから VPS の PostgreSQL・Redis に接続するには、両方の待ち受けアドレス (今は 127.0.0.1) と PostgreSQL の `pg_hba.conf` を変える必要があります。既存の Misskey と共有しているので、今回は host ネットワークにしました。
- **UNIX ドメインソケット (`socket:`)**: TCP のポートを使わずに済みますが、`healthcheck.sh` がポートを前提にしていることと、nginx からソケットを読めるようにする権限の調整が必要になるため、採りませんでした。
- **Tailscale の OIDC (workload identity federation)**: `tailscale/github-action` の `audience` を使うと、OAuth クライアントの secret を GitHub に保存せずに済みます。今回は指定どおり OAuth クライアント方式にしました。
- **バックアップに既存の pgBackRest を使う**: クラスタ単位の物理バックアップなので、`misskey42` だけを戻すにはクラスタごと別の場所に戻す必要があります。設定も既存の Misskey と共有で sudo が要るため、`misskey42` だけを `pg_dump` で取る方式にしました。
- **R2 の古いバックアップを backup.sh で消す**: 一覧の取得と削除を curl で書く必要があり、ライフサイクルルールなら設定 1 つで済むため、R2 側はライフサイクルルールにしました。
- **バックアップの暗号化**: R2 に送る前に gpg などで暗号化すると、R2 の鍵が漏れても中身は読まれません。代わりに復号の鍵を VPS の外で保管する必要があり、無くすと戻せなくなるので、今は暗号化していません (既存の pgBackRest も暗号化していません)。
