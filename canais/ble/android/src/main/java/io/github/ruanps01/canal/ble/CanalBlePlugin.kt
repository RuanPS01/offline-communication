package io.github.ruanps01.canal.ble

import android.Manifest
import android.os.Build
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback

/**
 * Plugin do canal BLE. Cumpre do lado nativo o mesmo contrato do canal:
 * disponivel, iniciar, anunciar, enviar e parar; emite "pacote" e "vizinho".
 */
@CapacitorPlugin(
    name = "CanalBle",
    permissions = [
        Permission(
            alias = "bluetooth",
            strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_ADVERTISE, Manifest.permission.BLUETOOTH_CONNECT],
        ),
        Permission(alias = "localizacao", strings = [Manifest.permission.ACCESS_FINE_LOCATION]),
    ],
)
class CanalBlePlugin : Plugin() {
    private var malha: MalhaBle? = null

    private val aliasPermissao: String
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "bluetooth" else "localizacao"

    override fun load() {
        malha = MalhaBle(
            context,
            aoReceber = { dados, de, rssi ->
                val e = JSObject()
                e.put("dados", Base64.encodeToString(dados, Base64.NO_WRAP))
                e.put("de", de)
                if (rssi != null) e.put("rssi", rssi)
                notifyListeners("pacote", e)
            },
            aoVizinho = { endereco, presente, rssi ->
                val e = JSObject()
                e.put("idLocal", endereco)
                e.put("presente", presente)
                if (rssi != null) e.put("rssi", rssi)
                notifyListeners("vizinho", e)
            },
        )
    }

    @PluginMethod
    fun disponivel(call: PluginCall) {
        val m = malha
        val r = JSObject()
        when {
            m == null || !m.disponivel() -> {
                r.put("disponivel", false)
                r.put("motivo", "aparelho sem Bluetooth Low Energy")
            }
            !m.ativo() -> {
                r.put("disponivel", false)
                r.put("motivo", "ligue o Bluetooth")
            }
            else -> r.put("disponivel", true)
        }
        call.resolve(r)
    }

    @PluginMethod
    fun iniciar(call: PluginCall) {
        if (getPermissionState(aliasPermissao) != PermissionState.GRANTED) {
            requestPermissionForAlias(aliasPermissao, call, "aposPermissao")
            return
        }
        malha?.iniciar()
        call.resolve()
    }

    @PermissionCallback
    private fun aposPermissao(call: PluginCall) {
        if (getPermissionState(aliasPermissao) == PermissionState.GRANTED) {
            malha?.iniciar()
            call.resolve()
        } else {
            call.reject("permissão de Bluetooth negada")
        }
    }

    @PluginMethod
    fun anunciar(call: PluginCall) {
        val dados = call.getString("dados") ?: return call.reject("faltou dados")
        malha?.enviar(Base64.decode(dados, Base64.DEFAULT), null)
        call.resolve()
    }

    @PluginMethod
    fun enviar(call: PluginCall) {
        val dados = call.getString("dados") ?: return call.reject("faltou dados")
        malha?.enviar(Base64.decode(dados, Base64.DEFAULT), call.getString("destino"))
        call.resolve()
    }

    @PluginMethod
    fun parar(call: PluginCall) {
        malha?.parar()
        call.resolve()
    }

    override fun handleOnDestroy() {
        malha?.parar()
    }
}
