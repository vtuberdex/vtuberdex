/**
 * Texto de los Términos y Condiciones de VTuberDex (`/terminos`).
 *
 * Es DATO, no JSX: la página los pinta y las pruebas fijan que las cláusulas que los formularios
 * prometen (confidencialidad, salida, donaciones sin lucro) existan con su ancla. Si cambias el
 * texto, sube `TERMINOS_VERSION` (`server/src/terminos-version.mjs`): las solicitudes guardan la
 * versión que aceptó cada persona.
 *
 * Es un modelo estándar redactado para el proyecto; antes de depender de él ante una disputa real
 * conviene que lo revise una persona abogada de tu jurisdicción.
 */
import { TERMINOS_VERSION } from '@/server/src/terminos-version.mjs';

export { TERMINOS_VERSION };

export interface Clausula {
  /** Ancla (`/terminos#salida`): los formularios enlazan a las cláusulas que importan. */
  id: string;
  titulo: string;
  /** Cada elemento es un párrafo; los numerados (`3.1`) van como texto, no como lista, para que se copien tal cual. */
  parrafos: string[];
}

export const FECHA_VIGENCIA = '6 de octubre de 2026';

export const PREAMBULO: string[] = [
  'Los presentes Términos y Condiciones (en adelante, los «Términos») regulan de manera integral, completa y vinculante la relación entre VTuberDex (en adelante, «el Proyecto», «nosotros» o «el Mantenedor») y toda persona natural o jurídica que, por cualquier medio, solicite la inscripción de una ficha de VTuber en el catálogo, solicite su baja, visite el sitio, interactúe con él o utilice cualquiera de sus funcionalidades (en adelante, «el Titular», «la Persona Usuaria» o «usted»).',
  'Se ruega leer íntegramente este documento antes de enviar cualquier formulario. El envío de un formulario de inscripción o de baja supone la aceptación plena, expresa, informada y sin reservas de todas y cada una de las cláusulas que siguen, incluidas aquellas que limitan derechos, establecen plazos, fijan consecuencias o excluyen responsabilidades.',
];

export const CLAUSULAS: Clausula[] = [
  {
    id: 'definiciones',
    titulo: 'Primera. Definiciones e interpretación',
    parrafos: [
      '1.1. «Catálogo»: el conjunto de fichas de VTubers publicadas y consultables en el sitio, incluidas sus cartas, imágenes, textos, atributos, enlaces y metadatos.',
      '1.2. «Ficha»: el registro individual de un VTuber dentro del Catálogo, con todos los datos de presentación pública que lo componen.',
      '1.3. «Datos Públicos»: los datos artísticos y de presentación del VTuber destinados a mostrarse en la Ficha, tales como nombre artístico, frase, descripción, país, idiomas, color de marca, imagen del personaje y enlaces a canales y redes sociales profesionales.',
      '1.4. «Datos Personales»: toda información que identifique o haga identificable a una persona natural y que se entregue en los formularios con carácter reservado, incluyendo, sin que la enumeración sea taxativa, el correo electrónico y los medios de comprobación de titularidad.',
      '1.5. «Solicitud»: cualquier envío realizado mediante el formulario de inscripción o el formulario de baja.',
      '1.6. «Aprobación»: la decisión discrecional del Mantenedor de acoger una Solicitud de inscripción, que da origen a una Ficha en estado de borrador.',
      '1.7. «Degradación»: el proceso descrito en la cláusula de salida, por el cual los Datos Públicos de una Ficha dada de baja se alteran de forma progresiva e irreversible sin que la Ficha se elimine del Catálogo.',
      '1.8. Los encabezados tienen un fin meramente orientativo y no alteran el alcance de las cláusulas. Las expresiones en singular comprenden el plural y viceversa. Cuando los Términos digan «incluido» o «incluyendo» se entenderá siempre «sin limitación».',
      '1.9. Ante cualquier discrepancia entre una explicación resumida, un texto de ayuda de un formulario o una comunicación informal, y el texto de estos Términos, prevalecerá siempre el texto de estos Términos.',
    ],
  },
  {
    id: 'aceptacion',
    titulo: 'Segunda. Aceptación, capacidad y vigencia',
    parrafos: [
      '2.1. La marcación de la casilla de aceptación y el envío del formulario constituyen una manifestación de voluntad equivalente a la firma manuscrita, y producen todos los efectos jurídicos propios de un contrato celebrado por medios electrónicos.',
      '2.2. El Titular declara tener al menos dieciocho (18) años de edad o, siendo menor, contar con la autorización expresa, previa y verificable de su madre, padre o representante legal, quien quedará obligado solidariamente por estos Términos. El Mantenedor podrá exigir en cualquier momento la acreditación de esta autorización y suspender la Solicitud mientras no se presente.',
      '2.3. Quien envíe una Solicitud en nombre de una agencia, de un grupo o de un tercero declara contar con facultades suficientes para obligarlo y responde personalmente si no las tuviera.',
      '2.4. Estos Términos entran en vigencia desde su aceptación y se mantienen vigentes mientras exista una Ficha asociada al Titular, y aun después de la baja respecto de todas las cláusulas que, por su naturaleza, estén destinadas a sobrevivirla, especialmente las de salida, propiedad intelectual, responsabilidad y resolución de controversias.',
      '2.5. Se deja constancia de que el Mantenedor conserva, junto con cada Solicitud, la versión de los Términos aceptada y la fecha y hora de la aceptación, como medio de prueba de ésta.',
    ],
  },
  {
    id: 'proceso',
    titulo: 'Tercera. Naturaleza de la inscripción y proceso de revisión',
    parrafos: [
      '3.1. La inscripción es una mera Solicitud. Su envío no crea derecho alguno a figurar en el Catálogo, a obtener una fecha de publicación determinada, a ocupar un número de la dex determinado ni a conservar un lugar en el orden del Catálogo.',
      '3.2. Toda Solicitud exige confirmar el correo electrónico informado mediante un código o enlace de un solo uso que se envía a esa dirección. En la inscripción y en la actualización de una Ficha la confirmación es previa a rellenar el formulario (el código vale 1 hora); en la baja se confirma tras enviar el formulario (vale 24 horas) y, mientras no se confirme, la Solicitud no se revisa y se elimina pasados unos días. Confirmada, la Solicitud queda en estado pendiente hasta ser revisada por el Mantenedor. No existe un plazo máximo de revisión; los tiempos indicados en cualquier comunicación son estimaciones no vinculantes y dependen de la disponibilidad voluntaria de quienes mantienen el Proyecto.',
      '3.3. El Mantenedor podrá aprobar, rechazar, dejar sin respuesta, solicitar antecedentes adicionales o aprobar parcialmente cualquier Solicitud, a su sola discreción y sin obligación de expresar causa. El rechazo no es impugnable ni genera derecho a indemnización alguna.',
      '3.4. La Aprobación crea una Ficha en estado de borrador. La publicación efectiva de la Ficha es una decisión posterior, independiente y también discrecional, que puede tardar o no producirse.',
      '3.5. El Mantenedor podrá corregir, completar, abreviar, traducir, reordenar, reformular o suprimir cualquier dato de la Solicitud para adecuarlo al formato, al estilo y a los criterios editoriales del Catálogo, incluyendo la elección de la imagen, del color de marca y de las facciones asociadas.',
      '3.6. El Titular reconoce que el Catálogo es una obra colectiva y editorial; la Ficha no es un perfil personal bajo su control, sino una entrada del Catálogo cuyo contenido final decide el Mantenedor.',
      '3.7. El envío de información falsa, incompleta o engañosa, o la suplantación de otra persona, facultan al Mantenedor para rechazar la Solicitud o retirar la Ficha en cualquier momento, sin perjuicio de las acciones que correspondan.',
    ],
  },
  {
    id: 'datos-personales',
    titulo: 'Cuarta. Datos personales: confidencialidad y tratamiento',
    parrafos: [
      '4.1. Los Datos Personales entregados en los formularios (correo electrónico, medios de comprobación de titularidad y cualquier otro dato de carácter reservado) son CONFIDENCIALES. No se publican en el sitio, no se incorporan a ninguna Ficha, no se muestran en el Catálogo, no se incluyen en la API pública ni en el mapa del sitio, y no se entregan a terceros ajenos al Proyecto.',
      '4.2. Los Datos Personales se almacenan separados de los Datos Públicos, en un campo distinto de la Solicitud, de modo que el proceso de creación de la Ficha solo lee los Datos Públicos. Solo acceden a ellos las personas con credenciales del mantenedor, y únicamente para revisar la Solicitud, comprobar la titularidad y comunicarse con el Titular.',
      '4.3. La finalidad exclusiva del tratamiento es: (a) evaluar la Solicitud; (b) comunicar su resultado; (c) verificar que quien pide una baja es efectivamente el Titular; y (d) conservar evidencia de la aceptación de estos Términos. Ningún Dato Personal se utilizará con fines publicitarios, comerciales ni de elaboración de perfiles, ni se venderá, cederá o arrendará.',
      '4.4. Se exceptúan de la confidencialidad los casos en que una norma legal obligue a entregar la información, o en que lo ordene una autoridad judicial o administrativa competente mediante resolución fundada. En tal caso se entregará solo lo estrictamente exigido.',
      '4.5. Por razones técnicas y de seguridad se almacena, en lugar de la dirección IP, una huella irreversible de la red desde la que se envía el formulario, con el único fin de limitar el envío masivo de Solicitudes. No es posible reconstruir la dirección IP a partir de ella.',
      '4.6. Las Solicitudes rechazadas y las bajas ya procesadas conservan únicamente los Datos Públicos y la constancia de la resolución; el contacto confidencial se elimina al cerrarlas. En las inscripciones aprobadas el contacto se conserva mientras exista la Ficha, para poder avisar de su publicación y atender futuras comunicaciones.',
      '4.7. El Titular puede pedir en cualquier momento el acceso, la rectificación o la eliminación de sus Datos Personales escribiendo por los canales de contacto del Proyecto. La eliminación de los Datos Personales no implica la eliminación de la Ficha, que se rige por la cláusula de salida.',
      '4.8. El Titular es responsable de proporcionar datos de contacto verdaderos y vigentes. El Mantenedor no responde por comunicaciones no recibidas por errores en el correo informado, filtros de correo no deseado o casillas llenas.',
      '4.9. Sin perjuicio de las medidas razonables adoptadas, ningún sistema es infalible. El Mantenedor no garantiza la inviolabilidad absoluta de los sistemas y no responde por accesos no autorizados derivados de ataques de terceros que no pudieron evitarse con diligencia razonable, comprometiéndose a informar las brechas relevantes cuando corresponda.',
      '4.10. Mientras se rellena la inscripción, lo escrito se guarda automáticamente como borrador asociado al correo electrónico confirmado, para que el Titular pueda cerrar la página y retomarlo después con ese mismo correo. El borrador solo lo ve el Mantenedor al revisar la Solicitud ya enviada, se elimina al enviar la inscripción y, si no se envía, a los sesenta (60) días sin cambios.',
      '4.11. Los Datos Públicos, a diferencia de los Datos Personales, están destinados a la exhibición. El Titular que incluya datos personales en un campo público (por ejemplo, en la descripción o en un enlace) lo hace bajo su exclusiva responsabilidad y autoriza su publicación.',
    ],
  },
  {
    id: 'contenido',
    titulo: 'Quinta. Contenido entregado por el Titular y licencia',
    parrafos: [
      '5.1. El Titular declara y garantiza que es autor o titular legítimo de todos los textos, imágenes, diseños, ilustraciones, modelos y demás materiales que proporcione, o que cuenta con las licencias y autorizaciones necesarias de las personas ilustradoras, modeladoras, animadoras y demás titulares de derechos intervinientes.',
      '5.2. Con la Solicitud, el Titular otorga al Proyecto una licencia gratuita, mundial, no exclusiva, transferible entre quienes mantengan el Proyecto, sublicenciable para los fines técnicos del sitio, y por todo el tiempo de protección legal de los derechos, para almacenar, reproducir, adaptar, recortar, redimensionar, comprimir, transformar, combinar, comunicar públicamente y poner a disposición los Datos Públicos y las imágenes asociadas, en el Catálogo, en la carta holográfica, en sus resultados de búsqueda y en cualquier formato o tecnología presente o futura de presentación del Catálogo.',
      '5.3. La licencia comprende expresamente el derecho a generar derivados visuales de la imagen, como cartas, marcos, placas, efectos de brillo, efectos holográficos, recortes, versiones de menor tamaño y cualquier tratamiento que el Proyecto estime conveniente para la presentación.',
      '5.4. La licencia es irrevocable en lo que respecta a copias de seguridad, registros históricos y materiales ya difundidos, y subsiste después de la baja en los términos de la cláusula de salida.',
      '5.5. El Titular conserva la propiedad intelectual de sus obras. El Proyecto conserva la propiedad de la obra colectiva que constituye el Catálogo, de su diseño, de su código, de sus marcas, de sus cartas, de sus bases de datos y de su sistema de numeración.',
      '5.6. No se admite contenido ilícito, que infrinja derechos de terceros, discriminatorio, violento, pornográfico, que incite al odio, que contenga publicidad engañosa, enlaces maliciosos o que vulnere la ley. El Mantenedor podrá retirarlo sin aviso previo.',
      '5.7. Si un tercero reclama contra el Proyecto por contenido aportado por el Titular, éste se obliga a mantener indemne al Proyecto y a quienes lo mantienen, asumiendo los costos, honorarios, multas e indemnizaciones razonables que de ello deriven.',
      '5.8. Los enlaces a redes sociales y canales son responsabilidad de su titular. El Mantenedor no controla ni respalda los contenidos de sitios de terceros y puede quitar cualquier enlace si estima que perjudica al Proyecto o a sus usuarios.',
    ],
  },
  {
    id: 'obligaciones',
    titulo: 'Sexta. Obligaciones del Titular',
    parrafos: [
      '6.1. Proporcionar información veraz, exacta, completa y actualizada, y mantenerla así mientras exista la Ficha.',
      '6.2. Abstenerse de enviar Solicitudes en nombre de otras personas sin su autorización, de enviar Solicitudes duplicadas o masivas y de utilizar herramientas automatizadas para completar los formularios.',
      '6.3. No intentar eludir las limitaciones técnicas del sitio, no manipular los contadores de likes, de experiencia o de nivel, no intentar acceder a áreas restringidas y no interferir con el funcionamiento del Proyecto.',
      '6.4. Informar de inmediato al Mantenedor cualquier error en su Ficha, cualquier uso indebido de su identidad y cualquier cambio relevante de sus datos de contacto.',
      '6.5. Cumplir las normas aplicables a su actividad, incluidas las de las plataformas de streaming y de redes sociales que utilice, siendo ajeno el Proyecto a cualquier sanción que éstas le impongan.',
      '6.6. Respetar los derechos de las demás personas inscritas, abstenerse de acosar, difamar o hostigar a otros Titulares o a quienes mantienen el Proyecto, y conducirse con buena fe en todas sus comunicaciones.',
    ],
  },
  {
    id: 'moderacion',
    titulo: 'Séptima. Facultades editoriales, moderación y suspensión',
    parrafos: [
      '7.1. El Mantenedor podrá, en cualquier momento, sin necesidad de aviso previo ni de expresión de causa, modificar, ocultar, volver a borrador, reordenar, renumerar, fusionar, renombrar o cambiar la dirección web de cualquier Ficha.',
      '7.2. La numeración de la dex es un dato interno del Catálogo. Su asignación, modificación o reasignación no genera ningún derecho a un número determinado.',
      '7.3. Cuando el nombre de una Ficha cambie, la dirección anterior podrá mantenerse como alias, pero el Proyecto no garantiza la permanencia de ninguna dirección web.',
      '7.4. El Mantenedor podrá limitar el número de Solicitudes por persona, red o período, y descartar sin respuesta las Solicitudes que parezcan automatizadas.',
      '7.5. El uso del sitio puede suspenderse o limitarse total o parcialmente, de forma temporal o definitiva, cuando se incumplan estos Términos, sin que ello dé lugar a compensación alguna.',
    ],
  },
  {
    id: 'salida',
    titulo: 'Octava. Cláusula de salida (baja) y degradación de la Ficha',
    parrafos: [
      '8.1. El Titular puede solicitar su baja en cualquier momento mediante el formulario de baja, aceptando estos mismos Términos. La baja exige indicar un correo y confirmarlo con un enlace o código de un solo uso enviado a esa dirección. Si ese correo es el que el Titular entregó al inscribir una o más Fichas, la baja se aplica de inmediato y sin revisión a las Fichas inscritas con él: pasan al grado 1 de degradación. En cualquier otro caso (por ejemplo, fichas incorporadas al Catálogo sin inscripción propia) la baja queda pendiente hasta ser revisada y procesada por el Mantenedor, que podrá pedir antecedentes adicionales para comprobar la titularidad.',
      '8.2. LA BAJA NO IMPLICA LA ELIMINACIÓN DE LA FICHA. Dado que la Ficha es una entrada de una obra colectiva y que forma parte del orden, de las estadísticas, de las facetas y de la numeración del Catálogo, ésta permanece en él después de la baja. El Titular reconoce y acepta expresamente que no existe un derecho a la supresión de la Ficha como entrada del Catálogo.',
      '8.3. En lugar de eliminarse, la Ficha será sometida a DEGRADACIÓN: una alteración progresiva e irreversible de sus Datos Públicos, que podrá comprender, a discreción del Mantenedor y en el orden y ritmo que éste determine, la corrupción parcial o total de los textos, la sustitución de caracteres por símbolos ilegibles, la pérdida de nitidez, color y resolución de las imágenes, el retiro de los enlaces a canales y redes sociales, la pérdida de atributos, habilidades y estadísticas, la neutralización del color de marca y la desvinculación de facciones, grados y distinciones.',
      '8.4. La Degradación persigue que la Ficha deje de representar, identificar o promocionar al Titular, sin alterar la integridad del Catálogo. Una Ficha degradada puede seguir siendo visible, buscable y numerada, con un aspecto deteriorado, y podrá seguir figurando en listados, recuentos y conjuntos de datos del Proyecto.',
      '8.5. La Degradación es irreversible. El Titular que se retire no podrá exigir la restauración de la Ficha anterior, aunque posteriormente se arrepienta. Una nueva inscripción será tratada como una Solicitud nueva y sujeta a su propia revisión, y no obligará al Proyecto a recuperar nada de lo degradado.',
      '8.6. Los Datos Personales del Titular (correo y medios de comprobación) se eliminan al procesar la baja, según la cláusula de datos personales. Lo que subsiste es la Ficha degradada, que no contiene Datos Personales, porque éstos nunca formaron parte de ella.',
      '8.7. Las copias de seguridad, los registros históricos, los archivos de terceros y los materiales ya difundidos o descargados antes de la baja no están sujetos a Degradación, y el Proyecto no puede asegurar su eliminación de sitios o servicios ajenos.',
      '8.8. El Mantenedor no está obligado a procesar la baja dentro de un plazo determinado, ni a informar del avance de la Degradación, ni a confirmar su término. Podrá rechazar la baja si no se acredita la titularidad.',
      '8.9. Quien controle el buzón del correo entregado al inscribir la Ficha puede, por ese solo hecho, dar de baja la Ficha de forma irreversible: el Titular es responsable de la seguridad de ese correo.',
      '8.10. La Degradación podrá aplicarse también, sin necesidad de solicitud, a las Fichas cuyos Titulares incumplan gravemente estos Términos o respecto de las cuales se compruebe que la inscripción se hizo sin derecho.',
      '8.11. El Titular declara haber leído esta cláusula, comprender su alcance y aceptarla como condición esencial, sin la cual el Proyecto no habría admitido su inscripción.',
    ],
  },
  {
    id: 'donaciones',
    titulo: 'Novena. Donaciones, cartas premium y ausencia de fines de lucro',
    parrafos: [
      '9.1. El Proyecto no tiene fines de lucro. El sistema de donaciones existe exclusivamente para contribuir a financiar los costos de operación del sitio, tales como alojamiento, base de datos, almacenamiento de imágenes, dominio y herramientas, y no constituye una actividad comercial, un negocio, una venta de servicios ni una fuente de ingresos para sus mantenedores.',
      '9.2. Las donaciones son voluntarias, liberales y de carácter graciable. No constituyen precio, contraprestación, suscripción, cuota ni pago por un servicio, y no generan obligación alguna de prestación a cargo del Proyecto, más allá de lo expresamente señalado en estos Términos.',
      '9.3. Las donaciones no son reembolsables, salvo error manifiesto en el monto cobrado por el proveedor de pagos, que podrá corregirse a solicitud del donante dentro de un plazo razonable.',
      '9.4. Quien dona no adquiere propiedad, participación, derecho de voto, derecho de dirección, derecho de exclusividad, ni preferencia alguna sobre el Proyecto, el Catálogo o su contenido.',
      '9.5. Como gesto de reconocimiento, el Proyecto podrá otorgar a la Ficha de un VTuber donante una carta «premium» gradeada, cuyo grado asciende en los términos definidos por el Mantenedor mientras la donación se mantenga. El grado, su escala, su cálculo, su vigencia y su presentación son una distinción simbólica y decorativa, no un derecho, y pueden modificarse, suspenderse o retirarse en cualquier momento.',
      '9.6. La carta premium no garantiza visibilidad, posición en búsquedas, tráfico, seguidores ni ningún resultado comercial. Tampoco compra la permanencia de la Ficha ni la exime de estos Términos ni de la cláusula de salida.',
      '9.7. Cualquier excedente eventual se destinará a la continuidad y mejora del Proyecto. El Proyecto no reparte utilidades ni remunera a sus mantenedores con cargo a las donaciones.',
      '9.8. Los pagos son procesados por proveedores externos, con sus propias condiciones y políticas, que el donante debe aceptar de forma independiente. El Proyecto no almacena datos de tarjetas ni de cuentas de pago.',
      '9.9. Las donaciones son responsabilidad tributaria exclusiva de quien las hace y, en su caso, de quien las recibe conforme a la ley. El Proyecto no emite documentos tributarios a menos que la ley lo exija expresamente.',
      '9.10. El Titular reconoce que las donaciones no son requisito para inscribirse, para permanecer en el Catálogo ni para solicitar la baja.',
    ],
  },
  {
    id: 'likes',
    titulo: 'Décima. Likes, experiencia, niveles y otras mecánicas del sitio',
    parrafos: [
      '10.1. Los «likes», la experiencia, los niveles, los grados, las estadísticas y demás atributos de la carta son mecánicas lúdicas del sitio. Pueden modificarse, reiniciarse, recalcularse o eliminarse en cualquier momento, sin que ello otorgue derecho alguno al Titular.',
      '10.2. Los atributos de la carta pueden ser creados o ajustados por el Mantenedor con criterios propios y no constituyen una evaluación, ranking, certificación ni opinión sobre el valor profesional o personal del VTuber.',
      '10.3. El Proyecto aplica limitaciones técnicas destinadas a evitar la manipulación de los contadores, y puede anular likes o ajustar la experiencia que considere irregulares.',
    ],
  },
  {
    id: 'disponibilidad',
    titulo: 'Undécima. Disponibilidad del servicio y exclusión de garantías',
    parrafos: [
      '11.1. El sitio y el Catálogo se ofrecen «tal cual» y «según disponibilidad», sin garantía de ningún tipo, expresa o implícita, incluidas las de comerciabilidad, idoneidad para un fin particular, exactitud, continuidad y ausencia de errores.',
      '11.2. El Proyecto se mantiene de manera voluntaria. Puede interrumpirse, migrarse, reducirse, modificar sus funciones o cerrarse definitivamente en cualquier momento, con o sin aviso, sin que ello genere derecho a compensación.',
      '11.3. No se garantiza la conservación indefinida de los datos, de las imágenes ni de las Fichas. Se recomienda al Titular conservar copia de todo lo que envíe.',
      '11.4. El Mantenedor no garantiza que la información del Catálogo sea exacta, completa o actualizada, ni que los enlaces funcionen o conduzcan a los destinos esperados.',
      '11.5. Los tiempos de carga, la compatibilidad con dispositivos, la disponibilidad de la carta tridimensional y el rendimiento gráfico dependen del equipo y del navegador de cada persona, y no son responsabilidad del Proyecto.',
    ],
  },
  {
    id: 'responsabilidad',
    titulo: 'Duodécima. Limitación de responsabilidad e indemnidad',
    parrafos: [
      '12.1. En la máxima medida permitida por la ley, el Proyecto y quienes lo mantienen no serán responsables de daños indirectos, consecuenciales, incidentales, especiales, punitivos ni de lucro cesante, pérdida de oportunidades, de audiencia, de ingresos, de reputación o de datos, derivados del uso o de la imposibilidad de uso del sitio, de la inscripción, de la no inscripción, de la baja o de la Degradación.',
      '12.2. Cuando una responsabilidad no pueda excluirse por ley, quedará limitada al monto efectivamente donado por el Titular al Proyecto durante los doce (12) meses anteriores al hecho que la origine, o a cero si no hubiera donado.',
      '12.3. El Titular se obliga a mantener indemne al Proyecto y a quienes lo mantienen frente a reclamaciones, daños, pérdidas, costos y honorarios derivados del incumplimiento de estos Términos, de la información que haya entregado o de los derechos de terceros que ésta vulnere.',
      '12.4. Ninguna de las partes responde por incumplimientos causados por caso fortuito o fuerza mayor, entendiéndose como tales, entre otros, la caída de proveedores de alojamiento o de base de datos, fallas de energía o de redes, ataques informáticos, decisiones de autoridad y cualquier hecho imprevisible o irresistible.',
    ],
  },
  {
    id: 'terceros',
    titulo: 'Decimotercera. Servicios de terceros',
    parrafos: [
      '13.1. El sitio se apoya en servicios de terceros para el alojamiento, el almacenamiento de datos e imágenes, el procesamiento de pagos y el envío de comunicaciones. Estos proveedores pueden tratar datos conforme a sus propias políticas.',
      '13.2. El Proyecto selecciona proveedores con diligencia razonable, pero no es responsable por sus fallas, cambios de condiciones, cierres o brechas de seguridad.',
      '13.3. Los datos podrán almacenarse o procesarse en servidores ubicados fuera del país de residencia del Titular. Con el envío de la Solicitud, el Titular consiente expresamente dichas transferencias internacionales, limitadas a lo técnicamente necesario para el funcionamiento del sitio.',
    ],
  },
  {
    id: 'comunicaciones',
    titulo: 'Decimocuarta. Comunicaciones y notificaciones',
    parrafos: [
      '14.1. Las comunicaciones del Proyecto se harán al correo electrónico informado en la Solicitud, y se entenderán practicadas el día de su envío, con independencia de su lectura.',
      '14.2. Las comunicaciones del Titular se harán por los canales de contacto publicados por el Proyecto. No se considerarán recibidas las que se envíen por medios no oficiales, tales como mensajes privados a terceros o comentarios en redes.',
      '14.3. El Mantenedor puede responder o no a cualquier comunicación, y hacerlo en el momento que estime oportuno.',
      '14.4. El Titular acepta recibir los avisos operativos relacionados con su Solicitud y con su Ficha. El Proyecto no enviará publicidad.',
    ],
  },
  {
    id: 'modificaciones',
    titulo: 'Decimoquinta. Modificaciones de los Términos',
    parrafos: [
      '15.1. El Mantenedor puede modificar estos Términos en cualquier momento. La versión vigente es la publicada en esta página, identificada por su fecha.',
      '15.2. Las modificaciones rigen desde su publicación respecto de las Solicitudes nuevas. Respecto de las personas ya inscritas, se entenderán aceptadas si éstas no solicitan su baja dentro de los treinta (30) días siguientes a la publicación de la nueva versión.',
      '15.3. Es responsabilidad del Titular revisar periódicamente esta página. El Proyecto no está obligado a notificar individualmente cada cambio.',
      '15.4. Cuando se modifique el texto, los formularios abiertos con la versión anterior serán rechazados hasta que se vuelvan a aceptar los Términos vigentes.',
    ],
  },
  {
    id: 'cesion',
    titulo: 'Decimosexta. Cesión, continuidad y sucesión del Proyecto',
    parrafos: [
      '16.1. El Proyecto podrá ceder, transferir o traspasar total o parcialmente sus derechos y obligaciones bajo estos Términos, incluidos el Catálogo, las Fichas y la base de datos, a otra persona, organización o comunidad que continúe el Proyecto, con el mismo compromiso de confidencialidad de los Datos Personales.',
      '16.2. El Titular no podrá ceder su posición en estos Términos ni transferir su Ficha a un tercero sin autorización escrita del Mantenedor.',
      '16.3. Si el Proyecto se cierra, podrá liberar el Catálogo, sus imágenes y sus datos públicos como archivo, o eliminarlos, a su sola elección. Los Datos Personales se eliminarán en todo caso.',
    ],
  },
  {
    id: 'marcas',
    titulo: 'Decimoséptima. Marcas, nombres y uso de la imagen',
    parrafos: [
      '17.1. Los nombres artísticos, las imágenes de los personajes y las marcas de los VTubers pertenecen a sus respectivos titulares. Su aparición en el Catálogo tiene un fin informativo y de reconocimiento, y no implica patrocinio, afiliación ni respaldo mutuo.',
      '17.2. El nombre «VTuberDex», su logotipo, el diseño de las cartas, los efectos holográficos y los nombres de los grados son del Proyecto, y no pueden usarse sin autorización.',
      '17.3. El Titular autoriza el uso de su nombre artístico y de la imagen de su personaje, en la forma descrita en la cláusula de contenido, para el funcionamiento del Catálogo, de sus páginas de detalle, de sus vistas previas en redes y buscadores, y de los materiales informativos del Proyecto.',
      '17.4. La autorización no comprende el uso de la voz, del rostro real ni de la imagen civil del Titular, que el Proyecto no solicita ni publica.',
    ],
  },
  {
    id: 'seguridad',
    titulo: 'Decimoctava. Seguridad, uso aceptable y conducta en el sitio',
    parrafos: [
      '18.1. Queda prohibido intentar vulnerar la seguridad del sitio, realizar pruebas de intrusión sin autorización, extraer masivamente datos mediante automatización, sobrecargar los servicios o introducir código malicioso.',
      '18.2. Quien descubra una vulnerabilidad deberá comunicarla de manera responsable al Mantenedor, absteniéndose de explotarla o divulgarla antes de su corrección.',
      '18.3. El Proyecto puede registrar datos técnicos mínimos de uso (como la huella de red y la fecha de envío) para proteger el servicio y prevenir abusos.',
      '18.4. El incumplimiento de esta cláusula puede dar lugar a bloqueo, retiro de la Ficha y acciones legales.',
    ],
  },
  {
    id: 'cookies',
    titulo: 'Decimonovena. Cookies y almacenamiento local',
    parrafos: [
      '19.1. El sitio utiliza una cookie técnica anónima para reconocer al visitante que da un like y limitar uno por día. No contiene datos personales ni se utiliza con fines publicitarios.',
      '19.2. El mantenedor utiliza almacenamiento local del navegador para mantener su sesión. Este almacenamiento no se utiliza en los formularios públicos.',
      '19.3. Al navegar por el sitio, la persona usuaria acepta el uso de estas tecnologías, que puede bloquear desde su navegador, con la consecuente pérdida de funciones.',
    ],
  },
  {
    id: 'conservacion',
    titulo: 'Vigésima. Plazos de conservación',
    parrafos: [
      '20.1. Las Solicitudes pendientes se conservan hasta su resolución. Las Solicitudes rechazadas y las bajas procesadas conservan únicamente los Datos Públicos y la constancia de la resolución, sin contacto confidencial.',
      '20.2. La constancia de aceptación de los Términos (versión, fecha y hora) se conserva mientras pueda ser necesaria para acreditar la relación.',
      '20.3. Los Datos Públicos del Catálogo se conservan mientras el Proyecto exista, incluso después de la baja, en la forma degradada prevista en la cláusula de salida.',
      '20.4. Las copias de seguridad se renuevan según la política técnica del proveedor y pueden conservar datos por períodos adicionales, hasta su rotación natural.',
    ],
  },
  {
    id: 'divisibilidad',
    titulo: 'Vigesimoprimera. Divisibilidad, renuncia e integridad',
    parrafos: [
      '21.1. Si alguna cláusula fuera declarada nula o inaplicable, las demás conservarán plena vigencia, y la cláusula afectada se interpretará del modo más cercano a la intención original que la ley permita.',
      '21.2. La falta o el retraso del Proyecto en ejercer un derecho no significa su renuncia. Ninguna renuncia será válida si no consta por escrito.',
      '21.3. Estos Términos constituyen el acuerdo íntegro entre las partes sobre su objeto y reemplazan cualquier acuerdo, comunicación o promesa anterior, verbal o escrita.',
      '21.4. Las cláusulas que por su naturaleza deban subsistir a la terminación de la relación, en especial las de salida, propiedad intelectual, datos personales, responsabilidad y ley aplicable, seguirán vigentes tras la baja.',
    ],
  },
  {
    id: 'ley',
    titulo: 'Vigesimosegunda. Ley aplicable y resolución de controversias',
    parrafos: [
      '22.1. Estos Términos se rigen por las leyes de la República de Chile, sin perjuicio de las normas imperativas de protección de datos y de consumo que correspondan al domicilio del Titular y que no puedan renunciarse.',
      '22.2. Las partes procurarán resolver amistosamente cualquier controversia, mediante comunicación escrita y negociación de buena fe durante un plazo de treinta (30) días corridos.',
      '22.3. Transcurrido ese plazo sin acuerdo, la controversia se someterá a los tribunales ordinarios de justicia con competencia en la ciudad de Santiago de Chile, a cuya jurisdicción las partes se someten.',
      '22.4. Ninguna acción derivada de estos Términos podrá iniciarse una vez transcurrido un (1) año desde que el hecho que la origina haya ocurrido o debido razonablemente conocerse, en la medida en que la ley permita pactar ese plazo.',
    ],
  },
  {
    id: 'declaraciones',
    titulo: 'Vigesimotercera. Declaraciones finales del Titular',
    parrafos: [
      '23.1. Al enviar la Solicitud, el Titular declara que: (a) ha leído y comprendido estos Términos en su totalidad; (b) acepta todas sus cláusulas, y en particular las de confidencialidad de datos, cesión de licencia, salida con Degradación, donaciones sin fines de lucro y limitación de responsabilidad; (c) la información entregada es verdadera; (d) tiene derecho a ceder las licencias aquí descritas; y (e) lo hace de forma libre y voluntaria.',
      '23.2. El Titular reconoce que ha tenido la oportunidad de formular preguntas y de solicitar aclaraciones al Proyecto antes de aceptar, y que su aceptación no ha sido condicionada ni forzada.',
      '23.3. Las partes convienen en que el registro electrónico de la Solicitud, de la versión aceptada y de su fecha y hora constituirá prueba suficiente de la aceptación de estos Términos.',
    ],
  },
];

/** Palabras del texto completo: sirve para mostrar el tiempo aproximado de lectura. */
export function contarPalabras(): number {
  const todo = [...PREAMBULO, ...CLAUSULAS.flatMap((c) => [c.titulo, ...c.parrafos])].join(' ');
  return todo.split(/\s+/).filter(Boolean).length;
}
