# Agente de archivos y terminal (`vtuberdex-mc-agente`)

Hace el trabajo de la pestaña **«Archivos y plugins»** de `/minecraft-admin`: explorador de
toda `/srv/minecraft`, editor (Monaco), subidas, zips, permisos y terminal bash.

```
navegador ──HTTPS──▶ nginx ──▶ Next (vtuberdex, sesión + rol + X-Panel + auditoría)
                                   │  socket UNIX + token
                                   ▼
                     vtuberdex-mc-agente (usuario minecraft, systemd confinado)
                                   │
                                   └─ terminal: pty-puente.py → bwrap → bash
```

## Por qué un proceso aparte

La web corre como `vtuberdex` sin capacidades, con `NoNewPrivileges` y
`RestrictNamespaces`: no puede cambiar de usuario ni montar una caja, y su entorno lleva sus
secretos. Lo que escribiera quedaría con dueño `vtuberdex`. El agente corre como
`minecraft`, solo puede escribir en `/srv/minecraft` (`ProtectSystem=strict`) y no ve
`/etc/vtuberdex.env`, `/var/lib/vtuberdex`, `/var/www`, `/srv/vtuberdex` ni `/opt/miyuki`.

## La terminal

`bash --login` dentro de bubblewrap: `/usr` de solo lectura, una lista corta de `/etc`
(`ETC_PARA_LA_TERMINAL`), `/srv/minecraft` de lectura y escritura, `/tmp` propio, PID propio
(no ve ni puede matar el proceso del servidor) y entorno limpio. Hay red (para `curl`/`wget`
de plugins). Cada línea tecleada queda en `journalctl -u vtuberdex-mc-agente` con el correo.
Máximo 4 terminales por persona y 12 en total; se cierran a los 30 min sin nadie mirando o a
las 12 h. Al recargar la página el panel se reengancha y repinta los últimos 256 KB.

Alcance decidido con el dueño del servidor (2026-11-20): admin y mantenedor tienen el mismo
acceso, sin carpetas ocultas. Quien usa la terminal puede leer `plugins/VTuberDex/config.yml`
(token de la web para el plugin) y `server.properties` (clave RCON).

## Reinicio forzoso

Botón «Reinicio forzoso» de la barra lateral → `POST /api/minecraft-admin/reinicio-forzoso` → agente
`POST /servidor/matar`. El agente manda SIGKILL al proceso del servidor (mismo usuario `minecraft`,
carpeta de trabajo = la raíz y `-jar paper.jar`; el jar se cambia con `AGENTE_JAR_SERVIDOR`) y systemd
lo vuelve a levantar (`Restart=always`). No recibe ningún PID del cliente. **No guarda el mundo**: es
para cuando el servidor está colgado y el `stop` por RCON no responde (2026-11-28: el watchdog de Paper
paró el hilo principal y la JVM no salió por un bloqueo del profiler de spark). Queda en la auditoría
(`reinicio-forzoso`) y en `journalctl -u vtuberdex-mc-agente`. En la VPS hay además un vigilante
(`mc-vigilante.timer`, fuera del repositorio) que hace lo mismo solo tras 5 min sin respuesta por RCON.

## Permisos (lo que ya costó)

- **Solo el dueño puede hacer chmod.** El agente es `minecraft`; el panel viejo subía archivos como
  `vtuberdex` (174 archivos y carpetas). El 2026-11-20 se pasaron a `minecraft:minecraft` (lista de
  dueños anteriores en `/var/lib/vtuberdex-mc-dueños-antes-*.txt`). Si vuelve a haber archivos de otro
  usuario, «Permisos…» los salta y lo avisa en vez de fallar entero.
- **ACL de `plugins/`.** La web (`user:vtuberdex`) lee los jars para el estado de los plugins. Con ACL,
  los bits de grupo de chmod son la máscara: `chmod 700` la dejaba sin leer. Tras el chmod el agente
  pone `m::r[w]X` a lo que tiene ACL extendida (`conservarLecturaDeLaWeb`).
- **Activar/desactivar plugins lo renombra el agente** (`plugins/estado` → `mover`): la web ya no
  necesita escribir en `plugins/`.

## Instalar / actualizar

```bash
sudo minecraft-agente/instalar.sh       # copia a /opt/vtuberdex-mc-agente, crea el token, reinicia el agente
sudo systemctl restart vtuberdex        # solo la PRIMERA vez: la web lee el token del drop-in
```

El autodeploy publica la web, **no** el agente: si cambia `agente.mjs` o `pty-puente.py`,
volver a correr `instalar.sh`. nginx necesita las `location` de `/api/minecraft-admin/fs` y
`/api/minecraft-admin/terminal` de `infra/nginx/vtuberdex-locations.conf` (sin límite de API,
subidas de 1 GB y sin búfer para la salida de la terminal).

## Comprobar

```bash
systemctl status vtuberdex-mc-agente
sudo bash -c '. /etc/vtuberdex-mc-agente.env; curl -s --unix-socket /run/vtuberdex-mc-agente/agente.sock -H "x-agente-token: $AGENTE_TOKEN" http://a/salud'
```
