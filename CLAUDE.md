# LAST THREE

T.OF... のアプリ。https://t-of.github.io/last-three/

- ルールは本部の `~/GitHub/tof/t-of.github.io/RULES.md` に従う（全アプリ共通）。ブランドは `docs/BRAND.md`。
- 遊びの中身は `game.js`、テストは `node test.mjs`。遊ぶ部分を変えたらテストも足す。
- 直したら本部で `npm run audit:browser -- last-three` を通す。
- 公開は本部の `docs/RELEASE.md` の手順。大きな作業は本部で Claude を起動すると、役割を分けて進められる。
- localStorage のキーは `last-three.` で始める。SW のキャッシュ名は `last-three-` で始める。
