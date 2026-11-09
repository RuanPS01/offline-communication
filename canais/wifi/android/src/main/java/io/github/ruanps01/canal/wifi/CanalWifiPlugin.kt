package io.github.ruanps01.canal.wifi

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
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.AdvertisingOptions
import com.google.android.gms.nearby.connection.ConnectionInfo
import com.google.android.gms.nearby.connection.ConnectionLifecycleCallback
import com.google.android.gms.nearby.connection.ConnectionResolution
import com.google.android.gms.nearby.connection.ConnectionsClient
import com.google.android.gms.nearby.connection.ConnectionsStatusCodes
import com.google.android.gms.nearby.connection.DiscoveredEndpointInfo
import com.google.android.gms.nearby.connection.DiscoveryOptions
import com.google.android.gms.nearby.connection.EndpointDiscoveryCallback
import com.google.android.gms.nearby.connection.Payload
import com.google.android.gms.nearby.connection.PayloadCallback
import com.google.android.gms.nearby.connection.PayloadTransferUpdate
import com.google.android.gms.nearby.connection.Strategy

/**
 * Canal Wi-Fi P2P no Android com Nearby Connections (P2P_CLUSTER): descobre
 * por BLE e sobe a conexão para Wi-Fi direto sozinho. Cada um anuncia o
 * próprio id de nó como nome, o que já identifica o vizinho para o núcleo.
 */
@CapacitorPlugin(
    name = "CanalWifi",
    permissions = [
        Permission(
            alias = "novo",
            strings = [
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.NEARBY_WIFI_DEVICES,
            ],
        ),
        Permission(
            alias = "medio",
            strings = [
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_ADVERTISE,
                Manifest.permission.BLUETOOTH_CONNECT,
                Manifest.permission.ACCESS_FINE_LOCATION,
            ],
        ),
        Permission(alias = "antigo", strings = [Manifest.permission.ACCESS_FINE_LOCATION]),
    ],
)
class CanalWifiPlugin : Plugin() {
    companion object {
        const val ID_SERVICO = "sobrevivencia.malha"
    }

    private var cliente: ConnectionsClient? = null
    private var meuNome = ""
    private val conectados = LinkedHashSet<String>()
    private val nomes = HashMap<String, String>()

    private val alias: String
        get() = when {
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU -> "novo"
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S -> "medio"
            else -> "antigo"
        }

    @PluginMethod
    fun disponivel(call: PluginCall) {
        val ok = GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS
        val r = JSObject()
        r.put("disponivel", ok)
        if (!ok) r.put("motivo", "precisa do Google Play Services")
        call.resolve(r)
    }

    @PluginMethod
    fun iniciar(call: PluginCall) {
        meuNome = call.getString("idNo") ?: "sem-id"
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "aposPermissao")
            return
        }
        ligar(call)
    }

    @PermissionCallback
    private fun aposPermissao(call: PluginCall) {
        if (getPermissionState(alias) == PermissionState.GRANTED) ligar(call) else call.reject("permissão negada")
    }

    private fun ligar(call: PluginCall) {
        val c = Nearby.getConnectionsClient(context)
        cliente = c
        val estrategia = Strategy.P2P_CLUSTER
        c.startAdvertising(meuNome, ID_SERVICO, ciclo, AdvertisingOptions.Builder().setStrategy(estrategia).build())
            .addOnFailureListener { /* já anunciando ou sem rádio: a descoberta segue */ }
        c.startDiscovery(ID_SERVICO, descoberta, DiscoveryOptions.Builder().setStrategy(estrategia).build())
            .addOnSuccessListener { call.resolve() }
            .addOnFailureListener { e ->
                if ((e as? com.google.android.gms.common.api.ApiException)?.statusCode == ConnectionsStatusCodes.STATUS_ALREADY_DISCOVERING) {
                    call.resolve()
                } else {
                    call.reject("Nearby: ${e.message}")
                }
            }
    }

    private val descoberta = object : EndpointDiscoveryCallback() {
        override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
            nomes[endpointId] = info.endpointName
            // Só um dos dois pede a conexão: o de nome menor.
            if (meuNome < info.endpointName && endpointId !in conectados) {
                cliente?.requestConnection(meuNome, endpointId, ciclo)
            }
        }

        override fun onEndpointLost(endpointId: String) {}
    }

    private val ciclo = object : ConnectionLifecycleCallback() {
        override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
            nomes[endpointId] = info.endpointName
            // O conteúdo sensível já vai cifrado pelo núcleo; aceita todos.
            cliente?.acceptConnection(endpointId, recebimento)
        }

        override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
            if (resolution.status.statusCode == ConnectionsStatusCodes.STATUS_OK) {
                conectados.add(endpointId)
                avisarVizinho(endpointId, true)
            }
        }

        override fun onDisconnected(endpointId: String) {
            conectados.remove(endpointId)
            avisarVizinho(endpointId, false)
        }
    }

    private val recebimento = object : PayloadCallback() {
        override fun onPayloadReceived(endpointId: String, payload: Payload) {
            val bytes = payload.asBytes() ?: return
            val e = JSObject()
            e.put("dados", Base64.encodeToString(bytes, Base64.NO_WRAP))
            e.put("de", endpointId)
            notifyListeners("pacote", e)
        }

        override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {}
    }

    private fun avisarVizinho(endpointId: String, presente: Boolean) {
        val e = JSObject()
        e.put("idLocal", endpointId)
        e.put("presente", presente)
        nomes[endpointId]?.let { if (it.length == 12) e.put("idNo", it) }
        notifyListeners("vizinho", e)
    }

    @PluginMethod
    fun anunciar(call: PluginCall) = enviar(call)

    @PluginMethod
    fun enviar(call: PluginCall) {
        val dados = call.getString("dados") ?: return call.reject("faltou dados")
        val destino = call.getString("destino")
        val alvos = if (destino != null) listOf(destino).filter { it in conectados } else conectados.toList()
        if (alvos.isNotEmpty()) cliente?.sendPayload(alvos, Payload.fromBytes(Base64.decode(dados, Base64.DEFAULT)))
        call.resolve()
    }

    @PluginMethod
    fun parar(call: PluginCall) {
        cliente?.apply {
            stopAdvertising()
            stopDiscovery()
            stopAllEndpoints()
        }
        conectados.clear()
        call.resolve()
    }
}
