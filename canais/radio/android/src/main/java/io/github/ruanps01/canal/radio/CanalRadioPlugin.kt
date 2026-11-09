package io.github.ruanps01.canal.radio

import android.Manifest
import android.annotation.SuppressLint
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.ParcelUuid
import android.util.Base64
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.UUID

/**
 * Ponte com o módulo LoRa externo pelo UART BLE da Nordic (NUS). Só move
 * bytes: o enquadramento KISS e os pacotes ficam no TypeScript.
 */
@SuppressLint("MissingPermission")
@CapacitorPlugin(
    name = "CanalRadio",
    permissions = [
        Permission(alias = "bluetooth", strings = [Manifest.permission.BLUETOOTH_SCAN, Manifest.permission.BLUETOOTH_CONNECT]),
        Permission(alias = "localizacao", strings = [Manifest.permission.ACCESS_FINE_LOCATION]),
    ],
)
class CanalRadioPlugin : Plugin() {
    companion object {
        val NUS: UUID = UUID.fromString("6e400001-b5a3-f393-e0a9-e50e24dcca9e")
        val RX: UUID = UUID.fromString("6e400002-b5a3-f393-e0a9-e50e24dcca9e")
        val TX: UUID = UUID.fromString("6e400003-b5a3-f393-e0a9-e50e24dcca9e")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }

    private val h = Handler(Looper.getMainLooper())
    private var gatt: BluetoothGatt? = null
    private var rx: BluetoothGattCharacteristic? = null
    private var mtu = 23
    private val fila = ArrayDeque<ByteArray>()
    private var ocupado = false
    private var chamadaConexao: PluginCall? = null
    private var nome = "módulo LoRa"

    private val gerenciador: BluetoothManager get() = context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager

    private val alias: String get() = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) "bluetooth" else "localizacao"

    @PluginMethod
    fun disponivel(call: PluginCall) {
        val a = gerenciador.adapter
        val r = JSObject()
        when {
            a == null -> r.put("disponivel", false).put("motivo", "aparelho sem Bluetooth")
            !a.isEnabled -> r.put("disponivel", false).put("motivo", "ligue o Bluetooth")
            else -> r.put("disponivel", true)
        }
        call.resolve(r)
    }

    @PluginMethod
    fun conectar(call: PluginCall) {
        if (getPermissionState(alias) != PermissionState.GRANTED) {
            requestPermissionForAlias(alias, call, "aposPermissao")
            return
        }
        procurar(call)
    }

    @PermissionCallback
    private fun aposPermissao(call: PluginCall) {
        if (getPermissionState(alias) == PermissionState.GRANTED) procurar(call) else call.reject("permissão de Bluetooth negada")
    }

    private fun procurar(call: PluginCall) {
        val scanner = gerenciador.adapter?.bluetoothLeScanner ?: return call.reject("Bluetooth desligado")
        chamadaConexao = call
        call.setKeepAlive(true)
        val retorno = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                scanner.stopScan(this)
                h.post { conectarDispositivo(result.device) }
            }
        }
        scanner.startScan(
            listOf(ScanFilter.Builder().setServiceUuid(ParcelUuid(NUS)).build()),
            ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
            retorno,
        )
        h.postDelayed({
            if (chamadaConexao === call && gatt == null) {
                runCatching { scanner.stopScan(retorno) }
                falharConexao("nenhum módulo LoRa encontrado por perto")
            }
        }, 15_000)
    }

    private fun falharConexao(motivo: String) {
        chamadaConexao?.let {
            it.setKeepAlive(false)
            it.reject(motivo)
        }
        chamadaConexao = null
    }

    private fun conectarDispositivo(d: BluetoothDevice) {
        nome = d.name ?: nome
        gatt = d.connectGatt(context, false, object : BluetoothGattCallback() {
            override fun onConnectionStateChange(g: BluetoothGatt, status: Int, newState: Int) {
                h.post {
                    if (newState == BluetoothProfile.STATE_CONNECTED) {
                        g.requestMtu(247)
                    } else {
                        runCatching { g.close() }
                        gatt = null
                        rx = null
                        falharConexao("conexão com o módulo caiu")
                    }
                }
            }

            override fun onMtuChanged(g: BluetoothGatt, novoMtu: Int, status: Int) {
                h.post {
                    if (status == BluetoothGatt.GATT_SUCCESS) mtu = novoMtu
                    g.discoverServices()
                }
            }

            @Suppress("DEPRECATION")
            override fun onServicesDiscovered(g: BluetoothGatt, status: Int) {
                h.post {
                    val s = g.getService(NUS) ?: return@post falharConexao("o aparelho não é um módulo da plataforma")
                    rx = s.getCharacteristic(RX)
                    val tx = s.getCharacteristic(TX)
                    g.setCharacteristicNotification(tx, true)
                    val d = tx.getDescriptor(CCCD)
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        g.writeDescriptor(d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                    } else {
                        d.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                        g.writeDescriptor(d)
                    }
                }
            }

            override fun onDescriptorWrite(g: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
                h.post {
                    chamadaConexao?.let {
                        it.setKeepAlive(false)
                        it.resolve(JSObject().put("nome", nome))
                    }
                    chamadaConexao = null
                }
            }

            @Deprecated("Android 12 e anteriores")
            override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic) {
                @Suppress("DEPRECATION")
                c.value?.let { emitir(it) }
            }

            override fun onCharacteristicChanged(g: BluetoothGatt, c: BluetoothGattCharacteristic, value: ByteArray) = emitir(value)

            override fun onCharacteristicWrite(g: BluetoothGatt, c: BluetoothGattCharacteristic, status: Int) {
                h.post {
                    ocupado = false
                    bombear()
                }
            }
        }, BluetoothDevice.TRANSPORT_LE)
    }

    private fun emitir(dados: ByteArray) {
        notifyListeners("dados", JSObject().put("dados", Base64.encodeToString(dados, Base64.NO_WRAP)))
    }

    @PluginMethod
    fun escrever(call: PluginCall) {
        val dados = Base64.decode(call.getString("dados") ?: return call.reject("faltou dados"), Base64.DEFAULT)
        if (rx == null) return call.reject("módulo desconectado")
        val pedaco = (mtu - 3).coerceAtLeast(20)
        h.post {
            var i = 0
            while (i < dados.size) {
                fila.addLast(dados.copyOfRange(i, minOf(dados.size, i + pedaco)))
                i += pedaco
            }
            bombear()
        }
        call.resolve()
    }

    @Suppress("DEPRECATION")
    private fun bombear() {
        if (ocupado) return
        val g = gatt ?: return
        val c = rx ?: return
        val p = fila.removeFirstOrNull() ?: return
        ocupado = true
        val ok = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            g.writeCharacteristic(c, p, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) == BluetoothGatt.GATT_SUCCESS
        } else {
            c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
            c.value = p
            g.writeCharacteristic(c)
        }
        if (!ok) {
            fila.addFirst(p)
            ocupado = false
            h.postDelayed({ bombear() }, 30)
        }
    }

    @PluginMethod
    fun desconectar(call: PluginCall) {
        gatt?.disconnect()
        gatt?.close()
        gatt = null
        rx = null
        fila.clear()
        call.resolve()
    }
}
