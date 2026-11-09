package io.github.ruanps01.canal.redelocal

import android.content.res.AssetManager
import fi.iki.elonen.NanoHTTPD
import fi.iki.elonen.NanoWSD
import org.json.JSONObject
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * Servidor HTTP + WebSocket do celular que "vira servidor". Serve a própria
 * PWA (copiada no APK em assets/public), responde /api/info e faz o papel de
 * hub entre os clientes em /ws. O próprio aparelho participa como o nó
 * "servidor": recebe tudo e pode mandar para todos.
 */
class ServidorLocal(
    porta: Int,
    private val nome: String,
    private val assets: AssetManager,
    private val aoReceber: (de: String, pacote: ByteArray) -> Unit,
    private val aoVizinho: (id: String, presente: Boolean) -> Unit,
) : NanoWSD(porta) {
    private val clientes = ConcurrentHashMap<String, Conexao>()
    private val proximoId = AtomicInteger(1)

    private val tipos = mapOf(
        "html" to "text/html; charset=utf-8",
        "js" to "text/javascript; charset=utf-8",
        "mjs" to "text/javascript; charset=utf-8",
        "css" to "text/css; charset=utf-8",
        "json" to "application/json; charset=utf-8",
        "webmanifest" to "application/manifest+json",
        "svg" to "image/svg+xml",
        "png" to "image/png",
        "wasm" to "application/wasm",
    )

    inner class Conexao(handshake: IHTTPSession) : WebSocket(handshake) {
        val id = "c${proximoId.getAndIncrement()}"

        override fun onOpen() {
            clientes[id] = this
            enviarTexto(JSONObject().put("tipo", "boas-vindas").put("id", id).put("nome", nome))
            // O próprio servidor é um vizinho para quem chega.
            enviarTexto(JSONObject().put("tipo", "vizinho").put("id", "servidor").put("presente", true))
            for ((outroId, outro) in clientes) {
                if (outroId == id) continue
                outro.enviarTexto(JSONObject().put("tipo", "vizinho").put("id", id).put("presente", true))
                enviarTexto(JSONObject().put("tipo", "vizinho").put("id", outroId).put("presente", true))
            }
            aoVizinho(id, true)
        }

        override fun onClose(code: WebSocketFrame.CloseCode?, reason: String?, initiatedByRemote: Boolean) {
            if (clientes.remove(id) != null) {
                for (outro in clientes.values) outro.enviarTexto(JSONObject().put("tipo", "vizinho").put("id", id).put("presente", false))
                aoVizinho(id, false)
            }
        }

        override fun onMessage(frame: WebSocketFrame) {
            if (frame.opCode != WebSocketFrame.OpCode.Binary) return
            val (destino, pacote) = Moldura.desemoldurar(frame.binaryPayload) ?: return
            val saida = Moldura.emoldurar(id, pacote)
            when {
                destino == "servidor" -> aoReceber(id, pacote)
                destino.isNotEmpty() -> clientes[destino]?.enviarBinario(saida)
                else -> {
                    for ((outroId, outro) in clientes) if (outroId != id) outro.enviarBinario(saida)
                    aoReceber(id, pacote)
                }
            }
        }

        override fun onPong(pong: WebSocketFrame?) {}

        override fun onException(exception: IOException?) {}

        fun enviarTexto(json: JSONObject) {
            runCatching { send(json.toString()) }
        }

        fun enviarBinario(dados: ByteArray) {
            runCatching { send(dados) }
        }
    }

    override fun openWebSocket(handshake: IHTTPSession): WebSocket = Conexao(handshake)

    override fun serveHttp(session: IHTTPSession): Response {
        val caminho = session.uri ?: "/"
        if (caminho == Moldura.CAMINHO_INFO) {
            val info = JSONObject()
                .put("servico", Moldura.NOME_SERVICO)
                .put("versao", 1)
                .put("nome", nome)
                .put("wsCaminho", Moldura.CAMINHO_WS)
                .put("clientes", clientes.size)
            return newFixedLengthResponse(Response.Status.OK, "application/json; charset=utf-8", info.toString()).also {
                it.addHeader("Access-Control-Allow-Origin", "*")
                it.addHeader("Cache-Control", "no-store")
            }
        }
        val limpo = caminho.trimStart('/').replace("..", "")
        val arquivo = if (limpo.isEmpty() || !existe(limpo)) "index.html" else limpo
        return try {
            val entrada = assets.open("public/$arquivo")
            val tipo = tipos[arquivo.substringAfterLast('.', "")] ?: "application/octet-stream"
            newChunkedResponse(Response.Status.OK, tipo, entrada).also { it.addHeader("Cache-Control", "no-store") }
        } catch (e: IOException) {
            newFixedLengthResponse(Response.Status.NOT_FOUND, NanoHTTPD.MIME_PLAINTEXT, "não encontrado")
        }
    }

    private fun existe(arquivo: String): Boolean = runCatching { assets.open("public/$arquivo").close() }.isSuccess

    /** Pacote vindo do núcleo deste aparelho: vai para um cliente ou para todos. */
    fun enviar(pacote: ByteArray, destino: String?) {
        val saida = Moldura.emoldurar("servidor", pacote)
        if (destino != null) clientes[destino]?.enviarBinario(saida) else clientes.values.forEach { it.enviarBinario(saida) }
    }

    fun quantidadeClientes(): Int = clientes.size
}
