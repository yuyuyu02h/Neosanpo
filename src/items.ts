import type { Item } from './types.ts';

export const items: Item[] = [
  {
    id: 'robot',
    name: 'ロボットの頭',
    subtitle: 'まだ、考えごとの途中。',
    description:
      '胴体は見当たらない。耳に当てると、小さな音で天気予報を言っている。たぶん、昨日の。',
    note: '持って帰るには、少し重い。',
    art: 'robot',
    color: '#d6decf',
  },
  {
    id: 'candy',
    name: '誰かが舐めた飴',
    subtitle: '続きを引き受ける気は、ない。',
    description:
      '包み紙には「最後までおいしい」と書いてある。最後までたどり着けなかった事情は、知らない。',
    note: '食べられません。いろんな意味で。',
    art: 'candy',
    color: '#edddc4',
  },
  {
    id: 'poop',
    name: 'ハエのうんち',
    subtitle: '見つけた自分を、ほめたい。',
    description:
      'あまりに小さいので、世界の方を拡大して見る必要がある。誰も欲しがらないものを、自分だけが持っている。',
    note: 'なくしても、気づけない。',
    art: 'poop',
    color: '#e0dfc9',
  },
  {
    id: 'haiku',
    name: '知らないおじさんの五七五',
    subtitle: '作者不詳。たぶん、元気。',
    description: '雨上がり\n知らない犬に\n会釈した\n\n裏に「二度目」とだけ書いてある。',
    note: '紙から、うっすら焼き芋のにおい。',
    art: 'haiku',
    color: '#e8dfc6',
  },
  {
    id: 'lamp',
    name: 'Nationalの古い電灯',
    subtitle: '知らない家の、ただいま。',
    description:
      'スイッチを入れると、一瞬だけ誰かの実家になる。照らしていた机も、宿題も、もうここにはない。',
    note: '首の角度に、持ち主のくせが残っている。',
    art: 'lamp',
    color: '#d4ded5',
  },
  {
    id: 'key',
    name: 'どこも開かない鍵',
    subtitle: '鍵としては、ひと休み。',
    description:
      'よく見ると、歯の部分が全部まるい。何かを開けるつもりで生まれたことだけは伝わってくる。',
    note: 'ポケットでは、ちゃんと鍵の音がする。',
    art: 'key',
    color: '#e8dcb9',
  },
  {
    id: 'glove',
    name: 'ずっと手を振っている軍手',
    subtitle: 'お別れが、長い。',
    description:
      '風のない日にも、指先だけが揺れている。振り返してから拾うと、少しおとなしくなった。',
    note: '右手なのか左手なのか、まだ決めていない。',
    art: 'glove',
    color: '#dfddcf',
  },
  {
    id: 'receipt',
    name: '何も買っていないレシート',
    subtitle: '合計、0円。',
    description:
      '日付と時刻だけが、やけに正確に印刷されている。何も買わなかったという出来事も、確かにあった。',
    note: 'ポイントは、つかなかった。',
    art: 'receipt',
    color: '#e5dfd2',
  },
  {
    id: 'cassette',
    name: 'B面しかないカセット',
    subtitle: 'だいたい、サビの手前。',
    description:
      'ラベルには「大事」と「上書きしていい」が重ねて書かれている。どちらが先だったかで、話は変わる。',
    note: '振ると、中で小さな拍手がする。',
    art: 'cassette',
    color: '#d8dcc8',
  },
  {
    id: 'stone',
    name: 'どう見ても部長な石',
    subtitle: '印鑑は、持っていない。',
    description: '会ったことはないのに、部長だとわかる。机の端に置くと、帰りづらくなる。',
    note: '休日はただの石に戻るらしい。',
    art: 'stone',
    color: '#d7d9d0',
  },
  {
    id: 'spoon',
    name: '月曜日のスプーン',
    subtitle: '少し、曲がっている。',
    description: '何をすくっても、気持ちだけが少し残る。金曜日にはまっすぐになるという噂もある。',
    note: '火曜日については、黙っている。',
    art: 'spoon',
    color: '#d7dede',
  },
  {
    id: 'button',
    name: '押せそうで押せないボタン',
    subtitle: '「あとで」と書いてある。',
    description:
      '押そうとすると、ほんの少し遠くなる。人生の大事なことに似ているけれど、これはプラスチック。',
    note: '電池は、はじめから入っていない。',
    art: 'button',
    color: '#e8d6c8',
  },
];

export const itemById = (id: string): Item => items.find((item) => item.id === id) ?? items[0];
