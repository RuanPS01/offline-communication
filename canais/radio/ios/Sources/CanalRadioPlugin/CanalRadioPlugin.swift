import Capacitor
import CoreBluetooth
import Foundation

/// Ponte com o módulo LoRa externo pelo UART BLE da Nordic (NUS). Só move
/// bytes; o enquadramento KISS fica no TypeScript.
@objc(CanalRadioPlugin)
public class CanalRadioPlugin: CAPPlugin, CAPBridgedPlugin, CBCentralManagerDelegate, CBPeripheralDelegate {
    public let identifier = "CanalRadioPlugin"
    public let jsName = "CanalRadio"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "disponivel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "conectar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "escrever", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "desconectar", returnType: CAPPluginReturnPromise),
    ]

    private static let nus = CBUUID(string: "6e400001-b5a3-f393-e0a9-e50e24dcca9e")
    private static let rx = CBUUID(string: "6e400002-b5a3-f393-e0a9-e50e24dcca9e")
    private static let tx = CBUUID(string: "6e400003-b5a3-f393-e0a9-e50e24dcca9e")

    private var central: CBCentralManager?
    private var modulo: CBPeripheral?
    private var caracteristicaRx: CBCharacteristic?
    private var chamada: CAPPluginCall?
    private var fila: [Data] = []

    @objc func disponivel(_ call: CAPPluginCall) {
        let a = CBManager.authorization
        call.resolve(["disponivel": a != .denied && a != .restricted])
    }

    @objc func conectar(_ call: CAPPluginCall) {
        chamada = call
        if central == nil {
            central = CBCentralManager(delegate: self, queue: .main)
        } else if central?.state == .poweredOn {
            central?.scanForPeripherals(withServices: [CanalRadioPlugin.nus])
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 15) { [weak self] in
            guard let self = self, self.chamada === call, self.caracteristicaRx == nil else { return }
            self.central?.stopScan()
            call.reject("nenhum módulo LoRa encontrado por perto")
            self.chamada = nil
        }
    }

    public func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn, chamada != nil {
            central.scanForPeripherals(withServices: [CanalRadioPlugin.nus])
        } else if central.state != .poweredOn {
            chamada?.reject("ligue o Bluetooth")
            chamada = nil
        }
    }

    public func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        central.stopScan()
        modulo = peripheral
        peripheral.delegate = self
        central.connect(peripheral)
    }

    public func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([CanalRadioPlugin.nus])
    }

    public func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        caracteristicaRx = nil
        modulo = nil
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let s = peripheral.services?.first(where: { $0.uuid == CanalRadioPlugin.nus }) else { return }
        peripheral.discoverCharacteristics([CanalRadioPlugin.rx, CanalRadioPlugin.tx], for: s)
    }

    public func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        for c in service.characteristics ?? [] {
            if c.uuid == CanalRadioPlugin.rx { caracteristicaRx = c }
            if c.uuid == CanalRadioPlugin.tx { peripheral.setNotifyValue(true, for: c) }
        }
        if caracteristicaRx != nil {
            chamada?.resolve(["nome": peripheral.name ?? "módulo LoRa"])
            chamada = nil
        }
    }

    public func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let v = characteristic.value else { return }
        notifyListeners("dados", data: ["dados": v.base64EncodedString()])
    }

    public func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        bombear()
    }

    @objc func escrever(_ call: CAPPluginCall) {
        guard let texto = call.getString("dados"), let dados = Data(base64Encoded: texto), let m = modulo else {
            call.reject("módulo desconectado")
            return
        }
        let tamanho = m.maximumWriteValueLength(for: .withoutResponse)
        var i = 0
        while i < dados.count {
            fila.append(dados.subdata(in: i..<min(dados.count, i + tamanho)))
            i += tamanho
        }
        bombear()
        call.resolve()
    }

    private func bombear() {
        guard let m = modulo, let c = caracteristicaRx else { return }
        while m.canSendWriteWithoutResponse, !fila.isEmpty {
            m.writeValue(fila.removeFirst(), for: c, type: .withoutResponse)
        }
    }

    @objc func desconectar(_ call: CAPPluginCall) {
        if let m = modulo { central?.cancelPeripheralConnection(m) }
        fila.removeAll()
        call.resolve()
    }
}
