/**
 * `/api/modificaciones/imagen` — el avatar y el logo del formulario de modificacion, subidos en lugar de pegados
 * como enlace. `POST ?tipo=character|logo` sube un WebP; `GET ?id=` devuelve la vista previa a quien la
 * subió. Exige la credencial del formulario en la cabecera `x-credencial`. Las reglas (formato, medidas,
 * peso, cupos, caducidad) están en `server/src/imagenes-solicitud.mjs`.
 */
import {
  leerImagenDeSolicitud,
  subirImagenDeSolicitud,
} from "../../../../lib/solicitudes.mjs";

export const dynamic = "force-dynamic";

export function POST(request) {
  return subirImagenDeSolicitud(request, "modificacion");
}

export function GET(request) {
  return leerImagenDeSolicitud(request, "modificacion");
}
