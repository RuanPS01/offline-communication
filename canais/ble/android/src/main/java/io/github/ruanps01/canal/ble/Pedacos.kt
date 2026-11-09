package io.github.ruanps01.canal.ble

import java.io.ByteArrayOutputStream

/**
 * Quebra pacotes em pedaços que cabem numa escrita BLE e remonta do outro
 * lado. Cabeçalho de 1 byte: bit 7 = primeiro, bit 6 = último, bits 0 a 5 =
 * número do pacote (para não misturar pedaços de pacotes diferentes).
 */
object Pedacos {
    const val PRIMEIRO = 0x80
    const val ULTIMO = 0x40
    const val TAMANHO_MAXIMO_PACOTE = 64 * 1024

    fun quebrar(pacote: ByteArray, tamanhoPedaco: Int, numero: Int): List<ByteArray> {
        val util = (tamanhoPedaco - 1).coerceAtLeast(1)
        val total = (pacote.size + util - 1) / util
        return (0 until maxOf(total, 1)).map { i ->
            val inicio = i * util
            val fim = minOf(pacote.size, inicio + util)
            var cabecalho = numero and 0x3f
            if (i == 0) cabecalho = cabecalho or PRIMEIRO
            if (i == total - 1 || total == 0) cabecalho = cabecalho or ULTIMO
            byteArrayOf(cabecalho.toByte()) + pacote.copyOfRange(inicio, fim)
        }
    }
}

/** Remonta os pacotes de um vizinho. */
class Remontagem {
    private var atual: ByteArrayOutputStream? = null
    private var numero = -1

    /** Devolve o pacote inteiro quando chega o último pedaço. */
    fun receber(pedaco: ByteArray): ByteArray? {
        if (pedaco.isEmpty()) return null
        val cabecalho = pedaco[0].toInt() and 0xff
        val n = cabecalho and 0x3f
        if (cabecalho and Pedacos.PRIMEIRO != 0) {
            atual = ByteArrayOutputStream()
            numero = n
        } else if (n != numero) {
            atual = null
            return null
        }
        val buffer = atual ?: return null
        buffer.write(pedaco, 1, pedaco.size - 1)
        if (buffer.size() > Pedacos.TAMANHO_MAXIMO_PACOTE) {
            atual = null
            return null
        }
        if (cabecalho and Pedacos.ULTIMO != 0) {
            atual = null
            return buffer.toByteArray()
        }
        return null
    }
}
