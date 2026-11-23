#!/usr/bin/env python3
# Copyright (c) 2026 VTuberDex. Todos los derechos reservados. Ver LICENSE.
"""
Puente de PTY para la terminal del panel de Minecraft (`minecraft-agente/agente.mjs`).

Node no trae pseudo-terminales sin un módulo nativo (node-pty), y un módulo nativo hay que
recompilarlo con cada Node. Python sí trae `pty` en la biblioteca estándar, así que el agente lanza
este puente y habla con él por stdin/stdout:

- stdin: tramas `tipo (1 byte) + largo (4 bytes, big-endian) + datos`.
    tipo 0 = bytes del teclado, se escriben tal cual en la PTY.
    tipo 1 = tamaño, 4 bytes: filas (uint16) y columnas (uint16).
- stdout: lo que la PTY escribe, sin tramas.

Uso: pty-puente.py FILAS COLUMNAS -- comando args...
Cuando el comando termina, el puente sale con su código. Si stdin se cierra (el agente murió o
cerró la sesión) se manda SIGHUP al grupo del hijo, como al cerrar una terminal de verdad.
"""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios


def poner_tamano(fd, filas, columnas):
    filas = max(2, min(500, filas))
    columnas = max(10, min(1000, columnas))
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", filas, columnas, 0, 0))


def main():
    args = sys.argv[1:]
    if len(args) < 4 or args[2] != "--":
        sys.stderr.write("uso: pty-puente.py FILAS COLUMNAS -- comando...\n")
        return 2
    filas, columnas, comando = int(args[0]), int(args[1]), args[3:]

    pid, maestro = pty.fork()
    if pid == 0:
        try:
            os.execvp(comando[0], comando)
        finally:
            os._exit(127)

    poner_tamano(maestro, filas, columnas)
    entrada = sys.stdin.fileno()
    salida = sys.stdout.fileno()
    pendiente = b""
    entrada_abierta = True

    def colgar():
        try:
            os.killpg(os.getpgid(pid), signal.SIGHUP)
        except OSError:
            pass

    while True:
        lectores = [maestro] + ([entrada] if entrada_abierta else [])
        try:
            listos, _, _ = select.select(lectores, [], [], 1.0)
        except InterruptedError:
            continue

        if maestro in listos:
            try:
                datos = os.read(maestro, 65536)
            except OSError as e:
                if e.errno != errno.EIO:
                    raise
                datos = b""
            if not datos:
                break  # el hijo cerró la terminal
            vista = memoryview(datos)
            while vista:
                escritos = os.write(salida, vista)
                vista = vista[escritos:]

        if entrada_abierta and entrada in listos:
            trozo = os.read(entrada, 65536)
            if not trozo:
                entrada_abierta = False
                colgar()
                continue
            pendiente += trozo
            while len(pendiente) >= 5:
                tipo, largo = pendiente[0], struct.unpack(">I", pendiente[1:5])[0]
                if len(pendiente) < 5 + largo:
                    break
                cuerpo, pendiente = pendiente[5 : 5 + largo], pendiente[5 + largo :]
                if tipo == 0:
                    vista = memoryview(cuerpo)
                    while vista:
                        escritos = os.write(maestro, vista)
                        vista = vista[escritos:]
                elif tipo == 1 and largo == 4:
                    f, c = struct.unpack(">HH", cuerpo)
                    poner_tamano(maestro, f, c)

    _, estado = os.waitpid(pid, 0)
    return os.waitstatus_to_exitcode(estado) if hasattr(os, "waitstatus_to_exitcode") else 0


if __name__ == "__main__":
    sys.exit(main())
