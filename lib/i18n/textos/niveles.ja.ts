// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import type { nivelesEs } from "./niveles";

export const nivelesJa: { [K in keyof typeof nivelesEs]: string } = {
  "pie.niveles": "レベルのしくみ",
  "niveles.titulo": "レベルのしくみ",
  "niveles.intro":
    "カードには経験値・レベル・強化できるスキルがあります。このページでしくみを順番に説明します。",
  "niveles.s1.titulo": "1. 経験値は「いいね」から",
  "niveles.s1.texto":
    "訪問者は1日1回、カードに「いいね」できます。いいね1つにつき経験値（EXP）が{xp}ポイント増えます。ほかにすることはありません。コミュニティの応援で自然に経験値がたまります。",
  "niveles.s2.titulo": "2. ゲージがいっぱいになるとレベルアップ",
  "niveles.s2.texto":
    "経験値ゲージはいいねでたまります。いっぱいになるとカードがレベルアップし、ゲージはゼロから再スタートします。レベルが上がるごとに必要量が増えるので、だんだん上がりにくくなります。最初は{base}EXP、以降は1レベルごとに{paso}ずつ増えます。",
  "niveles.tabla.titulo": "各レベルに必要な量",
  "niveles.tabla.nivel": "到達レベル",
  "niveles.tabla.exp": "ゲージのEXP",
  "niveles.tabla.likes": "いいねの目安",
  "niveles.s3.titulo": "3. 累計EXPは消えません",
  "niveles.s3.texto":
    "レベルアップでゲージが空になっても、カードはこれまでに獲得した経験値の合計「累計EXP」を記録し続けます。減ることもリセットされることもありません。カードのゲージの下で確認できます。",
  "niveles.s4.titulo": "4. レベルアップごとにスキルポイント",
  "niveles.s4.texto":
    "いいねでカードがレベルアップするたびに、スキルポイントが{pts}ポイントもらえます。1ポイントでスキルを1ランク強化でき、最大ランクは{max}です。ポイントに期限はなく、好きなときに使えます。",
  "niveles.s4.aviso":
    "VTuberDexに登録されてから上がったレベルだけが対象です。最初から持っていたレベルではポイントはもらえません。",
  "niveles.sStats.titulo": "ステータスポイント",
  "niveles.sStats.texto":
    "スキルとは別に、獲得したレベルごとに {ptsStats} ポイントのステータスポイントがもらえます。HP・MP・攻撃・魔法攻撃・防御・魔法防御を上げられ、1ポイントで固定値が加算されます（HP +50、MP +25、その他 +5）。「マイカード」で振り分けると、公開カードに反映されます。",
  "niveles.sStats.auto":
    "素早さ・回避・命中・クリティカルは自動で上がります：獲得 {cadaRapido} レベルごとに +1。運は {cadaSuerte} レベルごとに +1、最大 {topeSuerte} です。回避は 100 を超えません。これらはポイントを使いません。",
  "niveles.sStats.aviso":
    "ステータスポイントとスキルポイントは別々で、混ざることはありません。",
  "niveles.s5.titulo": "5. ポイントの振り分け方",
  "niveles.s5.paso1":
    "カードがレベルアップすると、登録したメールアドレスにメールが届きます。",
  "niveles.s5.paso2":
    "メールのボタンを押すと、パスワードなしで「マイカード」に入れます。",
  "niveles.s5.paso3":
    "強化したいスキルを選んで「強化」を押します。ランクは公開カードにすぐ反映されます。",
  "niveles.s5.nota":
    "メールのリンクは7日間有効で、何度でも使えます。期限切れや紛失の場合は、「マイカード」でメールアドレスを入力して新しいリンクを請求してください。",
  "niveles.s5.boton": "マイカードへ",
  "niveles.s6.titulo": "よくある質問",
  "niveles.q1": "ポイントの振り分けは変更できますか？",
  "niveles.a1":
    "はい。「マイカード」の「振り直す」を押すと、すべてのポイントが戻り、もう一度振り分けられます。",
  "niveles.q2": "カードにメールアドレスがない場合は？",
  "niveles.a2":
    "元のカタログのカードにはメールアドレスが紐づいていないため、レベルは上がりますが通知は届かず、ポイントも振り分けられません。フォームから登録したカードは対象です。",
  "niveles.q3": "メールが届かないときは？",
  "niveles.a3":
    "迷惑メールフォルダをご確認ください。見つからない場合は「マイカード」で、登録時と同じメールアドレスを入力してリンクを再請求してください。",
  "niveles.q4": "ランクに特典はありますか？",
  "niveles.a4":
    "ランクは称号のようなもので、公開カードの各スキルにバッジとして表示されます。",
  "niveles.volver": "← カタログに戻る",
  "niveles.ejemplo": "例",
  "niveles.flujo.titulo": "全体の流れ（4ステップ）",
  "niveles.flujo.1.t": "いいねをもらう",
  "niveles.flujo.1.d": "訪問者は1日1回いいねできます。",
  "niveles.flujo.2.t": "レベルアップ",
  "niveles.flujo.2.d": "ゲージがいっぱいになると次のレベルへ。",
  "niveles.flujo.3.t": "メールが届く",
  "niveles.flujo.3.d": "パスワードなしで入れるボタン付き。",
  "niveles.flujo.4.t": "ポイントを振り分け",
  "niveles.flujo.4.d": "強化するスキルを選びます。",
  "niveles.g1.titulo": "ゲージは空になっても、累計は増え続ける",
  "niveles.g1.texto":
    "上：レベルごとのゲージ。いっぱいになるとゼロに戻ります。下：累計EXP。増える一方です。どちらも同じいいねから計算されます。",
  "niveles.g1.barra": "レベルのゲージ",
  "niveles.g1.total": "累計EXP",
  "niveles.g1.likes": "もらったいいね",
  "niveles.g1.nivel": "レベル{n}",
  "niveles.g2.titulo": "レベルごとに少しずつ必要量が増える",
  "niveles.g2.texto":
    "各バーは、そのレベルから次へ進むのに必要なEXPです。最初のレベルはすぐ上がり、高いレベルほど根気が必要です。",
  "niveles.g2.eje": "各レベルに必要なEXP",
  "niveles.m1.titulo": "公開カードではこう見えます",
  "niveles.m1.texto":
    "名前の下にレベル、ゲージ、累計EXPが表示され、強化したスキルにはランクのバッジが付きます。",
  "niveles.m2.titulo": "「マイカード」はこう見えます",
  "niveles.m2.texto":
    "大きな数字が使えるポイントです。各スキルに「強化」ボタンがあり、ドットがランクを表します。",
  "niveles.m3.titulo": "ランクをひと目で",
  "niveles.m3.texto":
    "1ポイントでドットが1つ埋まります。ドットが{max}個で最大ランクです。",
  "niveles.ej.nombre": "ルナ・ノヴァ",
  "niveles.ej.hab1": "スターレイ",
  "niveles.ej.hab2": "スイートボイス",
  "niveles.ej.hab3": "グランドフィナーレ",
};
