package io.github.ruanps01.canal.redelocal

import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString
import okio.ByteString.Companion.toByteString
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Cliente nativo: entra numa rede local cujo servidor foi achado por mDNS. */
class ClienteLocal(
    private val aoReceber: (de: String, pacote: ByteArray) -> Unit,
    private val aoVizinho: (id: String, presente: Boolean) -> Unit,
    private val aoMudar: (conectado: Boolean) -> Unit,
) {
    private val http = OkHttpClient.Builder().pingInterval(20, TimeUnit.SECONDS).build()
    private var ws: WebSocket? = null
    private var meuId: String? = null
    private val conhecidos = HashSet<String>()

    fun conectar(url: String) {
        desconectar()
        ws = http.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) = aoMudar(true)

            override fun onMessage(webSocket: WebSocket, text: String) {
                val m = runCatching { JSONObject(text) }.getOrNull() ?: return
                when (m.optString("tipo")) {
                    "boas-vindas" -> meuId = m.optString("id")
                    "vizinho" -> {
                        val id = m.optString("id")
                        if (id == meuId) return
                        val presente = m.optBoolean("presente")
                        if (presente) conhecidos.add(id) else conhecidos.remove(id)
                        aoVizinho(id, presente)
                    }
                }
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                val (de, pacote) = Moldura.desemoldurar(bytes.toByteArray()) ?: return
                aoReceber(de, pacote)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) = encerrou()

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) = encerrou()
        })
    }

    private fun encerrou() {
        for (id in conhecidos) aoVizinho(id, false)
        conhecidos.clear()
        aoMudar(false)
    }

    fun enviar(pacote: ByteArray, destino: String?) {
        ws?.send(Moldura.emoldurar(destino ?: "", pacote).toByteString())
    }

    fun conectado(): Boolean = ws != null

    fun desconectar() {
        ws?.close(1000, "tchau")
        ws = null
    }
}
