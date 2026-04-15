# school_life

GitHub Pages で公開する学校生活チェックリストです。

## 構成

- `index.html`: トップページ
- `data/pages.json`: トップから表示するページ一覧
- `issues/1-1-1/index.html`: 1年1学期1号ページ
- `issues/1-1-1/list.md`: 1年1学期1号の元データ
- `issues/security/index.html`: セキュリティ課題メモページ
- `issues/security/list.md`: 問題点と改善案のチェックリスト
- `list.md`: 元の内容メモ
- `assets/app.js`: 一覧表示、チェック保存、簡易パスワード制御
- `assets/config.js`: 共有保存先の設定

## 追加方法

1. `issues/` 配下に新しいフォルダを作る
2. そのフォルダに `index.html` と `list.md` を追加する
3. `data/pages.json` にリンク情報を追加する

## パスワード

- 現在の初期パスワードは `school-life`
- 変更する場合は `assets/app.js` の `PASSWORD_HASH` を差し替えます
- GitHub Pages のため、これは強い保護ではなく簡易的な閲覧制御です

## 共有保存

- 認証なし共有は `assets/config.js` の `sharedStorage.enabled` を `true` にすると使えます
- 現状は `Supabase` の REST API を前提にしています
- 必要な公開設定は `projectUrl`, `anonKey`, `table`
- 未設定時はブラウザ内保存にフォールバックします
- SQL は `supabase/schema.sql` にあります

## Supabase 設定手順

1. Supabase で新しい project を作る
2. SQL Editor で `supabase/schema.sql` の内容を実行する
3. `Settings > API Keys` から `Project URL` と `publishable` key を確認する
4. `assets/config.js` を次のように埋める

```js
window.SCHOOL_LIFE_CONFIG = {
  sharedStorage: {
    enabled: true,
    provider: "supabase",
    projectUrl: "https://YOUR-PROJECT.supabase.co",
    anonKey: "YOUR-PUBLISHABLE-KEY",
    table: "check_states",
  },
};
```

5. 変更を GitHub Pages に反映する

補足:
- この構成は認証なしなので、URL と公開キーを知っている人は誰でも読み書きできます
- `anonKey` 欄には Supabase の `publishable` key を入れて大丈夫です
- 公開キーなので埋め込みは可能ですが、強い秘匿にはなりません
