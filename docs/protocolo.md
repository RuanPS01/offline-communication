# Protocolo

Tudo o que atravessa um canal é um **pacote** no formato abaixo, igual em
todos os meios. Exceção: os canais Morse (luz e som), que levam só texto
legível por humanos.

## Pacote

| Bytes | Campo | Observação |
| --- | --- | --- |
| 0 | versão (4 bits) e tipo (4 bits) | versão atual: 1 |
| 1 | flags | ver abaixo |
| 2 | ttl (4 bits) e saltos (4 bits) | ttl padrão 4; presença usa 3 |
| 3 a 8 | id da mensagem | 6 bytes aleatórios |
| 9 a 14 | origem | 6 primeiros bytes do SHA-256 da chave pública Ed25519 |
| 15 a 18 | carimbo | segundos desde 1970, uint32 |
| 6 bytes | alvo | só com a flag TEM_ALVO: canal de conversa ou nó |
| resto | carga útil | |
| 64 bytes | assinatura Ed25519 | só com a flag ASSINADO |

Cabeçalho mínimo: 19 bytes. Um texto curto assinado cabe numa transmissão de
som (140 bytes).

Flags: `0x01` assinado, `0x02` cifrado, `0x04` tem alvo, `0x08` o alvo é um
nó (conversa privada; sem ela, o alvo é um canal de conversa), `0x10` pede
confirmação de entrega.

A assinatura cobre o pacote com ttl e saltos zerados, porque esses dois
campos mudam a cada retransmissão.

Tipos: `0` presença, `1` texto, `2` início de fala, `3` fim de fala, `4`
quadro de voz, `5` mensagem de voz, `6` confirmação, `7` fragmento.

## Malha

- **Deduplicação:** a chave é `origem:id`; quem já viu descarta. Ouvir a
  própria mensagem voltando (eco) marca a mensagem como "ouvida".
- **TTL:** quem recebe e ainda não viu retransmite com ttl - 1 e
  saltos + 1, enquanto ttl - 1 > 0, após um atraso aleatório de 20 a 250 ms.
- **Meio único:** canais em que um envio alcança todos (servidor de rede
  local) não repetem no mesmo canal.
- **Voz ao vivo:** quadros só são retransmitidos ao vivo enquanto
  saltos + 1 < 2. No segundo salto, o nó acumula a fala e, no fim, gera uma
  mensagem de voz (tipo 5) que segue pela malha com store-and-forward.
- **Fragmentos:** acima da MTU do canal, o pacote codificado é quebrado em
  pacotes do tipo 7 com o mesmo id e origem; a carga leva índice (uint16),
  total (uint16) e o pedaço. Cada salto remonta e refragmenta conforme o
  canal de saída.

## Roteamento

Para cada pacote, o roteador escolhe canais pelas capacidades:

- voz ao vivo: só canais `aoVivo` com vizinhos, preferindo maior vazão;
- privado para alguém ao alcance direto: o canal mais barato que chega nele;
- o resto: cobertura gulosa por custo (cada vizinho recebe pelo canal mais
  barato que o alcança);
- importante: todos os canais automáticos ao mesmo tempo;
- ninguém por perto: o canal automático mais barato, e o pacote fica na fila.

Sem eco nem confirmação em 8 s, a mensagem sai pelo próximo canal ainda não
usado (automáticos primeiro, depois os que exigem gesto, como o QR).

## Fila store-and-forward

Mensagens de texto e de voz ficam guardadas (próprias: 24 h se privadas, 2 h
se de canal; de outros: 30 min) e são entregues a cada vizinho novo que
aparece num canal rápido, lembrando a quem já foram entregues. Uma
confirmação (tipo 6) remove a mensagem da fila de quem a carregava.

## Presença

Carga: chave pública (32), flags (1: tem posição, Opus, falando, tem
bateria), canais acessíveis (uint16, um bit por canal na ordem ble, wifi,
rede-local, som, qr, luz, som-morse, nfc, radio), bateria (opcional, 1),
apelido (até 24 bytes), canal de conversa público (até 16 bytes) e posição
opcional (lat e lon em 1e-7 graus, int32; precisão em metros, uint16).

A presença não é assinada: o id do nó é derivado da chave pública que ela
carrega, e quem recebe confere essa ligação.

## Cripto

- Identidade efêmera: um par Ed25519 novo a cada abertura do app.
- Canal privado: chave AES-256 por PBKDF2-SHA256 (60 mil iterações) da
  senha, com sal `canal-privado:<nome>`; o id do canal é um HMAC dessa chave,
  então quem não tem a senha não descobre o nome.
- Conversa privada: X25519 entre as duas identidades (convertidas de
  Ed25519), HKDF-SHA256 e AES-GCM.
- AES-GCM com nonce aleatório de 12 bytes; os dados autenticados amarram a
  carga ao tipo, id, origem, alvo e carimbo.

## Voz

Quadros de 60 ms. Carga do quadro: sessão (uint16), sequência (uint16),
codec (1 = IMA ADPCM 8 kHz, 2 = Opus 48 kHz, 3 = Codec2 reservado) e áudio.
Mensagem de voz: falante (6), sessão, codec, duração do quadro em ms, número
de quadros e, para cada um, sequência, tamanho e bytes.

## Canais: enquadramento próprio

| Canal | Formato |
| --- | --- |
| Som | pacote cru, até 140 bytes por transmissão ggwave a 48 kHz |
| QR | texto `OC1:` seguido do pacote em Base45 (modo alfanumérico do QR) |
| Rede local | WebSocket binário: `[n][id ASCII][pacote]`; controle em JSON |
| BLE | GATT `6f63616d-0001-...`, característica `...0002-...`; pedaços com cabeçalho de 1 byte (bit 7 primeiro, bit 6 último, 6 bits de número) |
| NFC | APDUs: SELECT AID `F0534F42524556`, `80 10` entrega um pacote, `80 20` pede o próximo |
| Rádio LoRa | quadros KISS sobre o UART BLE da Nordic |
| Luz e som Morse | texto em código Morse internacional, ponto de 200 ms (luz) ou 70 ms (som) |

### Rede local

- `GET /api/info` responde `{"servico":"sobrevivencia","versao":1,"nome":...,"wsCaminho":"/ws"}`
  e, quando o WebSocket está em outra porta (iPhone), `"wsPorta"`.
- Anúncio mDNS: `_sobrevivencia._tcp`.
- Mensagens de controle: `{"tipo":"boas-vindas","id":"c3"}` e
  `{"tipo":"vizinho","id":"c5","presente":true}`. O próprio aparelho que
  serve aparece como o vizinho `servidor`.
