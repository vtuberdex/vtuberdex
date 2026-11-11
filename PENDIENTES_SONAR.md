# Pendientes de SonarQube

Estado del análisis de la **rama principal** de los dos proyectos, a 2026-11-11.
Este archivo es un inventario para planificar las tandas de corrección; no cambia nada por sí solo.

Cómo se corrige: una rama `miyuki/sonar-<tema>` por bloque, PR con la lista de reglas y
`archivo:línea` corregidos, CI en verde y mezcla. Sin `NOSONAR` y sin tocar
`sonar-project.properties` salvo que el equipo lo pida. Un aviso corregido desaparece
del panel **después** de mezclar y del siguiente análisis, no en el PR.

Límite por tanda: una regla o una carpeta, ~20 avisos por PR como mucho, sin cambiar
el comportamiento.

---

## Web (`vtuberdex`)

- Quality gate: **OK**
- Bugs: **0** · Vulnerabilidades: **0** · Hotspots: **0**
- Code smells: **5529** · Duplicación: 1.4 % · Cobertura: 63.8 % · Deuda: ~473 h
- Último análisis: 2026-11-11 13:34 (-03:00)

Nada urgente: no hay ni un bug ni una vulnerabilidad abiertos. Lo que queda es limpieza.

| Regla | Qué pide | Avisos | Severidad | Carpetas con más avisos |
| --- | --- | --- | --- | --- |
| S121 (js + ts) | Llaves `{ }` en todo `if`/`for` | 1509 (985 js + 524 ts) | HIGH | `lib`, `server/src`, `scripts`, `scraper/src` |
| S1774 (js + ts) | No usar el operador ternario como sentencia | 1161 (724 ts + 437 js) | MEDIUM | `components/admin`, `lib`, `components` |
| S109 (js + ts) | Números mágicos a constantes con nombre | 1067 (685 js + 382 ts) | (según fichero) | `lib`, `server/src` |
| S1451 (js + ts) | Cabecera de licencia del archivo | 332 (152 js + 180 ts) | BLOCKER | `components`, `lib`, `server/src`, `scripts` |
| S106 | Quitar `console.log` de producción | 348 | (según fichero) | `server/src`, `lib`, `scripts` |

Notas:

- **S1451 (332 avisos)** es la tanda más grande y la más mecánica: un bloque de
  cabecera igual en cada archivo. Afecta a ~330 archivos, así que conviene un PR
  único de solo cabeceras (no cambia el comportamiento) y avisar antes de lanzarlo.
- **S121** es también mecánico pero toca lógica: mejor por carpetas, empezando por
  `lib` (377 avisos) y `server/src` (300).
- Hay un **BLOCKER real** ya visto en la web y no es de cabecera: `VtdCommand` del
  plugin siempre devuelve lo mismo (`java:S3516`, ver sección del plugin).
- Semgrep y CodeQL siguen aportando sus hallazgos a Sonar; no se gestionan aquí.

---

## Plugin de Minecraft (`vtuberdex-minecraft`)

- Quality gate: **ERROR** — falla por `reliability_rating = 3` (el límite es 1)
- Bugs: **43** · Vulnerabilidades: **0**
- Code smells: **1253** · Duplicación: 0.5 % · Cobertura: 36.7 % · Deuda: ~119 h
- Último análisis: 2026-11-11 11:39 (-03:00)

### Bugs que quedan (43)

| Regla | Qué pasa | Avisos | Estado |
| --- | --- | --- | --- |
| S2164 | Cálculo con enteros donde hacen falta decimales | 36 | Corregido en el **PR #60** (esperando mezclar) |
| S2184 | Sumar/restar sin decimal y perder precisión | 4 | Pendiente — `Totems.java:199`, `CartelDiosa.java:252` y 2 más |
| S2259 | Posible caída por valor nulo | 3 | Pendiente — `Bruja.java:157`, `:169`, `:228` |

Los 15 avisos de coordenada vacía (S2259/S2637) del cuerpo de El Glitch ya se
corrigieron en el **PR #59**, mezclado en `main`. Tras el siguiente análisis
deberían desaparecer del panel.

Con el PR #60 mezclado, el plugin bajaría a **7 bugs** (4 + 3). Con esos 7
corregidos, `reliability_rating` debería pasar a 1 y el gate ponerse en verde,
salvo que el análisis saque algo nuevo.

### Code smells más pesados (1253)

| Regla | Qué pide | Avisos |
| --- | --- | --- |
| S122 | Importaciones ordenadas / sin redundancias | 349 |
| S103 | Líneas no más largas de 120 caracteres | 258 |
| S1774 | No usar el ternario como sentencia | 163 |
| S121 | Llaves en todo `if`/`for` | 59 |
| S6885 | Quitar código que no se usa | 41 |
| S1135 | Resolver o justificar los TODO | 27 |
| S864 | Ternarios anidados que no se entienden | 24 |
| S3776 | Bajar la complejidad cognitiva (máx. 15) | 24 |

BLOCKER sueltos (4): `VtdCommand.java:30` (S3516, el método siempre devuelve lo
mismo) y tres de nombres confusos por choque mayúsculas/minúsculas (S1845) en
`Lobby.java` (campo y método `mundo` vs `MUNDO`) y `GlitchCuerpo.java` (`nucleo` vs `NUCLEO`).

También hay métodos grandes en `Coliseo`, `Santuario`, `Glitch`, `Estadisticas`,
`Lobby` y `Panel` (S134 anidamiento y S1541 complejidad): son los cambios más
delicados porque tocan lógica de juego.

---

## Orden sugerido de tandas

1. **Plugin, 7 bugs restantes** (S2184 + S2259): desbloquea el gate del plugin.
2. **Plugin, BLOCKER sueltos** (S3516 + S1845): 4 avisos, riesgo bajo.
3. **Plugin, S122 + S103** (607 avisos, mecánicos): por carpetas, sin tocar lógica.
4. **Web, S1451** (332 cabeceras): PR único de solo cabeceras, con aviso previo.
5. **Web, S121 por carpetas**: `lib`, luego `server/src`.
6. **Web, S1774 y S109**: al final, son los más numerosos y los menos urgentes.

## Pendiente de decisión del equipo

- S1451 en la web: ~330 archivos de golpe. ¿Se hace en un PR único o se deja?
- S109 y S1774: son ~2200 avisos entre los dos. ¿Se corrigen o se aceptan como estilo?
- Cobertura del plugin (36.7 %): subirla ayudaría más que perseguir avisos sueltos.
