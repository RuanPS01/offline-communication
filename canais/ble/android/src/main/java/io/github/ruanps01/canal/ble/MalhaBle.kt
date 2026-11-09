package io.github.ruanps01.canal.ble

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothGattServer
import android.bluetooth.BluetoothGattServerCallback
import android.bluetooth.BluetoothGattService
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.AdvertiseCallback
import android.bluetooth.le.AdvertiseData
import android.bluetooth.le.AdvertiseSettings
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanFilter
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.ParcelUuid
import android.util.Log
import java.util.UUID

/**
 * Malha BLE: cada aparelho é periférico (anuncia o serviço e recebe escritas)
 * e central (procura o serviço, conecta e escreve) ao mesmo tempo. O mesmo
 * GATT existe no iOS, o que faz a ponte entre os dois sistemas.
 *
 * Todas as operações rodam numa thread própria, uma de cada vez por conexão,
 * porque a pilha BLE do Android não aceita operações sobrepostas.
 */
@SuppressLint("MissingPermission")
class MalhaBle(
    private val contexto: Context,
    private val aoReceber: (dados: ByteArray, de: String, rssi: Int?) -> Unit,
    private val aoVizinho: (endereco: String, presente: Boolean, rssi: Int?) -> Unit,
) {
    companion object {
        val SERVICO: UUID = UUID.fromString("6f63616d-0001-4c68-8a1e-6f66666c696e")
        val PACOTES: UUID = UUID.fromString("6f63616d-0002-4c68-8a1e-6f66666c696e")
        val CCCD: UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
        private const val MAX_CONEXOES = 7
        private const val TAG = "MalhaBle"
    }

    /** Uma ligação com um vizinho: como central (nós escrevemos) ou periférico (nós notificamos). */
    private inner class Ligacao(val endereco: String, val comoCentral: Boolean) {
        var gatt: BluetoothGatt? = null
        var caracteristica: BluetoothGattCharacteristic? = null
        var dispositivo: BluetoothDevice? = null
        var mtu = 23
        var pronta = false
        val fila = ArrayDeque<ByteArray>()
        var ocupada = false
        val remontagem = Remontagem()
        var ultimoRssi: Int? = null
    }

    private val gerenciador = contexto.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager
    private val adaptador: BluetoothAdapter? get() = gerenciador.adapter
    private val thread = HandlerThread("malha-ble").apply { start() }
    private val h = Handler(thread.looper)
    private var servidor: BluetoothGattServer? = null
    private var caracteristicaServidor: BluetoothGattCharacteristic? = null
    private val centrais = HashMap<String, Ligacao>()
    private val perifericos = HashMap<String, Ligacao>()
    private val conectando = HashSet<String>()
    private val ultimoAvisoRssi = HashMap<String, Long>()
    private var numeroPacote = 0
    private var ligada = false

    fun disponivel(): Boolean = adaptador != null && contexto.packageManager.hasSystemFeature("android.hardware.bluetooth_le")

    fun ativo(): Boolean = adaptador?.isEnabled == true

    fun iniciar() = h.post {
        if (ligada) return@post
        ligada = true
        abrirServidor()
        anunciar()
        procurar()
    }

    fun parar() = h.post {
        ligada = false
        runCatching { adaptador?.bluetoothLeAdvertiser?.stopAdvertising(anuncio) }
        runCatching { adaptador?.bluetoothLeScanner?.stopScan(varredura) }
        for (l in centrais.values) runCatching { l.gatt?.close() }
        centrais.clear()
        perifericos.clear()
        conectando.clear()
        runCatching { servidor?.close() }
        servidor = null
    }

    /** Manda um pacote a um vizinho (ou a todos). Prefere a ligação como central. */
    fun enviar(pacote: ByteArray, destino: String?) = h.post {
        val numero = numeroPacote++ and 0x3f
        val alvos = HashMap<String, Ligacao>()
        for ((e, l) in perifericos) if (l.pronta) alvos[e] = l
        for ((e, l) in centrais) if (l.pronta) alvos[e] = l
        val escolhidos = if (destino != null) listOfNotNull(alvos[destino]) else alvos.values.toList()
        for (l in escolhidos) {
            val tamanho = (l.mtu - 3).coerceIn(20, 512)
            l.fila.addAll(Pedacos.quebrar(pacote, tamanho, numero))
            bombear(l)
        }
    }

    // ---------------------------------------------------------------- servidor GATT

    private fun abrirServidor() {
        val s = gerenciador.openGattServer(contexto, retornoServidor) ?: return
        val c = BluetoothGattCharacteristic(
            PACOTES,
            BluetoothGattCharacteristic.PROPERTY_WRITE or
                BluetoothGattCharacteristic.PROPERTY_WRITE_NO_RESPONSE or
                BluetoothGattCharacteristic.PROPERTY_NOTIFY,
            BluetoothGattCharacteristic.PERMISSION_WRITE,
        )
        c.addDescriptor(
            BluetoothGattDescriptor(CCCD, BluetoothGattDescriptor.PERMISSION_READ or BluetoothGattDescriptor.PERMISSION_WRITE),
        )
        val servico = BluetoothGattService(SERVICO, BluetoothGattService.SERVICE_TYPE_PRIMARY)
        servico.addCharacteristic(c)
        s.addService(servico)
        servidor = s
        caracteristicaServidor = c
    }

    private val retornoServidor = object : BluetoothGattServerCallback() {
        override fun onConnectionStateChange(device: BluetoothDevice, status: Int, newState: Int) {
            h.post {
                if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                    if (perifericos.remove(device.address) != null && !centrais.containsKey(device.address)) {
                        aoVizinho(device.address, false, null)
                    }
                }
            }
        }

        override fun onMtuChanged(device: BluetoothDevice, mtu: Int) {
            h.post { perifericos[device.address]?.mtu = mtu }
        }

        override fun onCharacteristicWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            characteristic: BluetoothGattCharacteristic,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
            if (responseNeeded) servidor?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            val dados = value ?: return
            h.post {
                val l = perifericos.getOrPut(device.address) { Ligacao(device.address, false).also { it.dispositivo = device } }
                l.remontagem.receber(dados)?.let { aoReceber(it, device.address, l.ultimoRssi) }
            }
        }

        override fun onDescriptorWriteRequest(
            device: BluetoothDevice,
            requestId: Int,
            descriptor: BluetoothGattDescriptor,
            preparedWrite: Boolean,
            responseNeeded: Boolean,
            offset: Int,
            value: ByteArray?,
        ) {
            if (responseNeeded) servidor?.sendResponse(device, requestId, BluetoothGatt.GATT_SUCCESS, 0, null)
            if (descriptor.uuid != CCCD) return
            h.post {
                val ligando = value != null && value.isNotEmpty() && value[0].toInt() != 0
                if (ligando) {
                    val nova = !perifericos.containsKey(device.address) && !centrais.containsKey(device.address)
                    val l = perifericos.getOrPut(device.address) { Ligacao(device.address, false) }
                    l.dispositivo = device
                    l.pronta = true
                    if (nova) aoVizinho(device.address, true, null)
                } else {
                    perifericos.remove(device.address)
                }
            }
        }

        override fun onNotificationSent(device: BluetoothDevice, status: Int) {
            h.post {
                val l = perifericos[device.address] ?: return@post
                l.ocupada = false
                bombear(l)
            }
        }
    }

    // ---------------------------------------------------------------- anúncio e busca

    private val anuncio = object : AdvertiseCallback() {
        override fun onStartFailure(errorCode: Int) {
            Log.w(TAG, "anúncio BLE falhou: $errorCode")
        }
    }

    private fun anunciar() {
        val anunciante = adaptador?.bluetoothLeAdvertiser ?: return
        val config = AdvertiseSettings.Builder()
            .setAdvertiseMode(AdvertiseSettings.ADVERTISE_MODE_LOW_LATENCY)
            .setTxPowerLevel(AdvertiseSettings.ADVERTISE_TX_POWER_HIGH)
            .setConnectable(true)
            .build()
        val dados = AdvertiseData.Builder().addServiceUuid(ParcelUuid(SERVICO)).setIncludeDeviceName(false).build()
        anunciante.startAdvertising(config, dados, anuncio)
    }

    private val varredura = object : ScanCallback() {
        override fun onScanResult(callbackType: Int, result: ScanResult) {
            h.post { avistado(result) }
        }

        override fun onBatchScanResults(results: MutableList<ScanResult>) {
            h.post { results.forEach { avistado(it) } }
        }
    }

    private fun procurar() {
        val scanner = adaptador?.bluetoothLeScanner ?: return
        val filtro = ScanFilter.Builder().setServiceUuid(ParcelUuid(SERVICO)).build()
        val config = ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build()
        scanner.startScan(listOf(filtro), config, varredura)
    }

    private fun avistado(r: ScanResult) {
        if (!ligada) return
        val endereco = r.device.address
        val agora = System.currentTimeMillis()
        centrais[endereco]?.ultimoRssi = r.rssi
        perifericos[endereco]?.ultimoRssi = r.rssi
        val conhecido = centrais[endereco]?.pronta == true || perifericos[endereco]?.pronta == true
        if (conhecido && agora - (ultimoAvisoRssi[endereco] ?: 0) > 3000) {
            ultimoAvisoRssi[endereco] = agora
            aoVizinho(endereco, true, r.rssi)
        }
        if (centrais.containsKey(endereco) || endereco in conectando) return
        if (centrais.size + conectando.size >= MAX_CONEXOES) return
        conectando.add(endereco)
        val l = Ligacao(endereco, true)
        l.ultimoRssi = r.rssi
        centrais[endereco] = l
        l.gatt = r.device.connectGatt(contexto, false, retornoCentral, BluetoothDevice.TRANSPORT_LE)
    }

    // ---------------------------------------------------------------- lado central

    private val retornoCentral = object : BluetoothGattCallback() {
        override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
            h.post {
                val endereco = gatt.device.address
                if (newState == BluetoothProfile.STATE_CONNECTED && status == BluetoothGatt.GATT_SUCCESS) {
                    gatt.requestMtu(517)
                } else {
                    conectando.remove(endereco)
                    val l = centrais.remove(endereco)
                    runCatching { gatt.close() }
                    if (l?.pronta == true && !perifericos.containsKey(endereco)) aoVizinho(endereco, false, null)
                }
            }
        }

        override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
            h.post {
                centrais[gatt.device.address]?.mtu = if (status == BluetoothGatt.GATT_SUCCESS) mtu else 23
                gatt.discoverServices()
            }
        }

        override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
            h.post {
                val l = centrais[gatt.device.address] ?: return@post
                val c = gatt.getService(SERVICO)?.getCharacteristic(PACOTES)
                if (c == null) {
                    gatt.disconnect()
                    return@post
                }
                l.caracteristica = c
                gatt.setCharacteristicNotification(c, true)
                val d = c.getDescriptor(CCCD)
                if (d != null) {
                    escreverDescritor(gatt, d, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                } else {
                    ficarPronta(l)
                }
            }
        }

        override fun onDescriptorWrite(gatt: BluetoothGatt, descriptor: BluetoothGattDescriptor, status: Int) {
            h.post { centrais[gatt.device.address]?.let { ficarPronta(it) } }
        }

        @Deprecated("Android 12 e anteriores")
        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic) {
            @Suppress("DEPRECATION")
            val valor = characteristic.value ?: return
            recebidoComoCentral(gatt, valor)
        }

        override fun onCharacteristicChanged(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, value: ByteArray) {
            recebidoComoCentral(gatt, value)
        }

        override fun onCharacteristicWrite(gatt: BluetoothGatt, characteristic: BluetoothGattCharacteristic, status: Int) {
            h.post {
                val l = centrais[gatt.device.address] ?: return@post
                l.ocupada = false
                bombear(l)
            }
        }
    }

    private fun recebidoComoCentral(gatt: BluetoothGatt, valor: ByteArray) {
        val copia = valor.copyOf()
        h.post {
            val l = centrais[gatt.device.address] ?: return@post
            l.remontagem.receber(copia)?.let { aoReceber(it, gatt.device.address, l.ultimoRssi) }
        }
    }

    private fun ficarPronta(l: Ligacao) {
        conectando.remove(l.endereco)
        if (l.pronta) return
        l.pronta = true
        if (!perifericos.containsKey(l.endereco)) aoVizinho(l.endereco, true, l.ultimoRssi)
        bombear(l)
    }

    @Suppress("DEPRECATION")
    private fun escreverDescritor(gatt: BluetoothGatt, d: BluetoothGattDescriptor, valor: ByteArray) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            gatt.writeDescriptor(d, valor)
        } else {
            d.value = valor
            gatt.writeDescriptor(d)
        }
    }

    // ---------------------------------------------------------------- fila de escrita

    /** Envia o próximo pedaço da fila da ligação, um de cada vez. */
    @Suppress("DEPRECATION")
    private fun bombear(l: Ligacao) {
        if (l.ocupada || !l.pronta) return
        val pedaco = l.fila.removeFirstOrNull() ?: return
        l.ocupada = true
        val ok = if (l.comoCentral) {
            val gatt = l.gatt
            val c = l.caracteristica
            if (gatt == null || c == null) {
                false
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                gatt.writeCharacteristic(c, pedaco, BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE) == BluetoothGatt.GATT_SUCCESS
            } else {
                c.writeType = BluetoothGattCharacteristic.WRITE_TYPE_NO_RESPONSE
                c.value = pedaco
                gatt.writeCharacteristic(c)
            }
        } else {
            val s = servidor
            val c = caracteristicaServidor
            val d = l.dispositivo
            if (s == null || c == null || d == null) {
                false
            } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                s.notifyCharacteristicChanged(d, c, false, pedaco) == BluetoothGatt.GATT_SUCCESS
            } else {
                c.value = pedaco
                s.notifyCharacteristicChanged(d, c, false)
            }
        }
        if (!ok) {
            // A pilha recusou (ocupada): tenta de novo daqui a pouco.
            l.fila.addFirst(pedaco)
            l.ocupada = false
            h.postDelayed({ bombear(l) }, 20)
        }
    }
}
