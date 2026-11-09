import Foundation

/// Protocolo da rede local (o mesmo do servidor Node, do Android e do cliente web).
enum Moldura {
    static let servicoBonjour = "_sobrevivencia._tcp"
    static let nomeServico = "sobrevivencia"

    static func emoldurar(_ id: String, _ pacote: Data) -> Data {
        let idBytes = Data(id.utf8.prefix(255))
        var saida = Data([UInt8(idBytes.count)])
        saida.append(idBytes)
        saida.append(pacote)
        return saida
    }

    static func desemoldurar(_ quadro: Data) -> (String, Data)? {
        guard let n = quadro.first.map(Int.init), quadro.count >= 1 + n else { return nil }
        let inicio = quadro.startIndex
        let id = String(decoding: quadro[(inicio + 1)..<(inicio + 1 + n)], as: UTF8.self)
        return (id, Data(quadro[(inicio + 1 + n)...]))
    }
}
