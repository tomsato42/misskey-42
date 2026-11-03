# media-worker

Misskey のドライブのファイルを非公開の R2 バケットに保存し、Misskey にログインしている人にだけ返す Cloudflare Worker です。

## 動き

1. Misskey は、ログインしたとき (`/api/signin-flow` などを通るとき) と、フロントエンドが `POST /api/media-session` を呼んだときに、署名付きの Cookie を発行します。Cookie はホスト限定 (Domain 属性なし)、`HttpOnly`、`SameSite=Lax`、`Path=/` です。
2. Misskey は、オブジェクトストレージ (R2) に保存したファイルの URL を `https://42times.kinachan.com/media/{プレフィックス}/{ファイル名}` の形で作ります。
3. この Worker はルート `42times.kinachan.com/media/*` に割り当てられ、Cookie の署名と期限を確かめてから、`/media/` より後ろを R2 のキーとしてバケットから返します。Cookie が無い、または無効なときは 401 を返します。

Cookie の形式は `v1.{ユーザーID}.{有効期限(unix秒)}.{署名}` です。署名は、Misskey の `mediaGate.secret` と Worker の `MEDIA_GATE_SECRET` に同じ値を設定し、その値で計算した HMAC-SHA256 です。署名と検証の実装は `src/token.ts` と `packages/backend/src/core/media-gate/media-gate.ts` にあり、どちらも `test/token-vectors.json` のテストベクタでテストしています。

Misskey 自身も、メディアプロキシ (`/proxy/*`) でアバターや絵文字の画像を取得するときと、ドライブに置いたファイルを読むインポート・エクスポート (フォローやミュートの CSV のインポート、カスタム絵文字のインポート・エクスポートなど) のときに、この Worker からファイルを取得します。このときは Misskey が有効期限 5 分の Cookie を自分で付けます。`drive/files/upload-from-url` や ActivityPub 由来の取得には付けません。そのため、Misskey のサーバーから `https://42times.kinachan.com/media/...` に (Cloudflare 経由で) 接続できる必要があります。

## 必要なもの

- Node.js 22.18 以上 (テストで TypeScript をそのまま実行するため)
- pnpm
- Cloudflare のアカウント (kinachan.com のゾーンと、R2 バケット `42times-files` があるもの)

このディレクトリは、リポジトリのルートとは別の pnpm workspace です (`pnpm-workspace.yaml` を置いています)。ルートで `pnpm install` しても、このディレクトリの依存パッケージはインストールされません。

```sh
cd cloudflare/media-worker
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

## デプロイ手順

### 1. 署名用の秘密の値を作る

32 文字以上のランダムな値を作ります。例えば次のコマンドで作れます。

```sh
openssl rand -base64 48
```

この値は秘密情報です。リポジトリにはコミットしないでください。同じ値を、次の 2 か所に設定します。

- Misskey の `.config/default.yml` の `mediaGate.secret`
- この Worker の `MEDIA_GATE_SECRET` (手順 4)

### 2. R2 の API トークンを発行する

Misskey が R2 にファイルをアップロードするための API トークンを発行します。

1. Cloudflare のダッシュボードで R2 を開き、API トークンの管理画面から新しいトークンを作成します。
2. 権限は「オブジェクトの読み取りと書き込み」(Object Read & Write) にします。
3. 対象のバケットは `42times-files` だけに限定します。
4. 作成後に表示される Access Key ID と Secret Access Key を控えます。Secret Access Key は作成時にしか表示されません。
5. S3 API のエンドポイント `https://{アカウントID}.r2.cloudflarestorage.com` のアカウント ID も控えます。

バケットは公開しないでください。r2.dev の公開 URL とカスタムドメインは、どちらも無効のままにします。ファイルはこの Worker を通してだけ返します。

### 3. Misskey を設定する

`.config/default.yml` に `mediaGate` を追加し、Misskey を再起動します。設定例は `.config/example.yml` にあります。

```yaml
mediaGate:
  secret: '手順 1 で作った値'
  # Worker の COOKIE_NAME と同じ値にする (省略時は mi_media_session)
  #cookieName: mi_media_session
  # Cookie の有効期間 (秒、3600〜86400。省略時は 7200 = 2 時間)
  #ttlSec: 7200
```

次に、Misskey のコントロールパネルの「オブジェクトストレージ」を次のように設定します。

| 設定項目 | 値 |
| --- | --- |
| オブジェクトストレージを使用 | オン |
| Base URL | `https://42times.kinachan.com/media` |
| Bucket | `42times-files` |
| Prefix | 任意 (例: `files`) |
| Endpoint | `{アカウントID}.r2.cloudflarestorage.com` |
| Region | `auto` |
| Access key | 手順 2 の Access Key ID |
| Secret key | 手順 2 の Secret Access Key |
| SSLを使用する | オン |
| Proxyを利用する | Misskey の設定 (`proxy`) で HTTP プロキシを使っていなければ、どちらでもよい |
| アップロード時に'public-read'を設定する | オフ |
| s3ForcePathStyle | オン |

Prefix を `files` にした場合、ファイルの URL は `https://42times.kinachan.com/media/files/{UUID}.webp` になり、Worker は `files/{UUID}.webp` を R2 のキーとして読みます。

「アップロード時に'public-read'を設定する」は、R2 では ACL を使わないので必要ありません。オンにしたときに R2 がこの指定を無視するのかエラーにするのかは確かめていないため、オフにしてください。

### 4. Worker をデプロイする

```sh
cd cloudflare/media-worker
pnpm exec wrangler login
pnpm exec wrangler secret put MEDIA_GATE_SECRET   # 手順 1 の値を入力する
pnpm exec wrangler deploy
```

`wrangler.jsonc` には次の内容を設定しています。

- R2 バインディング `MEDIA_BUCKET` (バケット `42times-files`)
- ルート `42times.kinachan.com/media/*` (ゾーン `kinachan.com`)
- 変数 `COOKIE_NAME` (Misskey の `mediaGate.cookieName` と同じ値にする) と `PUBLIC_KEYS`

`MEDIA_GATE_SECRET` が未設定、または 32 文字未満のときは、Worker はすべてのリクエストに 500 を返します。

### 5. Cloudflare 側の設定を確かめる

- DNS の `42times` のレコードで、プロキシが有効 (オレンジの雲) になっていること。プロキシが無効だと Worker のルートが動きません。
- Workers のルート `42times.kinachan.com/media/*` が kinachan.com のゾーンで有効になっていること (ダッシュボードの Workers Routes で確認できます)。このパスへのリクエストは VPS の nginx には届きません。
- キャッシュのルールで `/media/*` を強制的にキャッシュしていないこと。Worker の応答は `Cache-Control: private` です。

### 6. VPS に保存されていたファイルを R2 に移す

オブジェクトストレージを有効にする前にアップロードされたファイルがあるときに、1 回だけ行います。本番では 2026-10-20 に実行し (982 ファイル)、VPS の `files/` は空になっています。

`drive_file` の行は、ファイルをどこに保存したかを `storedInternal` で記録しています。そのため、オブジェクトストレージを有効にしても、それより前にアップロードされたファイルは VPS の `files/` に残ります。`deploy/migrate-files-to-r2.sh` は、これらのファイルを 1 件ずつ、普通にアップロードしたときと同じ形のキーで R2 にアップロードし、ファイルごとに 1 つのトランザクションで次の列を書き換えます。

- `drive_file` の行の URL・キー・`storedInternal`
- ファイルの URL をコピーして持っている、ユーザーのアバターとバナー、カスタム絵文字、ロールのアイコン、アバターデコレーション、広告、お知らせ、`meta` のサーバーの画像 (アイコン・バナーなど) の列

1 件以上移したときは、Redis の絵文字のキャッシュのキーも消します。`files/` のファイルは消さず、後で `cleanup` を別に実行して消します。

#### 始める前に

- この README の手順 3 (コントロールパネルでオブジェクトストレージを有効にする) と手順 4 (Worker のデプロイ) を終えておきます。「オブジェクトストレージを使用」がオフのときは、スクリプトはエラーで止まります。
- 直前にバックアップを取ります。VPS で `~/42times/backup.sh` を実行し、最後に「完了しました」と出ることを確かめます ([deploy/README.md の「バックアップ」](../../deploy/README.md#バックアップ))。

#### スクリプトを置く (Claude)

```sh
# ローカルの PC (リポジトリのルート) で
scp deploy/migrate-files-to-r2.sh deploy/migrate-files-to-r2.mjs misskey-vps:/home/misskey/42times/
ssh misskey-vps 'chmod 700 /home/misskey/42times/migrate-files-to-r2.sh && chmod 644 /home/misskey/42times/migrate-files-to-r2.mjs'
```

`migrate-files-to-r2.sh` は、動いている Misskey と同じイメージのコンテナの中で、コンテナの misskey ユーザー (UID 991) として `migrate-files-to-r2.mjs` を実行します。UID 991 が読めるよう、`.mjs` は 644 にします。

#### 移す (実行は Claude、ブラウザでの確認はユーザー)

VPS で次の順に進めます。

1. 計画を表示します。DB・R2・`files/` には何も書き込みません。

   ```sh
   ~/42times/migrate-files-to-r2.sh
   ```

   出力では次の点を見ます。

   - 「ファイルの URL」が `https://42times.kinachan.com/media/<キー>` の形になっていること
   - 「オブジェクトストレージに接続できました」と出ていること
   - 「移行できるファイル」の件数と大きさ
   - 「問題があるファイル」があれば、その理由 (`files/` にファイルが無いなど)。これらは `--apply` のときに飛ばし、内部ストレージのまま残します
   - 「古い URL (https://42times.kinachan.com/files/...) を含む行」に出る、古い URL を持つ列と行数

2. 最初の 3 件だけ移して試します。

   ```sh
   ~/42times/migrate-files-to-r2.sh migrate --apply --limit 3
   ```

   出力の最後に再起動の案内が出ますが、続けて残りを移すなら、再起動は残りを移した後の 1 回で足ります。ただしそれまでは、移したファイルがアバターやサーバーのアイコンに使われていると、メモリのキャッシュに古い URL が残っているため表示されないことがあります。

3. 移した 3 件をブラウザで確かめます。出力の各行に `drive_file` の ID が出るので、管理者のアカウントで `https://42times.kinachan.com/admin/file/<ID>` を開き、画像が表示されることと、リンク先の URL が `/media/` で始まることを見ます。その URL をログアウトしたブラウザで開くと、401 になります。

4. 残りをすべて移します。

   ```sh
   ~/42times/migrate-files-to-r2.sh migrate --apply
   ```

   Ctrl-C を押すと、今のファイルが終わってから止まります。止めたときや失敗したファイルがあったときも、もう一度実行すれば、まだ移していないものから続けます。最後の「まだ古い URL (...) を含む行」が「なし」なら、書き換える列に古い URL は残っていません。

5. Misskey を再起動します。Misskey はサーバーの設定・ユーザー・絵文字をメモリにキャッシュしていて、そこに古い URL が残っているためです。

   ```sh
   cd ~/42times && IMAGE_TAG=$(cat state/current-tag) docker compose restart web
   ```

6. ブラウザで、ノートの画像、アバター、カスタム絵文字、サーバーのアイコンが表示されることを確かめます。もう一度 `~/42times/migrate-files-to-r2.sh` を実行すると、「内部ストレージのファイル」の件数で、まだ移していないファイル (飛ばしたものなど) の数も分かります。

7. `files/` の要らなくなったファイルを、数を確かめてから消します。

   ```sh
   ~/42times/migrate-files-to-r2.sh cleanup           # 数えるだけ
   ~/42times/migrate-files-to-r2.sh cleanup --apply   # 消す
   ```

   消すのは、ファイル名が内部ストレージのキーの形 (UUID) で、まだ内部ストレージにある `drive_file` の行のどれからも参照されておらず、最後に書き込まれてから 1 時間以上たったファイルだけです。

#### ログイン画面に出すサーバーの画像

`migrate --apply` は、`meta` のサーバーの画像 (アイコン・バナーなど) のうち R2 にあるもののキーを、出力の終わりのほうに表示します。この中にログインしていない人にも見せる画像 (ログイン画面のアイコンなど) があれば、そのキーを `wrangler.jsonc` の `PUBLIC_KEYS` に足し、「4. Worker をデプロイする」と同じく `pnpm exec wrangler deploy` でデプロイし直します (下の「ログイン画面に出す画像 (PUBLIC_KEYS)」)。`/instance-assets/` (nginx が `~/42times-assets/` から返す) の画像は移行の対象ではないので、変わりません。

#### 注意

- ノートの本文などに直接書かれた `/files/...` の URL は、移行の後は 404 になります。Misskey はこの URL のキーで `drive_file` の行を探しますが、移行でキーが変わるためです。ノートに添付したファイルは、そのまま表示されます。
- 移したファイルは、`cleanup` で `files/` から消した後は毎日のバックアップに入りません。`backup.sh` が tar にするのは `files/` で、R2 のバケット `42times-files` は含めないためです。
- `cleanup` を実行するまでは `files/` に元のファイルが残っているので、始める前に取ったバックアップから DB を戻せば ([deploy/README.md の「戻し方」](../../deploy/README.md#戻し方))、移行も元に戻ります。`cleanup` の後は、DB に加えて `files/` もそのバックアップから戻す必要があります (「戻し方」の手順 5)。バックアップは VPS に新しい 7 個、R2 に 7 日分しか残らないので、それより古くなると戻せません。どちらの場合も、バックアップの後に DB に入った投稿なども消えます。
- スクリプトは最初に、R2 に接続できるかを ListObjectsV2 (オブジェクトの一覧の取得) で確かめます。「2. R2 の API トークンを発行する」の権限「オブジェクトの読み取りと書き込み」で通ることは、本番の移行で確かめました。接続できないときは「オブジェクトストレージに接続できませんでした」と表示され、計画の表示はそのまま続きますが、`--apply` は何も書き込まずに止まります。

## ログイン画面に出す画像 (PUBLIC_KEYS)

ログインしていない人には、R2 のファイルは 401 になります。インスタンスのアイコンやバナーをドライブにアップロードして設定すると、ログイン画面ではそれらが表示されません。

この場合は、`wrangler.jsonc` の `PUBLIC_KEYS` にそのファイルの R2 のキー (URL の `/media/` より後ろ) をカンマ区切りで指定してデプロイし直します。指定したキーは Cookie なしで返し、`Cache-Control: public, max-age=86400` を付けます。

```jsonc
"PUBLIC_KEYS": "files/0f3a2b4c-1111-2222-3333-444455556666.png,files/aaaa....webp"
```

別の方法として、アイコンを `/static-assets/` などの静的なファイルや外部の URL にしても構いません。

## 応答

| 状況 | ステータス |
| --- | --- |
| GET・HEAD 以外のメソッド | 405 |
| `/media/` の後ろが空、`..`・`.`・空のセグメント、制御文字、バックスラッシュを含む | 400 |
| Cookie が無い・署名が違う・期限切れ (`PUBLIC_KEYS` のキーを除く) | 401 (`Cache-Control: no-store`) |
| キーが存在しない | 404 |
| `If-None-Match` が ETag と一致 | 304 |
| `Range` リクエスト | 206 (満たせない範囲なら 416) |

ファイルを返すときは、Misskey がアップロード時に保存した `Content-Type` と `Content-Disposition` を使います。`Content-Type` がブラウザで安全に表示できる形式 (Misskey の `FILE_TYPE_BROWSERSAFE`) でなければ、`application/octet-stream` にします。Misskey のファイル配信と同じ `Content-Security-Policy` と `X-Content-Type-Options: nosniff` も付けます。

## 運用上の注意

- Cookie の有効期間は既定で 2 時間です。ログイン中のブラウザは、15 分ごとと、タブを表示し直したときに確認し、期限の半分を過ぎていれば `POST /api/media-session` で Cookie を更新します。
- Misskey 自身が返すファイル (`/files/*`・`/proxy/*`・`/avatar/*`・`/identicon/*`・`/emoji/*`) では、Cookie のユーザーが凍結・削除されていれば、期限内でも 401 を返します。この Worker はユーザーの状態を持たないため、凍結・削除やログアウトの後も、すでに発行した Cookie は期限 (既定で 2 時間) まで R2 のファイルを読めます。この Worker では有効期間を短くすることで、その時間を限っています。すべての Cookie をすぐに無効にしたいときは、Misskey と Worker の両方で秘密の値を新しくします。
- 秘密の値を変えるときは、Misskey の `mediaGate.secret` と Worker の `MEDIA_GATE_SECRET` を続けて更新してください。片方だけを変えている間は、画像が表示されません。
- ローカルストレージ (オブジェクトストレージを使わない設定) のファイルは、この Worker ではなく Misskey の `/files/*` が返します。`mediaGate` を設定していれば、こちらも同じ Cookie で制限されます。
