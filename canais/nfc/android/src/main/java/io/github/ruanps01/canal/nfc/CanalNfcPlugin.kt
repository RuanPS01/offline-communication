package io.github.ruanps01.canal.nfc

import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * NFC por toque. Por padrão o celular é "cartão" (HCE): quem encostar em
 * modo leitor troca pacotes com ele. Ao tocar em "Ler" (método `ler`), ele
 * vira leitor por alguns segundos e faz a troca nos dois sentidos.
 */
@CapacitorPlugin(name = "CanalNfc")
class CanalNfcPlugin : Plugin() {
    private val adaptador: NfcAdapter? get() = NfcAdapter.getDefaultAdapter(context)

    private fun emitirPacote(pacote: ByteArray, de: String) {
        val e = JSObject()
        e.put("dados", Base64.encodeToString(pacote, Base64.NO_WRAP))
        e.put("de", de)
        notifyListeners("pacote", e)
    }

    private fun emitirVizinho(id: String, presente: Boolean) {
        notifyListeners("vizinho", JSObject().put("idLocal", "nfc:$id").put("presente", presente))
    }

    @PluginMethod
    fun disponivel(call: PluginCall) {
        val a = adaptador
        val r = JSObject()
        when {
            a == null -> r.put("disponivel", false).put("motivo", "aparelho sem NFC")
            !a.isEnabled -> r.put("disponivel", false).put("motivo", "ligue o NFC")
            else -> r.put("disponivel", true)
        }
        call.resolve(r)
    }

    @PluginMethod
    fun iniciar(call: PluginCall) {
        PonteNfc.aoReceber = { p, de -> emitirPacote(p, de) }
        PonteNfc.aoVizinho = { id, presente -> emitirVizinho(id, presente) }
        call.resolve()
    }

    @PluginMethod
    fun anunciar(call: PluginCall) {
        PonteNfc.presenca = Base64.decode(call.getString("dados") ?: return call.reject("faltou dados"), Base64.DEFAULT)
        call.resolve()
    }

    @PluginMethod
    fun enviar(call: PluginCall) {
        PonteNfc.enfileirar(Base64.decode(call.getString("dados") ?: return call.reject("faltou dados"), Base64.DEFAULT))
        call.resolve()
    }

    /** Vira leitor até encostar em outro celular (ou até `segundos`). */
    @PluginMethod
    fun ler(call: PluginCall) {
        val a = adaptador ?: return call.reject("aparelho sem NFC")
        val atividade = activity ?: return call.reject("sem tela ativa")
        val segundos = call.getInt("segundos") ?: 20
        call.setKeepAlive(true)
        val terminar = Runnable {
            runCatching { a.disableReaderMode(atividade) }
            if (call.isKeptAlive) {
                call.setKeepAlive(false)
                call.resolve(JSObject().put("trocou", false))
            }
        }
        val h = android.os.Handler(android.os.Looper.getMainLooper())
        h.postDelayed(terminar, segundos * 1000L)
        a.enableReaderMode(
            atividade,
            { tag: Tag ->
                val r = trocar(tag)
                h.removeCallbacks(terminar)
                h.post {
                    runCatching { a.disableReaderMode(atividade) }
                    call.setKeepAlive(false)
                    call.resolve(JSObject().put("trocou", r >= 0).put("recebidos", r))
                }
            },
            NfcAdapter.FLAG_READER_NFC_A or NfcAdapter.FLAG_READER_NFC_B or NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK,
            null,
        )
    }

    /** Leitor: entrega o que tem e pede tudo o que o outro tem. Devolve quantos pacotes recebeu. */
    private fun trocar(tag: Tag): Int {
        val iso = IsoDep.get(tag) ?: return -1
        val id = tag.id.joinToString("") { "%02x".format(it) }
        return try {
            iso.connect()
            iso.timeout = 3000
            if (!ProtocoloNfc.terminaOk(iso.transceive(ProtocoloNfc.selecionar()))) return -1
            emitirVizinho(id, true)
            for (p in PonteNfc.todos()) if (p.size <= 255) iso.transceive(ProtocoloNfc.entregar(p))
            var recebidos = 0
            while (recebidos < 40) {
                val r = iso.transceive(ProtocoloNfc.pedir())
                if (!ProtocoloNfc.terminaOk(r) || r.size <= 2) break
                emitirPacote(r.copyOfRange(0, r.size - 2), "nfc:$id")
                recebidos++
            }
            recebidos
        } catch (e: Exception) {
            -1
        } finally {
            runCatching { iso.close() }
            emitirVizinho(id, false)
        }
    }

    @PluginMethod
    fun parar(call: PluginCall) {
        PonteNfc.aoReceber = null
        PonteNfc.aoVizinho = null
        call.resolve()
    }
}
