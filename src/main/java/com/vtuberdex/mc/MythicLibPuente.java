package com.vtuberdex.mc;

import org.bukkit.entity.Player;

import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Puente con MythicLib: en vez de llevar dos contadores de maná, VTuberDex le dice a MythicLib cuál es el maná MÁXIMO de
 * cada ficha y deja que él lo guarde y lo gaste. Así los ítems de MMOItems con requisitos o costes de maná cobran del
 * mismo pozo que los hechizos ({@link Hechizos}), que es lo que se buscaba al unir los dos sistemas.
 *
 * CÓMO SE HABLA CON ÉL
 * --------------------
 * Por consola, con las plantillas de {@code config.yml} ({@code mythiclib.comando-add} y {@code comando-quitar}): no se
 * añade ninguna dependencia al build ni se adivina su API de Java, y si MythicLib cambia de sintaxis se corrige en la
 * config sin recompilar el plugin. Antes de cada empujón se quita el modificador anterior (misma {@code clave}) para que
 * no se acumulen los valores pasada tras pasada.
 *
 * QUÉ SE EMPUJA
 * -------------
 * Solo el maná máximo (stat {@code MAX_MANA}, calculado igual que los hechizos: {@code mp} de la ficha /
 * {@code hechizos.mana-divisor}, con su mínimo) y, si {@code regeneracion} no es 0, su regeneración. Nada más: la vida y
 * los demás atributos ya van por {@link FichaService} con modificadores de verdad.
 *
 * CUÁNDO SE EMPUJA
 * ----------------
 * No hay repaso periódico: MythicLib solo recibe órdenes cuando pasa algo, que es lo que pidió el equipo (cada empujón son
 * dos comandos de consola por stat).
 * <ul>
 *   <li>Cuando se carga o se refresca la ficha de un jugador conectado ({@link #alActualizar}), y solo si el valor cambió
 *       respecto al último empujón. Un jugador quieto con la ficha igual no genera ni una orden.</li>
 *   <li>Cuando alguien vuelve a entrar: quien se desconectó queda en la <b>lista de pendientes</b> ({@link #alSalir}),
 *       porque su ficha puede haber cambiado en la web mientras no estaba. Al conectarse se le empuja otra vez aunque el
 *       valor parezca el mismo.</li>
 * </ul>
 * Lo que se pierde al no haber repaso: si MythicLib se recarga a mitad de sesión y olvida los modificadores, el jugador
 * afectado no los recupera hasta que vuelva a entrar o hasta que su ficha cambie.
 *
 * REQUISITOS EN EL SERVIDOR
 * -------------------------
 * En {@code plugins/MythicLib/config.yml} tiene que estar {@code mana-plugin: MYTHICLIB} (si no, MythicLib usa un módulo
 * de relleno que no guarda maná) y el servidor tiene que haberse reiniciado después: ese cambio no se aplica en caliente.
 */
final class MythicLibPuente {
    private final VtuberDexPlugin plugin;
    /** Para no llenar el registro: se avisa UNA vez de que falta la plantilla o de que MythicLib no reconoce la orden. */
    private boolean avisado;
    /** Lo último que se le dijo a MythicLib de cada jugador ({@code uuid|stat} → valor), para no repetirlo sin motivo. */
    private final Map<String, Double> empujados = new ConcurrentHashMap<>();
    /** Jugadores que se desconectaron: al volver se les empuja sí o sí, haya cambiado su ficha o no. */
    private final Set<UUID> pendientes = ConcurrentHashMap.newKeySet();

    MythicLibPuente(VtuberDexPlugin plugin) {
        this.plugin = plugin;
    }

    /** ¿Hay que empujar? Hace falta que la config lo pida y que MythicLib esté instalado y habilitado. */
    boolean activo() {
        return plugin.getConfig().getBoolean("mythiclib.activo", false)
                && plugin.getServer().getPluginManager().isPluginEnabled("MythicLib");
    }

    /**
     * Empuja AHORA la ficha de un jugador si hace falta: al cargarla (primera vez de la sesión, con el estado que tenga en
     * la web) y cada vez que la web devuelve la ficha con algo distinto. Si el valor no cambió, no se lanza ninguna orden.
     */
    void alActualizar(Player jugador) {
        if (!activo() || jugador == null || plugin.fichas() == null || plugin.hechizos() == null) {
            return;
        }
        if (plugin.fichas().de(jugador.getUniqueId()) == null) {
            return; // en la sala de espera no hay ficha que empujar
        }
        UUID id = jugador.getUniqueId();
        // Vuelve de estar desconectado: su ficha pudo cambiar sin él, así que se le empuja aunque el valor coincida.
        boolean pendiente = pendientes.contains(id);
        empujar(jugador, plugin.getConfig().getString("mythiclib.stat-max", "MAX_MANA"),
                plugin.hechizos().manaMaximo(jugador), pendiente);
        double regeneracion = plugin.getConfig().getDouble("mythiclib.regeneracion", 0);
        if (regeneracion > 0) {
            empujar(jugador, plugin.getConfig().getString("mythiclib.stat-regeneracion", "MANA_REGENERATION"),
                    regeneracion, pendiente);
        }
        pendientes.remove(id);
    }

    /**
     * Un jugador se desconecta: queda en la lista de pendientes hasta que vuelva. No se toca la caché de lo empujado, así
     * que la próxima vez se sabe si su ficha cambió mientras estaba fuera… y se le empuja igual por estar pendiente.
     */
    void alSalir(UUID jugador) {
        if (jugador == null) {
            return;
        }
        pendientes.add(jugador);
    }

    /** ¿Está en la lista de pendientes? Sirve para las pruebas y para el registro. */
    boolean esPendiente(UUID jugador) {
        return jugador != null && pendientes.contains(jugador);
    }

    /** Cuántos quedan por aplicar: son los que se desconectaron y aún no han vuelto. */
    int pendientes() {
        return pendientes.size();
    }

    /**
     * ¿Hay que lanzar las órdenes? Sí si vuelve de estar pendiente (aunque el valor sea el mismo) o si el valor cambió
     * respecto al último empujón. Pura, para poder probarla sin servidor.
     */
    static boolean hayQueEmpujar(boolean pendiente, Double antes, double ahora) {
        if (pendiente || antes == null) {
            return true;
        }
        return Math.abs(antes - ahora) > 1e-6;
    }

    /** Quita el modificador anterior y pone el nuevo (misma clave: se reemplaza, no se suma)… si toca empujar. */
    private void empujar(Player jugador, String stat, double valor, boolean pendiente) {
        String clave = plugin.getConfig().getString("mythiclib.clave", "vtuberdex");
        String marca = jugador.getUniqueId() + "|" + stat;
        if (!hayQueEmpujar(pendiente, empujados.get(marca), valor)) {
            return;
        }
        ordenar(plugin.getConfig().getString("mythiclib.comando-quitar", ""), jugador.getName(), stat, valor, clave);
        ordenar(plugin.getConfig().getString("mythiclib.comando-add", ""), jugador.getName(), stat, valor, clave);
        empujados.put(marca, valor);
    }

    /** Lanza la orden como si la escribiera la consola: es la vía que MythicLib atiende sin dependencias de Java. */
    private void ordenar(String plantilla, String jugador, String stat, double valor, String clave) {
        String orden = comando(plantilla, jugador, stat, valor, clave);
        if (orden.isBlank()) {
            avisarUnaVez("Falta la plantilla del comando de MythicLib en config.yml (mythiclib.comando-add / comando-quitar).");
            return;
        }
        if (!plugin.getServer().dispatchCommand(plugin.getServer().getConsoleSender(), orden)) {
            avisarUnaVez("MythicLib no reconoció la orden «" + orden + "»: revisa mythiclib.comando-add / comando-quitar.");
        }
    }

    /** Un solo aviso en todo el arranque: si algo va mal se ve en el registro sin repetirse a cada rato. */
    private void avisarUnaVez(String texto) {
        if (avisado) {
            return;
        }
        avisado = true;
        plugin.getLogger().warning(texto);
    }

    /**
     * Rellena la plantilla con {@code {jugador}}, {@code {stat}}, {@code {valor}} y {@code {clave}}. Pura, para poder
     * probarla sin servidor. Una plantilla vacía o nula devuelve cadena vacía (el que llama lo interpreta como «no hay
     * orden que lanzar»).
     */
    static String comando(String plantilla, String jugador, String stat, double valor, String clave) {
        if (plantilla == null) {
            return "";
        }
        return plantilla
                .replace("{jugador}", jugador == null ? "" : jugador)
                .replace("{stat}", stat == null ? "" : stat)
                .replace("{valor}", numero(valor))
                .replace("{clave}", clave == null ? "" : clave)
                .trim();
    }

    /**
     * El valor como texto que MythicLib entiende: sin decimales cuando es entero ({@code 150}) y con dos cuando no
     * ({@code 148.50}), siempre con punto decimal (una coma rompería la orden).
     */
    static String numero(double valor) {
        long entero = Math.round(valor);
        if (Math.abs(valor - entero) < 1e-9) {
            return Long.toString(entero);
        }
        return String.format(Locale.ROOT, "%.2f", valor);
    }
}
