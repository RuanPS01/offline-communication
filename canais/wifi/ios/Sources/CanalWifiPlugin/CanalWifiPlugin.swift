import Capacitor
import Foundation
import MultipeerConnectivity

/// Canal Wi-Fi P2P no iOS com Multipeer Connectivity (entre iPhones).
/// Cada um usa o próprio id de nó como nome, o que já identifica o vizinho.
@objc(CanalWifiPlugin)
public class CanalWifiPlugin: CAPPlugin, CAPBridgedPlugin, MCSessionDelegate, MCNearbyServiceAdvertiserDelegate, MCNearbyServiceBrowserDelegate {
    public let identifier = "CanalWifiPlugin"
    public let jsName = "CanalWifi"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "disponivel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iniciar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "anunciar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enviar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "parar", returnType: CAPPluginReturnPromise),
    ]

    /// Até 15 caracteres; não pode colidir com o "_sobrevivencia._tcp" da rede local.
    private let tipoServico = "sobrev-mp"
    private var eu: MCPeerID?
    private var sessao: MCSession?
    private var anunciante: MCNearbyServiceAdvertiser?
    private var buscador: MCNearbyServiceBrowser?
    private var pares: [String: MCPeerID] = [:]

    @objc func disponivel(_ call: CAPPluginCall) {
        call.resolve(["disponivel": true])
    }

    @objc func iniciar(_ call: CAPPluginCall) {
        let nome = call.getString("idNo") ?? UUID().uuidString.prefix(12).lowercased()
        let peer = MCPeerID(displayName: nome)
        let s = MCSession(peer: peer, securityIdentity: nil, encryptionPreference: .required)
        s.delegate = self
        let a = MCNearbyServiceAdvertiser(peer: peer, discoveryInfo: nil, serviceType: tipoServico)
        a.delegate = self
        let b = MCNearbyServiceBrowser(peer: peer, serviceType: tipoServico)
        b.delegate = self
        eu = peer
        sessao = s
        anunciante = a
        buscador = b
        a.startAdvertisingPeer()
        b.startBrowsingForPeers()
        call.resolve()
    }

    @objc func anunciar(_ call: CAPPluginCall) {
        enviar(call)
    }

    @objc func enviar(_ call: CAPPluginCall) {
        guard let texto = call.getString("dados"), let dados = Data(base64Encoded: texto), let s = sessao else {
            call.reject("faltou dados ou canal parado")
            return
        }
        var alvos = s.connectedPeers
        if let destino = call.getString("destino") {
            alvos = alvos.filter { $0.displayName == destino }
        }
        if !alvos.isEmpty {
            do {
                try s.send(dados, toPeers: alvos, with: .reliable)
            } catch {
                call.reject("Multipeer: \(error.localizedDescription)")
                return
            }
        }
        call.resolve()
    }

    @objc func parar(_ call: CAPPluginCall) {
        anunciante?.stopAdvertisingPeer()
        buscador?.stopBrowsingForPeers()
        sessao?.disconnect()
        pares.removeAll()
        call.resolve()
    }

    // MARK: descoberta

    public func browser(_ browser: MCNearbyServiceBrowser, foundPeer peerID: MCPeerID, withDiscoveryInfo info: [String: String]?) {
        guard let eu = eu, let s = sessao else { return }
        // Só um dos dois convida: o de nome menor.
        if eu.displayName < peerID.displayName && !s.connectedPeers.contains(peerID) {
            browser.invitePeer(peerID, to: s, withContext: nil, timeout: 20)
        }
    }

    public func browser(_ browser: MCNearbyServiceBrowser, lostPeer peerID: MCPeerID) {}

    public func advertiser(_ advertiser: MCNearbyServiceAdvertiser, didReceiveInvitationFromPeer peerID: MCPeerID, withContext context: Data?, invitationHandler: @escaping (Bool, MCSession?) -> Void) {
        invitationHandler(true, sessao)
    }

    // MARK: sessão

    public func session(_ session: MCSession, peer peerID: MCPeerID, didChange state: MCSessionState) {
        let nome = peerID.displayName
        switch state {
        case .connected:
            pares[nome] = peerID
            var e: [String: Any] = ["idLocal": nome, "presente": true]
            if nome.count == 12 { e["idNo"] = nome }
            notifyListeners("vizinho", data: e)
        case .notConnected:
            if pares.removeValue(forKey: nome) != nil {
                notifyListeners("vizinho", data: ["idLocal": nome, "presente": false])
            }
        default:
            break
        }
    }

    public func session(_ session: MCSession, didReceive data: Data, fromPeer peerID: MCPeerID) {
        notifyListeners("pacote", data: ["dados": data.base64EncodedString(), "de": peerID.displayName])
    }

    public func session(_ session: MCSession, didReceive stream: InputStream, withName streamName: String, fromPeer peerID: MCPeerID) {}

    public func session(_ session: MCSession, didStartReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, with progress: Progress) {}

    public func session(_ session: MCSession, didFinishReceivingResourceWithName resourceName: String, fromPeer peerID: MCPeerID, at localURL: URL?, withError error: Error?) {}
}
