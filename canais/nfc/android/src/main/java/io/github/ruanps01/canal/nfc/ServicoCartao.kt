package io.github.ruanps01.canal.nfc

import android.nfc.cardemulation.HostApduService
import android.os.Bundle

/** O celular como cartão: responde ao outro, que está em modo leitor. */
class ServicoCartao : HostApduService() {
    private var pedidos = 0

    override fun processCommandApdu(apdu: ByteArray, extras: Bundle?): ByteArray {
        if (ProtocoloNfc.ehSelecao(apdu)) {
            pedidos = 0
            PonteNfc.aoVizinho?.invoke("toque", true)
            return ProtocoloNfc.OK
        }
        if (apdu.size < 4 || apdu[0] != 0x80.toByte()) return ProtocoloNfc.DESCONHECIDO
        return when (apdu[1].toInt() and 0xff) {
            ProtocoloNfc.INS_ENTREGAR -> {
                if (apdu.size > 5) {
                    val n = apdu[4].toInt() and 0xff
                    val pacote = apdu.copyOfRange(5, minOf(apdu.size, 5 + n))
                    PonteNfc.aoReceber?.invoke(pacote, "toque")
                }
                ProtocoloNfc.OK
            }
            ProtocoloNfc.INS_PEDIR -> {
                val p = PonteNfc.proximo(pedidos++)
                if (p != null) p + ProtocoloNfc.OK else ProtocoloNfc.NADA
            }
            else -> ProtocoloNfc.DESCONHECIDO
        }
    }

    override fun onDeactivated(reason: Int) {
        PonteNfc.aoVizinho?.invoke("toque", false)
    }
}
