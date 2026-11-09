package io.github.ruanps01.canal.redelocal

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
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
import java.net.Inet4Address
import java.net.NetworkInterface

/**
 * Canal de rede local no Android: vira servidor (HTTP + WebSocket +
 * anúncio mDNS "_sobrevivencia._tcp", com hotspot local opcional) ou entra
 * na rede de outro servidor achado por mDNS.
 */
@CapacitorPlugin(
    name = "RedeLocal",
    permissions = [
        Permission(alias = "hotspotNovo", strings = [Manifest.permission.NEARBY_WIFI_DEVICES]),
        Permission(alias = "hotspotAntigo", strings = [Manifest.permission.ACCESS_FINE_LOCATION]),
    ],
)
class RedeLocalPlugin : Plugin() {
    private var servidor: ServidorLocal? = null
    private var cliente: ClienteLocal? = null
    private var nsd: NsdManager? = null
    private var registro: NsdManager.RegistrationListener? = null
    private var descoberta: NsdManager.DiscoveryListener? = null
    private var hotspot: WifiManager.LocalOnlyHotspotReservation? = null
    private var travaMulticast: WifiManager.MulticastLock? = null

    override fun load() {
        nsd = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    }

    private fun emitirPacote(de: String, pacote: ByteArray) {
        val e = JSObject()
        e.put("dados", Base64.encodeToString(pacote, Base64.NO_WRAP))
        e.put("de", de)
        notifyListeners("pacote", e)
    }

    private fun emitirVizinho(id: String, presente: Boolean) {
        val e = JSObject()
        e.put("idLocal", id)
        e.put("presente", presente)
        notifyListeners("vizinho", e)
    }

    @PluginMethod
    fun disponivel(call: PluginCall) {
        call.resolve(JSObject().put("disponivel", true))
    }

    /** Liga o canal; a conexão de fato vem de iniciarServidor ou conectar. */
    @PluginMethod
    fun iniciar(call: PluginCall) = call.resolve()

    @PluginMethod
    fun anunciar(call: PluginCall) = enviar(call)

    @PluginMethod
    fun enviar(call: PluginCall) {
        val dados = Base64.decode(call.getString("dados") ?: return call.reject("faltou dados"), Base64.DEFAULT)
        val destino = call.getString("destino")
        servidor?.enviar(dados, destino)
        cliente?.enviar(dados, destino)
        call.resolve()
    }

    @PluginMethod
    fun parar(call: PluginCall) {
        pararTudo()
        call.resolve()
    }

    @PluginMethod
    fun iniciarServidor(call: PluginCall) {
        val porta = call.getInt("porta") ?: Moldura.PORTA_PADRAO
        val nome = call.getString("nome") ?: "Ponto de encontro"
        try {
            cliente?.desconectar()
            cliente = null
            servidor?.stop()
            val s = ServidorLocal(porta, nome, context.assets, ::emitirPacote, ::emitirVizinho)
            s.start(0, true)
            servidor = s
            anunciarMdns(nome, porta)
            val enderecos = enderecosLocais().map { "http://$it:$porta/" }
            val r = JSObject()
            r.put("porta", porta)
            r.put("enderecos", com.getcapacitor.JSArray(enderecos))
            call.resolve(r)
        } catch (e: Exception) {
            call.reject("não deu para abrir a porta $porta: ${e.message}")
        }
    }

    @PluginMethod
    fun pararServidor(call: PluginCall) {
        pararServidorInterno()
        call.resolve()
    }

    private fun pararServidorInterno() {
        registro?.let { runCatching { nsd?.unregisterService(it) } }
        registro = null
        servidor?.stop()
        servidor = null
    }

    private fun anunciarMdns(nome: String, porta: Int) {
        val info = NsdServiceInfo().apply {
            serviceName = nome
            serviceType = Moldura.SERVICO_NSD
            port = porta
        }
        val r = object : NsdManager.RegistrationListener {
            override fun onServiceRegistered(info: NsdServiceInfo) {}
            override fun onRegistrationFailed(info: NsdServiceInfo, erro: Int) {}
            override fun onServiceUnregistered(info: NsdServiceInfo) {}
            override fun onUnregistrationFailed(info: NsdServiceInfo, erro: Int) {}
        }
        registro = r
        nsd?.registerService(info, NsdManager.PROTOCOL_DNS_SD, r)
    }

    @PluginMethod
    fun descobrir(call: PluginCall) {
        pararDescobertaInterna()
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        travaMulticast = wifi.createMulticastLock("sobrevivencia-mdns").apply { setReferenceCounted(false); acquire() }
        val d = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(tipo: String) {}
            override fun onDiscoveryStopped(tipo: String) {}
            override fun onStartDiscoveryFailed(tipo: String, erro: Int) {}
            override fun onStopDiscoveryFailed(tipo: String, erro: Int) {}
            override fun onServiceLost(info: NsdServiceInfo) {}

            override fun onServiceFound(info: NsdServiceInfo) {
                @Suppress("DEPRECATION")
                nsd?.resolveService(info, object : NsdManager.ResolveListener {
                    override fun onResolveFailed(info: NsdServiceInfo, erro: Int) {}

                    override fun onServiceResolved(info: NsdServiceInfo) {
                        @Suppress("DEPRECATION")
                        val host = info.host?.hostAddress ?: return
                        val e = JSObject()
                        e.put("nome", info.serviceName)
                        e.put("host", host)
                        e.put("porta", info.port)
                        notifyListeners("servidor", e)
                    }
                })
            }
        }
        descoberta = d
        nsd?.discoverServices(Moldura.SERVICO_NSD, NsdManager.PROTOCOL_DNS_SD, d)
        call.resolve()
    }

    @PluginMethod
    fun pararDescoberta(call: PluginCall) {
        pararDescobertaInterna()
        call.resolve()
    }

    private fun pararDescobertaInterna() {
        descoberta?.let { runCatching { nsd?.stopServiceDiscovery(it) } }
        descoberta = null
        travaMulticast?.release()
        travaMulticast = null
    }

    @PluginMethod
    fun conectar(call: PluginCall) {
        val url = call.getString("url") ?: return call.reject("faltou url")
        pararServidorInterno()
        val c = cliente ?: ClienteLocal(::emitirPacote, ::emitirVizinho) { conectado ->
            notifyListeners("conexao", JSObject().put("conectado", conectado))
        }
        cliente = c
        c.conectar(url)
        call.resolve()
    }

    @PluginMethod
    fun desconectar(call: PluginCall) {
        cliente?.desconectar()
        cliente = null
        call.resolve()
    }

    private val aliasHotspot: String
        get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) "hotspotNovo" else "hotspotAntigo"

    @PluginMethod
    fun criarHotspot(call: PluginCall) {
        if (getPermissionState(aliasHotspot) != PermissionState.GRANTED) {
            requestPermissionForAlias(aliasHotspot, call, "aposPermissaoHotspot")
            return
        }
        abrirHotspot(call)
    }

    @PermissionCallback
    private fun aposPermissaoHotspot(call: PluginCall) {
        if (getPermissionState(aliasHotspot) == PermissionState.GRANTED) abrirHotspot(call) else call.reject("permissão negada")
    }

    /** Hotspot local (sem internet) do Android 8 em diante. */
    @SuppressLint("MissingPermission")
    private fun abrirHotspot(call: PluginCall) {
        val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
        hotspot?.close()
        try {
            wifi.startLocalOnlyHotspot(object : WifiManager.LocalOnlyHotspotCallback() {
                override fun onStarted(reserva: WifiManager.LocalOnlyHotspotReservation) {
                    hotspot = reserva
                    val r = JSObject()
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        val c = reserva.softApConfiguration
                        @Suppress("DEPRECATION")
                        r.put("ssid", c.ssid ?: "")
                        r.put("senha", c.passphrase ?: "")
                    } else {
                        @Suppress("DEPRECATION")
                        val c = reserva.wifiConfiguration
                        @Suppress("DEPRECATION")
                        r.put("ssid", c?.SSID ?: "")
                        @Suppress("DEPRECATION")
                        r.put("senha", c?.preSharedKey ?: "")
                    }
                    call.resolve(r)
                }

                override fun onFailed(motivo: Int) {
                    call.reject("o sistema recusou o hotspot (código $motivo); ligue o roteador do celular à mão")
                }
            }, null)
        } catch (e: Exception) {
            call.reject("hotspot indisponível: ${e.message}")
        }
    }

    @PluginMethod
    fun pararHotspot(call: PluginCall) {
        hotspot?.close()
        hotspot = null
        call.resolve()
    }

    private fun enderecosLocais(): List<String> =
        NetworkInterface.getNetworkInterfaces().toList()
            .filter { it.isUp && !it.isLoopback }
            .flatMap { it.inetAddresses.toList() }
            .filterIsInstance<Inet4Address>()
            .map { it.hostAddress ?: "" }
            .filter { it.isNotEmpty() }

    private fun pararTudo() {
        pararDescobertaInterna()
        pararServidorInterno()
        cliente?.desconectar()
        cliente = null
        hotspot?.close()
        hotspot = null
    }

    override fun handleOnDestroy() = pararTudo()
}
