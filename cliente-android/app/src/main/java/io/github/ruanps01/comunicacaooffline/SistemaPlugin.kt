package io.github.ruanps01.comunicacaooffline

import android.Manifest
import android.content.Intent
import android.os.Build
import androidx.core.content.ContextCompat
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/** Recursos do app que não são canais: o modo rádio ligado. */
@CapacitorPlugin(
    name = "Sistema",
    permissions = [Permission(alias = "notificacoes", strings = [Manifest.permission.POST_NOTIFICATIONS])],
)
class SistemaPlugin : Plugin() {
    @PluginMethod
    fun ligarModoRadio(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU && getPermissionState("notificacoes") != PermissionState.GRANTED) {
            requestPermissionForAlias("notificacoes", call, "aposPermissao")
            return
        }
        iniciarServico(call)
    }

    @PermissionCallback
    private fun aposPermissao(call: PluginCall) = iniciarServico(call)

    private fun iniciarServico(call: PluginCall) {
        val i = Intent(context, ServicoRadio::class.java)
            .putExtra(ServicoRadio.EXTRA_TITULO, call.getString("titulo"))
            .putExtra(ServicoRadio.EXTRA_TEXTO, call.getString("texto"))
        try {
            ContextCompat.startForegroundService(context, i)
            call.resolve()
        } catch (e: Exception) {
            call.reject("não deu para manter o rádio ligado: ${e.message}")
        }
    }

    @PluginMethod
    fun desligarModoRadio(call: PluginCall) {
        context.stopService(Intent(context, ServicoRadio::class.java))
        call.resolve()
    }
}
