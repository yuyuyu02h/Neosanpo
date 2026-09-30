# 地図・外部ライブラリ・素材

## OpenStreetMap

地図データおよび 旧版の `archive/v1-demo/demo-paths.json`、`archive/v1-demo/demo-points.json` は © OpenStreetMap contributors。

- [著作権とODbL](https://www.openstreetmap.org/copyright)
- [ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/)
- 歩道データ取得日：2026-09-30
- 取得範囲：東経139.570〜139.580、北緯35.696〜35.702
- 加工：歩行用の道を抽出し、連結するノードと隣接関係を保存。試し歩きの目的地を最寄りの歩道ノードへ合わせた。

旧版の歩道データはv2の配布・実行には含めません。これらの地図由来データはODbLで提供されます。アプリのUIやオリジナルのアイテム画とは区別してください。

## OpenFreeMap / OpenMapTiles / OSM Liberty

- [OpenFreeMap](https://openfreemap.org/)
- [公式の導入手順](https://openfreemap.org/quick_start/)
- [OpenFreeMap Stylesのライセンス](https://github.com/hyperknot/openfreemap-styles/blob/main/LICENSE.md)
- [OSM Libertyのライセンス](https://github.com/maputnik/osm-liberty/blob/gh-pages/LICENSE.md)

`public/reality-style.json` はOpenFreeMap Libertyのスタイル定義を保存したものです。アプリはそこから配色、表示レイヤー、森と建物の絵を変更したテーマを生成します。OpenFreeMap StylesのコードはMIT、元となるLibertyスタイルのコードはBSD 3-Clause、デザインはCC BY 4.0と記載されています。ライセンス原文は `public/licenses/` に保存しています。地図上では配信元の帰属表示を保持します。

## MapLibre GL JS

[MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) — BSD 3-Clause。npmパッケージにライセンスが含まれます。

## フォント

[Noto Serif JP](https://fonts.google.com/specimen/Noto+Serif+JP) — SIL Open Font License。Google FontsからCSSで取得します。取得できない環境ではOSのフォントを使用します。

## アプリ内の絵・文章

`src/art.ts`、`src/icons.ts`、`src/items.ts` は本作品用に制作したSVG・文章です。第三者のゲーム画面・アイテム画像・製品写真は使用していません。Nationalの名称はアイテムの題材として登場します。

その他の依存ライブラリは `package-lock.json` と各npmパッケージのLICENSEを参照してください。
