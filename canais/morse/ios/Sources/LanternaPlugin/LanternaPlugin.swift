import AVFoundation
import Capacitor
import Foundation

/// Lanterna para o Morse por luz no iOS.
@objc(LanternaPlugin)
public class LanternaPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "LanternaPlugin"
    public let jsName = "Lanterna"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "disponivel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ligar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "desligar", returnType: CAPPluginReturnPromise),
    ]

    private var dispositivo: AVCaptureDevice? {
        AVCaptureDevice.default(for: .video)
    }

    @objc func disponivel(_ call: CAPPluginCall) {
        call.resolve(["disponivel": dispositivo?.hasTorch ?? false])
    }

    @objc func ligar(_ call: CAPPluginCall) {
        aplicar(call, ligado: true)
    }

    @objc func desligar(_ call: CAPPluginCall) {
        aplicar(call, ligado: false)
    }

    private func aplicar(_ call: CAPPluginCall, ligado: Bool) {
        guard let d = dispositivo, d.hasTorch else {
            call.reject("aparelho sem lanterna")
            return
        }
        do {
            try d.lockForConfiguration()
            d.torchMode = ligado ? .on : .off
            d.unlockForConfiguration()
            call.resolve()
        } catch {
            call.reject("lanterna ocupada: \(error.localizedDescription)")
        }
    }
}
