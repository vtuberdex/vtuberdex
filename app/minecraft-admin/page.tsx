/**
 * `/minecraft-admin` — mantenedor de plugins y configuración del servidor de Minecraft.
 *
 * La página no protege nada por sí sola: quien tenga la URL llama a la API directamente.
 * Cada endpoint comprueba el rol `mantenedor` (ver `lib/minecraft-admin.mjs`); aquí solo se
 * pinta el formulario y se muestra el 401/403 cuando la sesión no vale.
 */
import type { Metadata } from "next";

import { PanelMinecraftAdmin } from "@/components/minecraft-admin/panel-minecraft";
import { NOMBRE_SITIO } from "@/lib/seo";

export const metadata: Metadata = {
  title: `Mantenedor de Minecraft · ${NOMBRE_SITIO}`,
  robots: { index: false, follow: false },
};

export default function MinecraftAdminPage() {
  return <PanelMinecraftAdmin />;
}
