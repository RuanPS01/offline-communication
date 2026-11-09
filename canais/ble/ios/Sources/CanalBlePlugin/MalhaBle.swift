import CoreBluetooth
import Foundation

/// Pedaços com cabeçalho de 1 byte: bit 7 = primeiro, bit 6 = último,
/// bits 0 a 5 = número do pacote. Igual ao Android, para a ponte entre os dois.
enum Pedacos {
    static let primeiro: UInt8 = 0x80
    static let ultimo: UInt8 = 0x40
    static let tamanhoMaximo = 64 * 1024

    static func quebrar(_ pacote: Data, tamanho: Int, numero: Int) -> [Data] {
        let util = max(1, tamanho - 1)
        let total = max(1, (pacote.count + util - 1) / util)
        return (0..<total).map { i in
            var cabecalho = UInt8(numero & 0x3f)
            if i == 0 { cabecalho |= primeiro }
            if i == total - 1 { cabecalho |= ultimo }
            let inicio = pacote.startIndex + i * util
            let fim = min(pacote.endIndex, inicio + util)
            var pedaco = Data([cabecalho])
            pedaco.append(pacote[inicio..<fim])
            return pedaco
        }
    }
}

final class Remontagem {
    private var atual: Data?
    private var numero = -1

    func receber(_ pedaco: Data) -> Data? {
        guard let cabecalho = pedaco.first else { return nil }
        let n = Int(cabecalho & 0x3f)
        if cabecalho & Pedacos.primeiro != 0 {
            atual = Data()
            numero = n
        } else if n != numero {
            atual = nil
            return nil
        }
        guard atual != nil else { return nil }
        atual!.append(pedaco.dropFirst())
        if atual!.count > Pedacos.tamanhoMaximo {
            atual = nil
            return nil
        }
        if cabecalho & Pedacos.ultimo != 0 {
            defer { atual = nil }
            return atual
        }
        return nil
    }
}

/// Malha BLE no iOS: periférico (anuncia o serviço, recebe escritas e notifica)
/// e central (procura, conecta e escreve) ao mesmo tempo, com o mesmo GATT do
/// Android. Tudo roda numa fila serial própria.
final class MalhaBle: NSObject, CBCentralManagerDelegate, CBPeripheralManagerDelegate, CBPeripheralDelegate {
    static let servico = CBUUID(string: "6f63616d-0001-4c68-8a1e-6f66666c696e")
    static let pacotes = CBUUID(string: "6f63616d-0002-4c68-8a1e-6f66666c696e")
    private static let maxConexoes = 7

    var aoReceber: ((Data, String, Int?) -> Void)?
    var aoVizinho: ((String, Bool, Int?) -> Void)?

    private let fila = DispatchQueue(label: "malha-ble")
    private var central: CBCentralManager?
    private var periferico: CBPeripheralManager?
    private var caracteristicaLocal: CBMutableCharacteristic?
    private var conectados: [UUID: CBPeripheral] = [:]
    private var remotas: [UUID: CBCharacteristic] = [:]
    private var assinantes: [UUID: CBCentral] = [:]
    private var remontagens: [String: Remontagem] = [:]
    private var filaEscrita: [UUID: [Data]] = [:]
    private var filaNotificacao: [(UUID, Data)] = []
    private var rssi: [UUID: Int] = [:]
    private var ultimoAvisoRssi: [UUID: Date] = [:]
    private var numero = 0
    private var ligada = false

    func iniciar() {
        fila.async {
            self.ligada = true
            if self.central == nil {
                self.central = CBCentralManager(delegate: self, queue: self.fila)
                self.periferico = CBPeripheralManager(delegate: self, queue: self.fila)
            } else {
                self.comecarBusca()
                self.comecarAnuncio()
            }
        }
    }

    func parar() {
        fila.async {
            self.ligada = false
            self.central?.stopScan()
            self.periferico?.stopAdvertising()
            for p in self.conectados.values { self.central?.cancelPeripheralConnection(p) }
            self.conectados.removeAll()
            self.remotas.removeAll()
            self.assinantes.removeAll()
            self.periferico?.removeAllServices()
            self.caracteristicaLocal = nil
        }
    }

    func enviar(_ pacote: Data, destino: String?) {
        fila.async {
            self.numero = (self.numero + 1) & 0x3f
            let n = self.numero
            // Como central: escreve em quem conectamos.
            for (id, p) in self.conectados {
                guard self.remotas[id] != nil else { continue }
                if let d = destino, d != id.uuidString { continue }
                let tamanho = p.maximumWriteValueLength(for: .withoutResponse)
                self.filaEscrita[id, default: []].append(contentsOf: Pedacos.quebrar(pacote, tamanho: tamanho, numero: n))
                self.bombearEscrita(p)
            }
            // Como periférico: notifica quem assinou e não está na lista acima.
            for (id, c) in self.assinantes where self.remotas[id] == nil {
                if let d = destino, d != id.uuidString { continue }
                for pedaco in Pedacos.quebrar(pacote, tamanho: c.maximumUpdateValueLength, numero: n) {
                    self.filaNotificacao.append((id, pedaco))
                }
            }
            self.bombearNotificacoes()
        }
    }

    // MARK: central

    func centralManagerDidUpdateState(_ central: CBCentralManager) {
        if central.state == .poweredOn && ligada { comecarBusca() }
    }

    private func comecarBusca() {
        guard let c = central, c.state == .poweredOn else { return }
        c.scanForPeripherals(withServices: [MalhaBle.servico], options: [CBCentralManagerScanOptionAllowDuplicatesKey: true])
    }

    func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
        let id = peripheral.identifier
        rssi[id] = RSSI.intValue
        if remotas[id] != nil, Date().timeIntervalSince(ultimoAvisoRssi[id] ?? .distantPast) > 3 {
            ultimoAvisoRssi[id] = Date()
            aoVizinho?(id.uuidString, true, RSSI.intValue)
        }
        guard conectados[id] == nil, conectados.count < MalhaBle.maxConexoes else { return }
        conectados[id] = peripheral
        peripheral.delegate = self
        central.connect(peripheral, options: nil)
    }

    func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
        peripheral.discoverServices([MalhaBle.servico])
    }

    func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
        conectados[peripheral.identifier] = nil
    }

    func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
        let id = peripheral.identifier
        conectados[id] = nil
        filaEscrita[id] = nil
        if remotas.removeValue(forKey: id) != nil, assinantes[id] == nil {
            aoVizinho?(id.uuidString, false, nil)
        }
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
        guard let s = peripheral.services?.first(where: { $0.uuid == MalhaBle.servico }) else {
            central?.cancelPeripheralConnection(peripheral)
            return
        }
        peripheral.discoverCharacteristics([MalhaBle.pacotes], for: s)
    }

    func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
        guard let c = service.characteristics?.first(where: { $0.uuid == MalhaBle.pacotes }) else { return }
        let id = peripheral.identifier
        remotas[id] = c
        peripheral.setNotifyValue(true, for: c)
        if assinantes[id] == nil { aoVizinho?(id.uuidString, true, rssi[id]) }
        bombearEscrita(peripheral)
    }

    func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
        guard let valor = characteristic.value else { return }
        let id = peripheral.identifier
        let r = remontagens["c:\(id)", default: Remontagem()]
        remontagens["c:\(id)"] = r
        if let pacote = r.receber(valor) { aoReceber?(pacote, id.uuidString, rssi[id]) }
    }

    func peripheralIsReady(toSendWriteWithoutResponse peripheral: CBPeripheral) {
        bombearEscrita(peripheral)
    }

    private func bombearEscrita(_ p: CBPeripheral) {
        let id = p.identifier
        guard let c = remotas[id] else { return }
        while p.canSendWriteWithoutResponse, var lista = filaEscrita[id], !lista.isEmpty {
            let pedaco = lista.removeFirst()
            filaEscrita[id] = lista
            p.writeValue(pedaco, for: c, type: .withoutResponse)
        }
    }

    // MARK: periférico

    func peripheralManagerDidUpdateState(_ peripheral: CBPeripheralManager) {
        if peripheral.state == .poweredOn && ligada { comecarAnuncio() }
    }

    private func comecarAnuncio() {
        guard let pm = periferico, pm.state == .poweredOn else { return }
        if caracteristicaLocal == nil {
            let c = CBMutableCharacteristic(
                type: MalhaBle.pacotes,
                properties: [.write, .writeWithoutResponse, .notify],
                value: nil,
                permissions: [.writeable]
            )
            let s = CBMutableService(type: MalhaBle.servico, primary: true)
            s.characteristics = [c]
            pm.add(s)
            caracteristicaLocal = c
        }
        pm.startAdvertising([CBAdvertisementDataServiceUUIDsKey: [MalhaBle.servico]])
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, didReceiveWrite requests: [CBATTRequest]) {
        for req in requests {
            guard let valor = req.value else { continue }
            let id = req.central.identifier
            let r = remontagens["p:\(id)", default: Remontagem()]
            remontagens["p:\(id)"] = r
            if let pacote = r.receber(valor) { aoReceber?(pacote, id.uuidString, rssi[id]) }
        }
        if let primeiro = requests.first { peripheral.respond(to: primeiro, withResult: .success) }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didSubscribeTo characteristic: CBCharacteristic) {
        let id = central.identifier
        let nova = assinantes[id] == nil && remotas[id] == nil
        assinantes[id] = central
        if nova { aoVizinho?(id.uuidString, true, rssi[id]) }
    }

    func peripheralManager(_ peripheral: CBPeripheralManager, central: CBCentral, didUnsubscribeFrom characteristic: CBCharacteristic) {
        let id = central.identifier
        assinantes[id] = nil
        if remotas[id] == nil { aoVizinho?(id.uuidString, false, nil) }
    }

    func peripheralManagerIsReady(toUpdateSubscribers peripheral: CBPeripheralManager) {
        bombearNotificacoes()
    }

    private func bombearNotificacoes() {
        guard let pm = periferico, let c = caracteristicaLocal else { return }
        while let item = filaNotificacao.first {
            let (id, pedaco) = item
            guard let central = assinantes[id] else {
                filaNotificacao.removeFirst()
                continue
            }
            // Fila do sistema cheia: espera o "pronto" para continuar.
            if !pm.updateValue(pedaco, for: c, onSubscribedCentrals: [central]) { return }
            filaNotificacao.removeFirst()
        }
    }
}
