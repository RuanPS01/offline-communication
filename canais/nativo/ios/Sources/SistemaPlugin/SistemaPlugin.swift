import Capacitor
import Foundation
import UIKit

/// Modo rádio ligado no iOS: a tela fica acesa (o iOS não deixa o app
/// escutando a malha por muito tempo minimizado).
@objc(SistemaPlugin)
public class SistemaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SistemaPlugin"
    public let jsName = "Sistema"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "ligarModoRadio", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "desligarModoRadio", returnType: CAPPluginReturnPromise),
    ]

    @objc func ligarModoRadio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = true
            call.resolve()
        }
    }

    @objc func desligarModoRadio(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            UIApplication.shared.isIdleTimerDisabled = false
            call.resolve()
        }
    }
}
