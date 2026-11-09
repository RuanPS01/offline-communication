import Foundation
import Network

/// Servidor da rede local no iPhone: HTTP na porta principal (serve a PWA do
/// pacote do app e /api/info) e WebSocket na porta seguinte. Anuncia-se por
/// Bonjour como "_sobrevivencia._tcp". O próprio aparelho é o nó "servidor".
final class ServidorLocal {
    private let fila = DispatchQueue(label: "servidor-local")
    private let nome: String
    let porta: UInt16
    private var http: NWListener?
    private var ws: NWListener?
    private var clientes: [String: NWConnection] = [:]
    private var proximoId = 1
    var aoReceber: ((String, Data) -> Void)?
    var aoVizinho: ((String, Bool) -> Void)?

    init(nome: String, porta: UInt16) {
        self.nome = nome
        self.porta = porta
    }

    func iniciar() throws {
        guard let portaHttp = NWEndpoint.Port(rawValue: porta), let portaWs = NWEndpoint.Port(rawValue: porta + 1) else {
            throw NSError(domain: "ServidorLocal", code: 1, userInfo: [NSLocalizedDescriptionKey: "porta inválida"])
        }
        let h = try NWListener(using: .tcp, on: portaHttp)
        h.service = NWListener.Service(name: nome, type: Moldura.servicoBonjour)
        h.newConnectionHandler = { [weak self] c in self?.atenderHttp(c) }
        h.start(queue: fila)
        http = h

        let parametros = NWParameters.tcp
        let opcoes = NWProtocolWebSocket.Options()
        opcoes.autoReplyPing = true
        parametros.defaultProtocolStack.applicationProtocols.insert(opcoes, at: 0)
        let w = try NWListener(using: parametros, on: portaWs)
        w.newConnectionHandler = { [weak self] c in self?.atenderWebSocket(c) }
        w.start(queue: fila)
        ws = w
    }

    func parar() {
        fila.async {
            for c in self.clientes.values { c.cancel() }
            self.clientes.removeAll()
            self.http?.cancel()
            self.ws?.cancel()
        }
    }

    /// Pacote do núcleo deste aparelho para um cliente ou todos.
    func enviar(_ pacote: Data, destino: String?) {
        fila.async {
            let saida = Moldura.emoldurar("servidor", pacote)
            if let d = destino {
                if let c = self.clientes[d] { self.enviarBinario(c, saida) }
            } else {
                for c in self.clientes.values { self.enviarBinario(c, saida) }
            }
        }
    }

    // MARK: HTTP

    private func atenderHttp(_ c: NWConnection) {
        c.start(queue: fila)
        c.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] dados, _, _, _ in
            guard let self = self, let dados = dados, let pedido = String(data: dados, encoding: .utf8) else {
                c.cancel()
                return
            }
            let linha = pedido.split(separator: "\r\n").first ?? ""
            let partes = linha.split(separator: " ")
            var caminho = partes.count > 1 ? String(partes[1]) : "/"
            if let q = caminho.firstIndex(of: "?") { caminho = String(caminho[..<q]) }
            let (status, tipo, corpo) = self.responder(caminho)
            var cabecalho = "HTTP/1.1 \(status)\r\nContent-Type: \(tipo)\r\nContent-Length: \(corpo.count)\r\n"
            cabecalho += "Cache-Control: no-store\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n"
            var resposta = Data(cabecalho.utf8)
            resposta.append(corpo)
            c.send(content: resposta, completion: .contentProcessed { _ in c.cancel() })
        }
    }

    private func responder(_ caminho: String) -> (String, String, Data) {
        if caminho == "/api/info" {
            let info: [String: Any] = [
                "servico": Moldura.nomeServico, "versao": 1, "nome": nome,
                "wsCaminho": "/", "wsPorta": Int(porta) + 1, "clientes": clientes.count,
            ]
            let json = (try? JSONSerialization.data(withJSONObject: info)) ?? Data()
            return ("200 OK", "application/json; charset=utf-8", json)
        }
        guard let pasta = Bundle.main.url(forResource: "public", withExtension: nil) else {
            return ("500 Internal Server Error", "text/plain", Data("sem arquivos".utf8))
        }
        var relativo = caminho.removingPercentEncoding ?? caminho
        relativo = relativo.replacingOccurrences(of: "..", with: "")
        while relativo.hasPrefix("/") { relativo.removeFirst() }
        var arquivo = pasta.appendingPathComponent(relativo)
        var ehPasta: ObjCBool = false
        if relativo.isEmpty || !FileManager.default.fileExists(atPath: arquivo.path, isDirectory: &ehPasta) || ehPasta.boolValue {
            arquivo = pasta.appendingPathComponent("index.html")
        }
        guard let corpo = try? Data(contentsOf: arquivo) else {
            return ("404 Not Found", "text/plain", Data("não encontrado".utf8))
        }
        return ("200 OK", ServidorLocal.tipo(arquivo.pathExtension), corpo)
    }

    private static func tipo(_ extensao: String) -> String {
        switch extensao {
        case "html": return "text/html; charset=utf-8"
        case "js", "mjs": return "text/javascript; charset=utf-8"
        case "css": return "text/css; charset=utf-8"
        case "json": return "application/json; charset=utf-8"
        case "webmanifest": return "application/manifest+json"
        case "svg": return "image/svg+xml"
        case "png": return "image/png"
        case "wasm": return "application/wasm"
        default: return "application/octet-stream"
        }
    }

    // MARK: WebSocket

    private func atenderWebSocket(_ c: NWConnection) {
        let id = "c\(proximoId)"
        proximoId += 1
        c.stateUpdateHandler = { [weak self] estado in
            guard let self = self else { return }
            switch estado {
            case .ready:
                self.clientes[id] = c
                self.enviarJson(c, ["tipo": "boas-vindas", "id": id, "nome": self.nome])
                self.enviarJson(c, ["tipo": "vizinho", "id": "servidor", "presente": true])
                for (outroId, outro) in self.clientes where outroId != id {
                    self.enviarJson(outro, ["tipo": "vizinho", "id": id, "presente": true])
                    self.enviarJson(c, ["tipo": "vizinho", "id": outroId, "presente": true])
                }
                self.aoVizinho?(id, true)
                self.receber(c, id: id)
            case .failed, .cancelled:
                if self.clientes.removeValue(forKey: id) != nil {
                    for outro in self.clientes.values { self.enviarJson(outro, ["tipo": "vizinho", "id": id, "presente": false]) }
                    self.aoVizinho?(id, false)
                }
            default:
                break
            }
        }
        c.start(queue: fila)
    }

    private func receber(_ c: NWConnection, id: String) {
        c.receiveMessage { [weak self] dados, contexto, _, erro in
            guard let self = self else { return }
            if erro != nil {
                c.cancel()
                return
            }
            let meta = contexto?.protocolMetadata(definition: NWProtocolWebSocket.definition) as? NWProtocolWebSocket.Metadata
            if meta?.opcode == .binary, let dados = dados, case let (destino, pacote)? = Moldura.desemoldurar(dados) {
                let saida = Moldura.emoldurar(id, pacote)
                if destino == "servidor" {
                    self.aoReceber?(id, pacote)
                } else if !destino.isEmpty {
                    if let alvo = self.clientes[destino] { self.enviarBinario(alvo, saida) }
                } else {
                    for (outroId, outro) in self.clientes where outroId != id { self.enviarBinario(outro, saida) }
                    self.aoReceber?(id, pacote)
                }
            }
            if meta?.opcode == .close {
                c.cancel()
                return
            }
            self.receber(c, id: id)
        }
    }

    private func enviarBinario(_ c: NWConnection, _ dados: Data) {
        let meta = NWProtocolWebSocket.Metadata(opcode: .binary)
        let contexto = NWConnection.ContentContext(identifier: "binario", metadata: [meta])
        c.send(content: dados, contentContext: contexto, isComplete: true, completion: .contentProcessed { _ in })
    }

    private func enviarJson(_ c: NWConnection, _ objeto: [String: Any]) {
        guard let dados = try? JSONSerialization.data(withJSONObject: objeto) else { return }
        let meta = NWProtocolWebSocket.Metadata(opcode: .text)
        let contexto = NWConnection.ContentContext(identifier: "texto", metadata: [meta])
        c.send(content: dados, contentContext: contexto, isComplete: true, completion: .contentProcessed { _ in })
    }
}
