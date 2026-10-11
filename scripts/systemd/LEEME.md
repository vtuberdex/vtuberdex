# Publicación automática (VPS)

`scripts/auto-deploy.sh` vigila `master` de `vtuberdex/vtuberdex` y `vtuberdex/vtuberdex-minecraft` y publica lo nuevo.
Explicación y trampas: cabecera del script.

```bash
sudo install -m 755 scripts/auto-deploy.sh /usr/local/sbin/vtuberdex-autodeploy
sudo install -m 644 scripts/systemd/vtuberdex-autodeploy.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now vtuberdex-autodeploy.timer
journalctl -u vtuberdex-autodeploy -f          # qué hizo
systemctl list-timers vtuberdex-autodeploy     # cuándo vuelve a mirar
VTD_AUTO_DRY=1 /usr/local/sbin/vtuberdex-autodeploy   # solo informa
```

Estado en `~/.local/share/vtuberdex-auto/` (`*.desplegado`, `*.fallido`, `java.pendiente`). Borrar `web.fallido` y
`web.desplegado` reinicia el punto de partida / reintenta. Tras actualizar el script hay que volver a copiarlo.
