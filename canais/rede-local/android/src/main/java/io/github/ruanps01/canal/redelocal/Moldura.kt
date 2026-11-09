package io.github.ruanps01.canal.redelocal

/**
 * Protocolo da rede local (o mesmo do servidor Node e do cliente web):
 *   cliente para servidor: [n][destino ASCII][pacote]  (destino vazio = todos)
 *   servidor para cliente: [n][origem ASCII][pacote]
 */
object Moldura {
    const val SERVICO_NSD = "_sobrevivencia._tcp"
    const val NOME_SERVICO = "sobrevivencia"
    const val CAMINHO_INFO = "/api/info"
    const val CAMINHO_WS = "/ws"
    const val PORTA_PADRAO = 8080

    fun emoldurar(id: String, pacote: ByteArray): ByteArray {
        val idBytes = id.toByteArray(Charsets.US_ASCII).let { if (it.size > 255) it.copyOf(255) else it }
        return byteArrayOf(idBytes.size.toByte()) + idBytes + pacote
    }

    fun desemoldurar(quadro: ByteArray): Pair<String, ByteArray>? {
        if (quadro.isEmpty()) return null
        val n = quadro[0].toInt() and 0xff
        if (quadro.size < 1 + n) return null
        return String(quadro, 1, n, Charsets.US_ASCII) to quadro.copyOfRange(1 + n, quadro.size)
    }
}
