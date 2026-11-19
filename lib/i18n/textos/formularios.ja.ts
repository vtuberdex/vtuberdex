// Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
import type { formulariosEs } from "./formularios";

export const formulariosJa: { [K in keyof typeof formulariosEs]: string } = {
  "form.confidencial": "非公開 · 公開されません",
  "form.trampa": "この欄には入力しないでください",
  "form.terminosAcepto": "次の内容を読み、同意します：",
  "form.terminosNombre": "利用規約",
  "form.terminosIncluida": "（",
  "form.terminosSalida": "退会条項",
  "form.terminosSalidaNota":
    "を含む。退会したカードは削除されず、劣化します）。",

  "baja.titulo": "退会する",
  "baja.intro":
    "カタログへの掲載を終了したい場合は、メールアドレスと理由を入力してください。アドレスが本人のものであることを確認するため、1回限りのコードを送信します。コードを入力すると、そのメールで登録したカードの退会がすぐに適用されます。",
  "baja.errorTerminos": "退会を申請するには利用規約に同意する必要があります。",
  "baja.errorEnviar": "申請を送信できませんでした。もう一度お試しください。",
  "baja.errorConfirmar": "確認できませんでした。もう一度お試しください。",
  "baja.revisaCorreo": "メールを確認してください。",
  "baja.codigoEnviadoA": "コードを次のアドレスに送信しました：",
  "baja.codigoInstrucciones":
    "ここに貼り付けて退会を確定するか、メール内のボタンを押してください。有効期間は24時間です。届かない場合は迷惑メールをご確認ください。",
  "baja.paso2": "ステップ 2/2 · 退会の確認",
  "baja.codigo": "メールのコード",
  "baja.confirmando": "確認中…",
  "baja.confirmar": "退会を確定する",
  "baja.volver": "戻ってメールを変更する",
  "baja.avisoTitulo": "続ける前に：カードはどうなるか",
  "baja.avisoNoElimina": "退会しても",
  "baja.avisoNoEliminaFuerte": "カードは削除されません",
  "baja.avisoTexto":
    "。カタログには残りますが、データ（テキスト、画像、リンク）は破損し、元に戻せない形で劣化します。個人情報（メール）は削除されます。詳しくは次をご覧ください：",
  "baja.paso1": "ステップ 1/2 · メールアドレスと理由",
  "baja.correo": "メールアドレス",
  "baja.correoAyuda":
    "カードの登録に使ったメールアドレス。本人のものか確認するためコードを送信し、それによって関連するカードが退会となります。",
  "baja.motivo": "理由",
  "baja.motivoAyuda": "任意。",
  "baja.otroCorreo": "このメールでカードを登録していません",
  "baja.ficha": "カード",
  "baja.fichaAyuda":
    "名前またはアドレス（例：/v/my-name）。メールだけでは本人確認ができないため、担当者が確認します。",
  "baja.enviando": "送信中…",
  "baja.enviarCodigo": "コードを送信する",

  "verificar.titulo": "メールの確認",
  "verificar.intro":
    "ボタンを押して、このアドレスが本人のものであることを確認してください。リンクは1回のみ有効です。",
  "verificar.tipo.inscripcion": "あなたの登録",
  "verificar.tipo.baja": "あなたの退会申請",
  "verificar.tipo.modificacion": "あなたの変更申請",
  "verificar.bajaAplicada": "退会が適用されました。",
  "verificar.bajaTexto_one":
    "メールが本人のものであることを確認しました。カード {fichas} はグレード1になり、連絡先データは削除されました。",
  "verificar.bajaTexto_other":
    "メールが本人のものであることを確認しました。カード {fichas} はグレード1になり、連絡先データは削除されました。",
  "verificar.confirmado": "メールを確認しました。",
  "verificar.sinFicha":
    "このアドレスで登録されたカードは見つからなかったため、何も適用されていません。申請は保留中で、管理者が確認し、どのカードかを尋ねるためにこのメールへ連絡することがあります。",
  "verificar.enEspera":
    "{tipo}は管理者の確認待ちです。返信の期限は保証されません。",
  "verificar.bajaRevision":
    "メールだけでは本人確認ができないため、担当者が確認します。",
  "verificar.volver": "カタログに戻る",
  "verificar.errorConfirmar": "確認できませんでした。もう一度お試しください。",
  "verificar.incompleto":
    "このリンクは不完全です。メールのリンクを届いたとおりに開いてください（途切れた場合は全体をコピーしてください）。または、フォームをもう一度送信してください。",
  "verificar.confirmando": "確認中…",
  "verificar.confirmarBoton": "メールを確認する",
};
