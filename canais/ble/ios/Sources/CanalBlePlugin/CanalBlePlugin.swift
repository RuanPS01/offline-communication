import Capacitor
import CoreBluetooth
import Foundation

/// Plugin do canal BLE no iOS: o mesmo contrato do canal do lado nativo.
@objc(CanalBlePlugin)
public class CanalBlePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "CanalBlePlugin"
    public let jsName = "CanalBle"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "disponivel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iniciar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "anunciar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enviar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "parar", returnType: CAPPluginReturnPromise),
    ]

    private let malha = MalhaBle()

    override public func load() {
        malha.aoReceber = { [weak self] dados, de, rssi in
            var e: [String: Any] = ["dados": dados.base64EncodedString(), "de": de]
            if let r = rssi { e["rssi"] = r }
            self?.notifyListeners("pacote", data: e)
        }
        malha.aoVizinho = { [weak self] id, presente, rssi in
            var e: [String: Any] = ["idLocal": id, "presente": presente]
            if let r = rssi { e["rssi"] = r }
            self?.notifyListeners("vizinho", data: e)
        }
    }

    @objc func disponivel(_ call: CAPPluginCall) {
        let autorizacao = CBManager.authorization
        if autorizacao == .denied || autorizacao == .restricted {
            call.resolve(["disponivel": false, "motivo": "permissão de Bluetooth negada nos Ajustes"])
        } else {
            call.resolve(["disponivel": true])
        }
    }

    @objc func iniciar(_ call: CAPPluginCall) {
        // A permissão é pedida pelo sistema ao criar os gerenciadores.
        malha.iniciar()
        call.resolve()
    }

    @objc func anunciar(_ call: CAPPluginCall) {
        enviar(call)
    }

    @objc func enviar(_ call: CAPPluginCall) {
        guard let texto = call.getString("dados"), let dados = Data(base64Encoded: texto) else {
            call.reject("faltou dados")
            return
        }
        malha.enviar(dados, destino: call.getString("destino"))
        call.resolve()
    }

    @objc func parar(_ call: CAPPluginCall) {
        malha.parar()
        call.resolve()
    }
}
