# Firmware do módulo de rádio LoRa

O celular não tem rádio LoRa. Este firmware transforma um ESP32 com rádio
SX1276/SX1278 (TTGO LoRa32, Heltec WiFi LoRa 32 e similares, cerca de
R$ 100) numa ponte: Bluetooth (UART da Nordic) de um lado, LoRa do outro.

## Gravação

1. Instale a IDE do Arduino e o pacote de placas ESP32.
2. Instale a biblioteca "LoRa" de Sandeep Mistry.
3. Abra `modulo-lora/modulo-lora.ino`, ajuste os pinos e a frequência
   (915 MHz no Brasil) e grave.

## Uso

- No app Android ou iOS: Canais, Rádio LoRa, Conectar.
- Na web (Chrome no Android ou no computador): o mesmo botão abre o
  seletor de dispositivos Bluetooth.

## Limites

- Pacotes de até 255 bytes (o núcleo fragmenta com MTU de 200).
- Tempo no ar de cerca de 0,2 a 0,5 s por pacote com SF9: bom para texto e
  presença a quilômetros, não para voz.
- Respeite as regras de uso da faixa ISM do seu país (ciclo de trabalho e
  potência).
