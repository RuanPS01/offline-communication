# Testes de campo

Uma ferramenta de sobrevivência só vale se foi testada fora do laboratório.
Cada canal precisa de medição em campo aberto e dentro de prédio: alcance
real, latência, taxa de perda e consumo de bateria por hora.

## Modo teste de campo (no app)

Em Perfil, Teste de campo:

1. Um aparelho toca em "Começar a enviar" (intervalo de 10 s, por exemplo).
   Ele manda mensagens numeradas com o horário de envio.
2. Os outros registram cada mensagem recebida: origem, número, horário de
   envio e de chegada, canal, saltos e posição (se o GPS estiver ligado).
   Essas mensagens não aparecem na conversa.
3. O resumo mostra recebidas, perdidas (buracos na numeração) e atraso
   mediano. "Exportar CSV" baixa os registros para análise.

Os relógios dos aparelhos precisam estar acertados para o atraso fazer
sentido (sincronize com a rede antes de sair).

## Roteiro por fase

| Fase | Critério de saída | Como medir |
| --- | --- | --- |
| 1 | uma mensagem com TTL atravessa três nós simulados | `npm test` (`nucleo/test/nucleo.test.ts`) |
| 2 | dois celulares (um iPhone) trocam texto por som e por QR só pela página | `npm run e2e` valida no Chromium; em campo, um Android e um iPhone abrindo a página do Pages, a 1, 2 e 4 m, em silêncio e com ruído |
| 3 | 5 Androids no mesmo canal de voz por 1 hora, com radar | modo rádio ligado nos 5, teste de campo a cada 30 s, falas de 10 s a cada 5 min; anotar bateria no início e no fim |
| 4 | um celular serve, três clientes (incluindo PWA) conversam pela rede local | `npm run e2e` valida o fluxo; em campo, Android com hotspot e três clientes, um deles só com o navegador |
| 5 | Android e iPhone no mesmo canal, instalados pela página | BLE entre os dois, a 5, 15 e 30 m, com e sem paredes |

## Planilha por canal

| Canal | Ambiente | Distância | Enviadas | Recebidas | Perda | Atraso mediano | Bateria por hora |
| --- | --- | --- | --- | --- | --- | --- | --- |
| som audível | sala silenciosa | 1 m | | | | | |
| som audível | rua | 2 m | | | | | |
| som ultrassom | sala | 1 m | | | | | |
| QR frente a frente | interno | 30 cm | | | | | |
| luz (lanterna) | noite, ao ar livre | 50 m | | | | | |
| BLE | campo aberto | 30 m | | | | | |
| BLE | prédio, 1 parede | 15 m | | | | | |
| Wi-Fi P2P | campo aberto | 60 m | | | | | |
| rede local (hotspot) | interno | 20 m | | | | | |
| LoRa | campo aberto | 1 km | | | | | |

## Riscos técnicos e o que já está no código

| Risco | Mitigação no código | O que o campo precisa confirmar |
| --- | --- | --- |
| iPhone em segundo plano some no BLE | modo rádio com tela ativa; Multipeer entre iPhones; modos de Bluetooth em segundo plano declarados | quanto tempo a malha aguenta com o iPhone bloqueado |
| Banda baixa do BLE para voz | Opus a 12 kbps quando todos decodificam, ADPCM de reserva; voz ao vivo só até 2 saltos, depois vira mensagem gravada | qualidade da voz a 1 e 2 saltos |
| Som falha em alguns aparelhos | faixa audível e ultrassom configuráveis; escalonamento automático para o QR | quais modelos falham em cada faixa |
| Lanterna não controlável na web (iOS) | emissão pela lanterna nativa no app; na PWA, tela piscando; recepção pela câmera em todos | alcance da tela piscando à noite |
| Fragmentação Android (Wi-Fi Aware, UWB) | capacidades detectadas em tempo de execução; Nearby escolhe o meio sozinho | aparelhos sem Play Services (usam BLE e rede local) |
| Bateria com rádio sempre escaneando | presença a cada 10 s, varredura BLE só com o canal ligado | consumo por hora em cada canal; ajustar intervalos |
| Limite de 100 iPhones ad hoc | PWA como piso universal; código de convite no cadastro | |
| Congestionamento da malha | TTL 4 (presença 3), deduplicação, atraso aleatório antes de repetir, cobertura por custo para não repetir pelo mesmo vizinho em dois canais | perda com 10 ou mais aparelhos juntos |
