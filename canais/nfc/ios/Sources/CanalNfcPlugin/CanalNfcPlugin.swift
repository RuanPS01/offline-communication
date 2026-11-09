import Capacitor
import CoreNFC
import Foundation

/// NFC no iPhone: só leitor (o iOS não deixa o app emular cartão). Lê um
/// Android que esteja como cartão (HCE) e troca pacotes nos dois sentidos,
/// com o mesmo protocolo de APDUs do Android.
@objc(CanalNfcPlugin)
public class CanalNfcPlugin: CAPPlugin, CAPBridgedPlugin, NFCTagReaderSessionDelegate {
    public let identifier = "CanalNfcPlugin"
    public let jsName = "CanalNfc"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "disponivel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iniciar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "anunciar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enviar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "parar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "ler", returnType: CAPPluginReturnPromise),
    ]

    private static let aid = Data([0xF0, 0x53, 0x4F, 0x42, 0x52, 0x45, 0x56])
    private var presenca: Data?
    private var saida: [Data] = []
    private var sessao: NFCTagReaderSession?
    private var chamadaLeitura: CAPPluginCall?

    @objc func disponivel(_ call: CAPPluginCall) {
        if NFCTagReaderSession.readingAvailable {
            call.resolve(["disponivel": true])
        } else {
            call.resolve(["disponivel": false, "motivo": "este iPhone não lê NFC"])
        }
    }

    @objc func iniciar(_ call: CAPPluginCall) {
        call.resolve()
    }

    @objc func anunciar(_ call: CAPPluginCall) {
        presenca = call.getString("dados").flatMap { Data(base64Encoded: $0) }
        call.resolve()
    }

    @objc func enviar(_ call: CAPPluginCall) {
        if let d = call.getString("dados").flatMap({ Data(base64Encoded: $0) }) {
            saida.append(d)
            if saida.count > 20 { saida.removeFirst() }
        }
        call.resolve()
    }

    @objc func parar(_ call: CAPPluginCall) {
        sessao?.invalidate()
        call.resolve()
    }

    @objc func ler(_ call: CAPPluginCall) {
        guard NFCTagReaderSession.readingAvailable else {
            call.reject("este iPhone não lê NFC")
            return
        }
        chamadaLeitura = call
        let s = NFCTagReaderSession(pollingOption: [.iso14443], delegate: self, queue: nil)
        s?.alertMessage = "Encoste o topo do iPhone nas costas do Android."
        sessao = s
        s?.begin()
    }

    public func tagReaderSessionDidBecomeActive(_ session: NFCTagReaderSession) {}

    public func tagReaderSession(_ session: NFCTagReaderSession, didInvalidateWithError error: Error) {
        chamadaLeitura?.resolve(["trocou": false])
        chamadaLeitura = nil
        sessao = nil
    }

    public func tagReaderSession(_ session: NFCTagReaderSession, didDetect tags: [NFCTag]) {
        guard let primeira = tags.first, case let .iso7816(tag) = primeira else {
            session.invalidate(errorMessage: "Não é um celular com o app.")
            return
        }
        session.connect(to: primeira) { [weak self] erro in
            guard let self = self, erro == nil else {
                session.invalidate(errorMessage: "Falhou ao conectar.")
                return
            }
            self.trocar(tag, sessao: session)
        }
    }

    private func apdu(_ ins: UInt8, _ dados: Data = Data(), cla: UInt8 = 0x80, p1: UInt8 = 0, esperado: Int = 256) -> NFCISO7816APDU {
        NFCISO7816APDU(instructionClass: cla, instructionCode: ins, p1Parameter: p1, p2Parameter: 0, data: dados, expectedResponseLength: esperado)
    }

    private func trocar(_ tag: NFCISO7816Tag, sessao: NFCTagReaderSession) {
        let id = tag.identifier.map { String(format: "%02x", $0) }.joined()
        notifyListeners("vizinho", data: ["idLocal": "nfc:\(id)", "presente": true])
        let pendentes = [presenca].compactMap { $0 } + saida
        tag.sendCommand(apdu: apdu(0xA4, CanalNfcPlugin.aid, cla: 0x00, p1: 0x04)) { [weak self] _, sw1, _, erro in
            guard let self = self, erro == nil, sw1 == 0x90 else {
                sessao.invalidate(errorMessage: "O outro celular não respondeu.")
                return
            }
            self.entregar(tag, pendentes, sessao: sessao, id: id)
        }
    }

    private func entregar(_ tag: NFCISO7816Tag, _ restantes: [Data], sessao: NFCTagReaderSession, id: String) {
        guard let p = restantes.first else {
            pedir(tag, sessao: sessao, id: id, recebidos: 0)
            return
        }
        tag.sendCommand(apdu: apdu(0x10, p, esperado: -1)) { [weak self] _, _, _, _ in
            self?.entregar(tag, Array(restantes.dropFirst()), sessao: sessao, id: id)
        }
    }

    private func pedir(_ tag: NFCISO7816Tag, sessao: NFCTagReaderSession, id: String, recebidos: Int) {
        tag.sendCommand(apdu: apdu(0x20)) { [weak self] resposta, sw1, _, erro in
            guard let self = self else { return }
            if erro == nil, sw1 == 0x90, !resposta.isEmpty, recebidos < 40 {
                self.notifyListeners("pacote", data: ["dados": resposta.base64EncodedString(), "de": "nfc:\(id)"])
                self.pedir(tag, sessao: sessao, id: id, recebidos: recebidos + 1)
                return
            }
            self.notifyListeners("vizinho", data: ["idLocal": "nfc:\(id)", "presente": false])
            sessao.alertMessage = "Troca feita."
            sessao.invalidate()
            self.chamadaLeitura?.resolve(["trocou": true, "recebidos": recebidos])
            self.chamadaLeitura = nil
        }
    }
}
