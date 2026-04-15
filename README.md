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

## 追加方法

1. `issues/` 配下に新しいフォルダを作る
2. そのフォルダに `index.html` と `list.md` を追加する
3. `data/pages.json` にリンク情報を追加する

## パスワード

- 現在の初期パスワードは `school-life`
- 変更する場合は `assets/app.js` の `PASSWORD_HASH` を差し替えます
- GitHub Pages のため、これは強い保護ではなく簡易的な閲覧制御です
