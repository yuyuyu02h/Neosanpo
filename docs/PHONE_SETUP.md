# スマホでの確認とCloudflare Pages

## 今回の状態

v3のソースと配布ビルドはローカルで更新済み。ユーザーが設定したCloudflare Pagesへの今回の反映は未実施。既存の公開URLやデプロイ結果は、この作業では確認していない。

## Cloudflare Pagesの設定

GitHubの `yuyuyu02h/Neosanpo` を接続したPagesプロジェクトで：

| 項目               | 値                 |
| ------------------ | ------------------ |
| 本番ブランチ       | main               |
| フレームワーク     | Vite（またはNone） |
| ビルドコマンド     | npm run build      |
| 出力ディレクトリ   | dist               |
| ルートディレクトリ | リポジトリ直下     |

変更をGitHubへPushすると、Git連携を設定したPagesが新しいビルドを開始する。今回の作業でPushはしていない。Workers用の `npx wrangler deploy` は、この静的Pagesのビルド設定には使わない。

ビルド成功後、Pagesが表示するHTTPS URLをスマホで開く。`/fantasy/castle.webp` が表示され、地図・ワーカーが404にならないことを確認する。

PCの `localhost` はスマホから開くURLではない。PCのローカルIPへHTTPで接続してもGPSは使えない。[MDN: watchPosition](https://developer.mozilla.org/en-US/docs/Web/API/Geolocation/watchPosition)。

## 実機の確認項目（未実施）

- Safari / Chromeで位置情報と正確な位置を許可し、その場の道路が表示される。
- 現実・異世界表示で道路の位置が一致する。
- 小さな下部操作バーが地図を妨げない。
- 「ルートを表示」で道に沿った線が表示される。
- 公共の道路上の候補へ実際に歩き、現在地が追従する。
- 静止・地図操作だけでは取得できず、到着が安定したら取得できる。
- 学校・大学・私有地への経路になっていないことを現場でも確認。入れない地点は非表示にする。
- 再読込後もコレクションが残る。
- GPS拒否・通信失敗・画面ロックから復帰できる。
- GPS精度・測位頻度・電池消費を記録する。

画面を開いて使用する。消灯抑制は対応端末のみで、OSや省電力設定により解除されることがある。[MDN: Screen Wake Lock](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)。
