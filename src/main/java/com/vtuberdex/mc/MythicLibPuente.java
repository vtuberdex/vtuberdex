package com.vtuberdex.mc;

import org.bukkit.entity.Player;

import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

/**
 * Puente de maná con MythicLib: le dice a MythicLib cuál es el maná máximo de cada jugador según su ficha, para que los
 * ítems de MMOItems (requisitos y costes de maná) gasten de ESE maná y no de un contador aparte.
 *
 * POR QUÉ POR CONSOLA Y NO CON SU API
 * -----------------------------------
 * MythicLib no publica sus datos de maná por PlaceholderAPI más que para leer, y desde aquí no se pueden añadir
 * dependencias al build ni se abren jars ajenos, así que se usa lo que el propio plugin ofrece: los comandos
 * {@code /ml stat clear} y {@code /ml stat add <jugador> <stat> <valor> 0 <clave>}, que sí cambian los stats de un
 * jugador en caliente y sin reiniciar nada. El maná máximo es el mismo número que usan los hechizos
 * ({@link Hechizos#manaMaximo}), así que la web sigue siendo la fuente de la verdad.
 *
 * REQUISITO EN MYTHICLIB
 * ----------------------
 * En {@code plugins/MythicLib/config.yml} tiene que estar {@code mana-plugin: MYTHICLIB}; sin eso MythicLib se queda en
 * su módulo de relleno («DummyModule»), que no guarda maná de verdad, y los stats no sirven de nada.
 *
 * Si MythicLib no está instalado, está apagado o el empujón falla, aquí no se rompe nada: los hechizos siguen con su
 * maná de siempre.
 */
final class MythicLibPuente {
    private final VtuberDexPlugin plugin;

    MythicLibPuente(VtuberDexPlugin plugin) {
        this.plugin = plugin;
    }

    /** ¿Hay a quién empujar? (config activada y MythicLib cargado). */
    boolean activo() {
        if (!plugin.getConfig().getBoolean("mythiclib.activo", true)) return false;
        var mythic = plugin.getServer().getPluginManager().getPlugin("MythicLib");
        return mythic != null && mythic.isEnabled();
    }

    /**
     * Comandos que dejan el maná de un jugador como el de su ficha. Es una función pura (no toca el servidor) para poder
     * probarla sin levantar nada.
     *
     * Se limpia la clave antes de añadir: {@code /ml stat add} ACUMULA modificadores, así que sin limpiar el maná máximo
     * subiría en cada empujón. Con {@code maximo <= 0} no se manda nada: mejor no tocar nada que dejar a alguien sin maná.
     */
    static List<String> comandos(String jugador, String clave, double maximo, double regeneracion, String statMax, String statRegen) {
        List<String> salida = new ArrayList<>();
        if (jugador == null || jugador.isBlank() || clave == null || clave.isBlank()) return salida;
        if (maximo <= 0) return salida;
        salida.add("ml stat clear " + jugador + " " + clave);
        salida.add("ml stat add " + jugador + " " + statMax + " " + numero(maximo) + " 0 " + clave);
        if (regeneracion > 0) {
            salida.add("ml stat add " + jugador + " " + statRegen + " " + numero(regeneracion) + " 0 " + clave + "-regen");
        }
        return salida;
    }

    /** Números sin decimales de adorno (150, no 150.00) y con punto, que es lo que espera el comando. */
    static String numero(double valor) {
        if (valor == Math.rint(valor) && Math.abs(valor) < 1e15) return Long.toString((long) valor);
        return String.format(Locale.ROOT, "%.2f", valor);
    }

    /** Deja el maná máximo del jugador (y su regeneración) como marcan su ficha y la config. */
    void empujar(Player jugador) {
        if (!activo() || jugador == null || !jugador.isOnline() || !plugin.tieneFicha(jugador)) return;
        double maximo;
        try {
            maximo = plugin.hechizos().manaMaximo(jugador);
        } catch (RuntimeException e) {
            plugin.getLogger().warning("No se pudo calcular el maná de la ficha de " + jugador.getName() + ": " + e.getMessage());
            return;
        }
        String clave = plugin.getConfig().getString("mythiclib.clave", "vtuberdex");
        List<String> comandos = comandos(jugador.getName(), clave, maximo,
                plugin.getConfig().getDouble("mythiclib.regeneracion", 5),
                plugin.getConfig().getString("mythiclib.stat-max", "MAX_MANA"),
                plugin.getConfig().getString("mythiclib.stat-regeneracion", "MANA_REGENERATION"));
        enviar(comandos);
    }

    /** Al salir se le quita el modificador: los stats no se guardan con el jugador y no queremos basura acumulada. */
    void quitar(Player jugador) {
        if (jugador == null || !activo()) return;
        String clave = plugin.getConfig().getString("mythiclib.clave", "vtuberdex");
        enviar(List.of("ml stat clear " + jugador.getName() + " " + clave));
    }

    private void enviar(List<String> comandos) {
        var consola = plugin.getServer().getConsoleSender();
        for (String comando : comandos) {
            try {
                if (!plugin.getServer().dispatchCommand(consola, comando)) {
                    plugin.getLogger().warning("MythicLib no aceptó «" + comando + "»; el puente de maná queda inactivo hasta el próximo intento.");
                }
            } catch (RuntimeException e) {
                plugin.getLogger().warning("Fallo al hablar con MythicLib («" + comando + "»): " + e.getMessage());
            }
        }
    }
}
