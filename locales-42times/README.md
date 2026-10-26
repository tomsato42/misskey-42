# locales-42times

このフォーク (42times) で足した文の訳です。`locales/` の `ja-JP.yml` 以外は Crowdin が配る upstream の訳なので、このフォークの文の訳はここに置きます (Crowdin の対象は `locales/%locale%.yml` だけで、ここは対象外です)。

- `packages/i18n` が `locales/<lang>.yml` の下に重ねて読みます。同じキーに Crowdin の訳があれば、そちらを使います
- `ja-JP.yml` に文を足したら、ここの各言語にも訳を足します。`pnpm --filter i18n verify-fork` で、訳が無いキーや引数 (`{name}` など) の違いが分かります (CI の `Fork locale` でも確かめます)
- upstream を取り込んで、Crowdin にまだ訳の無い upstream の文が増えたときも、ここに訳を足します

Translations of the strings added by this fork. Files in `locales/` other than `ja-JP.yml` are managed by Crowdin upstream, so the fork's own translations live here and are layered under them by `packages/i18n`.
