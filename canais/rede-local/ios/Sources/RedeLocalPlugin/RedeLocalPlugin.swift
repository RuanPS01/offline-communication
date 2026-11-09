import Capacitor
import Foundation
import Network

/// Canal de rede local no iPhone: vira servidor (HTTP + WebSocket + Bonjour)
/// ou entra na rede de outro servidor achado por Bonjour. Hotspot não dá para
/// criar pelo app: o usuário liga o Compartilhamento de Internet à mão.
@objc(RedeLocalPlugin)
public class RedeLocalPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "RedeLocalPlugin"
    public let jsName = "RedeLocal"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "disponivel", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iniciar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "anunciar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "enviar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "parar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "iniciarServidor", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pararServidor", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "descobrir", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pararDescoberta", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "conectar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "desconectar", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "criarHotspot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pararHotspot", returnType: CAPPluginReturnPromise),
    ]

    private var servidor: ServidorLocal?
    private var navegador: NWBrowser?
    private var resolucoes: [NWConnection] = []
    private var tarefa: URLSessionWebSocketTask?
    private var conhecidos = Set<String>()
    private var meuId: String?

    private func emitirPacote(_ de: String, _ pacote: Data) {
        notifyListeners("pacote", data: ["dados": pacote.base64EncodedString(), "de": de])
    }

    private func emitirVizinho(_ id: String, _ presente: Bool) {
        notifyListeners("vizinho", data: ["idLocal": id, "presente": presente])
    }

    @objc func disponivel(_ call: CAPPluginCall) {
        call.resolve(["disponivel": true])
    }

    @objc func iniciar(_ call: CAPPluginCall) {
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
        let destino = call.getString("destino")
        servidor?.enviar(dados, destino: destino)
        tarefa?.send(.data(Moldura.emoldurar(destino ?? "", dados))) { _ in }
        call.resolve()
    }

    @objc func parar(_ call: CAPPluginCall) {
        pararTudo()
        call.resolve()
    }

    @objc func iniciarServidor(_ call: CAPPluginCall) {
        let porta = UInt16(call.getInt("porta") ?? 8080)
        let nome = call.getString("nome") ?? "Ponto de encontro"
        desconectarCliente()
        servidor?.parar()
        let s = ServidorLocal(nome: nome, porta: porta)
        s.aoReceber = { [weak self] de, pacote in self?.emitirPacote(de, pacote) }
        s.aoVizinho = { [weak self] id, presente in self?.emitirVizinho(id, presente) }
        do {
            try s.iniciar()
            servidor = s
            let enderecos = RedeLocalPlugin.enderecosLocais().map { "http://\($0):\(porta)/" }
            call.resolve(["porta": Int(porta), "enderecos": enderecos])
        } catch {
            call.reject("não deu para abrir a porta \(porta): \(error.localizedDescription)")
        }
    }

    @objc func pararServidor(_ call: CAPPluginCall) {
        servidor?.parar()
        servidor = nil
        call.resolve()
    }

    @objc func descobrir(_ call: CAPPluginCall) {
        navegador?.cancel()
        let b = NWBrowser(for: .bonjour(type: Moldura.servicoBonjour, domain: nil), using: .tcp)
        b.browseResultsChangedHandler = { [weak self] resultados, _ in
            for r in resultados { self?.resolver(r.endpoint) }
        }
        b.start(queue: .main)
        navegador = b
        call.resolve()
    }

    /// Bonjour dá o nome do serviço; uma conexão rápida revela o endereço e a porta.
    private func resolver(_ ponto: NWEndpoint) {
        guard case let .service(nome, _, _, _) = ponto else { return }
        let c = NWConnection(to: ponto, using: .tcp)
        resolucoes.append(c)
        c.stateUpdateHandler = { [weak self] estado in
            if case .ready = estado, let remoto = c.currentPath?.remoteEndpoint, case let .hostPort(host, porta) = remoto {
                var texto = "\(host)"
                if let i = texto.firstIndex(of: "%") { texto = String(texto[..<i]) }
                self?.notifyListeners("servidor", data: ["nome": nome, "host": texto, "porta": Int(porta.rawValue)])
                c.cancel()
            } else if case .failed = estado {
                c.cancel()
            }
        }
        c.start(queue: .main)
    }

    @objc func pararDescoberta(_ call: CAPPluginCall) {
        navegador?.cancel()
        navegador = nil
        for c in resolucoes { c.cancel() }
        resolucoes.removeAll()
        call.resolve()
    }

    @objc func conectar(_ call: CAPPluginCall) {
        guard let texto = call.getString("url"), let url = URL(string: texto) else {
            call.reject("faltou url")
            return
        }
        servidor?.parar()
        servidor = nil
        desconectarCliente()
        let t = URLSession.shared.webSocketTask(with: url)
        tarefa = t
        t.resume()
        receber(t)
        call.resolve()
    }

    private func receber(_ t: URLSessionWebSocketTask) {
        t.receive { [weak self] resultado in
            guard let self = self, self.tarefa === t else { return }
            switch resultado {
            case .failure:
                for id in self.conhecidos { self.emitirVizinho(id, false) }
                self.conhecidos.removeAll()
                self.notifyListeners("conexao", data: ["conectado": false])
                return
            case let .success(.data(dados)):
                if case let (de, pacote)? = Moldura.desemoldurar(dados) { self.emitirPacote(de, pacote) }
            case let .success(.string(texto)):
                self.controle(texto)
            case .success:
                break
            }
            self.receber(t)
        }
    }

    private func controle(_ texto: String) {
        guard let dados = texto.data(using: .utf8),
              let m = try? JSONSerialization.jsonObject(with: dados) as? [String: Any],
              let tipo = m["tipo"] as? String, let id = m["id"] as? String
        else { return }
        if tipo == "boas-vindas" {
            meuId = id
            notifyListeners("conexao", data: ["conectado": true])
        } else if tipo == "vizinho", id != meuId {
            let presente = (m["presente"] as? Bool) ?? false
            if presente { conhecidos.insert(id) } else { conhecidos.remove(id) }
            emitirVizinho(id, presente)
        }
    }

    @objc func desconectar(_ call: CAPPluginCall) {
        desconectarCliente()
        call.resolve()
    }

    private func desconectarCliente() {
        tarefa?.cancel(with: .normalClosure, reason: nil)
        tarefa = nil
    }

    @objc func criarHotspot(_ call: CAPPluginCall) {
        call.reject("no iPhone, ligue o Compartilhamento de Internet nos Ajustes e depois toque em Virar servidor")
    }

    @objc func pararHotspot(_ call: CAPPluginCall) {
        call.resolve()
    }

    private func pararTudo() {
        servidor?.parar()
        servidor = nil
        desconectarCliente()
        navegador?.cancel()
        navegador = nil
    }

    /// Endereços IPv4 do Wi-Fi (en0) e do Compartilhamento de Internet (bridge100).
    static func enderecosLocais() -> [String] {
        var lista: [String] = []
        var cabeca: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&cabeca) == 0, let primeiro = cabeca else { return lista }
        defer { freeifaddrs(cabeca) }
        for ponteiro in sequence(first: primeiro, next: { $0.pointee.ifa_next }) {
            let i = ponteiro.pointee
            guard let endereco = i.ifa_addr, endereco.pointee.sa_family == UInt8(AF_INET) else { continue }
            let nome = String(cString: i.ifa_name)
            guard nome.hasPrefix("en") || nome.hasPrefix("bridge") else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            if getnameinfo(endereco, socklen_t(endereco.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 {
                lista.append(String(cString: host))
            }
        }
        return lista
    }
}
