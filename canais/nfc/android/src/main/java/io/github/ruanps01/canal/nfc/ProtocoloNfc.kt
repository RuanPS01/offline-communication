package io.github.ruanps01.canal.nfc

/**
 * Troca por toque com APDUs (o mesmo protocolo usado pelo iPhone ao ler um
 * Android):
 *   SELECT AID F0534F42524556      seleciona a plataforma
 *   80 10 00 00 Lc [pacote]        o leitor entrega um pacote ao cartão
 *   80 20 00 00 00                 o leitor pede o próximo pacote do cartão
 * Respostas terminam em 90 00 (ok) ou 6A 82 (nada mais a entregar).
 */
object ProtocoloNfc {
    val AID: ByteArray = byteArrayOf(0xF0.toByte(), 0x53, 0x4F, 0x42, 0x52, 0x45, 0x56)
    val OK = byteArrayOf(0x90.toByte(), 0x00)
    val NADA = byteArrayOf(0x6A, 0x82.toByte())
    val DESCONHECIDO = byteArrayOf(0x6D, 0x00)
    const val INS_ENTREGAR = 0x10
    const val INS_PEDIR = 0x20

    fun selecionar(): ByteArray = byteArrayOf(0x00, 0xA4.toByte(), 0x04, 0x00, AID.size.toByte()) + AID + byteArrayOf(0x00)

    fun entregar(pacote: ByteArray): ByteArray = byteArrayOf(0x80.toByte(), INS_ENTREGAR.toByte(), 0, 0, pacote.size.toByte()) + pacote

    fun pedir(): ByteArray = byteArrayOf(0x80.toByte(), INS_PEDIR.toByte(), 0, 0, 0)

    fun ehSelecao(apdu: ByteArray): Boolean =
        apdu.size >= 5 + AID.size && apdu[1] == 0xA4.toByte() && apdu.copyOfRange(5, 5 + AID.size).contentEquals(AID)

    fun terminaOk(resposta: ByteArray): Boolean =
        resposta.size >= 2 && resposta[resposta.size - 2] == 0x90.toByte() && resposta[resposta.size - 1] == 0x00.toByte()
}

/** Ponte entre o serviço de cartão (criado pelo sistema) e o plugin. */
object PonteNfc {
    @Volatile var aoReceber: ((pacote: ByteArray, de: String) -> Unit)? = null
    @Volatile var aoVizinho: ((id: String, presente: Boolean) -> Unit)? = null
    @Volatile var presenca: ByteArray? = null
    private val saida = ArrayDeque<ByteArray>()

    @Synchronized fun enfileirar(pacote: ByteArray) {
        saida.addLast(pacote)
        while (saida.size > 20) saida.removeFirst()
    }

    /** Presença primeiro, depois os pacotes guardados (que continuam para o próximo toque). */
    @Synchronized fun todos(): List<ByteArray> = listOfNotNull(presenca) + saida.toList()

    fun proximo(indice: Int): ByteArray? = todos().getOrNull(indice)
}
