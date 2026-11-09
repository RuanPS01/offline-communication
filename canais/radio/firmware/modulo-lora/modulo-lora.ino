// Módulo de rádio LoRa da plataforma de comunicação offline.
//
// Placa: ESP32 com rádio SX1276/SX1278 (ex.: TTGO LoRa32, Heltec WiFi LoRa 32 V2).
// Bibliotecas (Gerenciador de Bibliotecas do Arduino):
//   - "LoRa" de Sandeep Mistry
//   - BLE do próprio pacote de placas ESP32
//
// O celular conecta por Bluetooth no serviço UART da Nordic (NUS) e escreve
// quadros KISS. Cada quadro completo vira um pacote LoRa. Cada pacote LoRa
// recebido volta ao celular como quadro KISS, por notificação.
// O módulo não entende o protocolo da plataforma: só move bytes.

#include <BLE2902.h>
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <LoRa.h>
#include <SPI.h>

// Pinos do TTGO LoRa32 V1/V2. Ajuste para a sua placa.
#define PINO_SCK 5
#define PINO_MISO 19
#define PINO_MOSI 27
#define PINO_SS 18
#define PINO_RST 14
#define PINO_DIO0 26

// 915 MHz no Brasil (faixa ISM). Use 868E6 na Europa e 433E6 onde for permitido.
#define FREQUENCIA 915E6

#define UUID_NUS "6e400001-b5a3-f393-e0a9-e50e24dcca9e"
#define UUID_NUS_RX "6e400002-b5a3-f393-e0a9-e50e24dcca9e"
#define UUID_NUS_TX "6e400003-b5a3-f393-e0a9-e50e24dcca9e"

#define FEND 0xC0
#define FESC 0xDB
#define TFEND 0xDC
#define TFESC 0xDD
#define TAM_MAXIMO 255

BLECharacteristic *caracteristicaTx = nullptr;
bool celularConectado = false;

uint8_t quadro[TAM_MAXIMO + 1];
size_t tamQuadro = 0;
bool escapando = false;
bool dentroDoQuadro = false;

void enviarAoCelular(const uint8_t *dados, size_t n) {
  if (!celularConectado || caracteristicaTx == nullptr) return;
  uint8_t saida[2 * TAM_MAXIMO + 4];
  size_t k = 0;
  saida[k++] = FEND;
  saida[k++] = 0x00;
  for (size_t i = 0; i < n; i++) {
    if (dados[i] == FEND) { saida[k++] = FESC; saida[k++] = TFEND; }
    else if (dados[i] == FESC) { saida[k++] = FESC; saida[k++] = TFESC; }
    else saida[k++] = dados[i];
  }
  saida[k++] = FEND;
  // Notificações em pedaços de 20 bytes (MTU mínima).
  for (size_t i = 0; i < k; i += 20) {
    size_t parte = (k - i) < 20 ? (k - i) : 20;
    caracteristicaTx->setValue(saida + i, parte);
    caracteristicaTx->notify();
    delay(4);
  }
}

void transmitirLoRa(const uint8_t *dados, size_t n) {
  LoRa.beginPacket();
  LoRa.write(dados, n);
  LoRa.endPacket();
  LoRa.receive();
}

void alimentarKiss(uint8_t b) {
  if (b == FEND) {
    // Primeiro byte do quadro é o comando (0x00 = dados).
    if (dentroDoQuadro && tamQuadro > 1 && (quadro[0] & 0x0F) == 0x00) {
      transmitirLoRa(quadro + 1, tamQuadro - 1);
    }
    tamQuadro = 0;
    escapando = false;
    dentroDoQuadro = true;
    return;
  }
  if (!dentroDoQuadro) return;
  if (escapando) {
    b = (b == TFEND) ? FEND : (b == TFESC) ? FESC : b;
    escapando = false;
  } else if (b == FESC) {
    escapando = true;
    return;
  }
  if (tamQuadro < sizeof(quadro)) quadro[tamQuadro++] = b;
  else dentroDoQuadro = false;
}

class AoConectar : public BLEServerCallbacks {
  void onConnect(BLEServer *) override { celularConectado = true; }
  void onDisconnect(BLEServer *servidor) override {
    celularConectado = false;
    servidor->getAdvertising()->start();
  }
};

class AoEscrever : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic *c) override {
    String valor = c->getValue();
    for (size_t i = 0; i < valor.length(); i++) alimentarKiss((uint8_t)valor[i]);
  }
};

void setup() {
  Serial.begin(115200);
  SPI.begin(PINO_SCK, PINO_MISO, PINO_MOSI, PINO_SS);
  LoRa.setPins(PINO_SS, PINO_RST, PINO_DIO0);
  if (!LoRa.begin(FREQUENCIA)) {
    Serial.println("Falha ao iniciar o rádio LoRa");
    while (true) delay(1000);
  }
  // Fator de espalhamento 9 e 125 kHz: equilíbrio entre alcance e tempo no ar.
  LoRa.setSpreadingFactor(9);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.enableCrc();
  LoRa.receive();

  BLEDevice::init("Radio LoRa Offline");
  BLEServer *servidor = BLEDevice::createServer();
  servidor->setCallbacks(new AoConectar());
  BLEService *servico = servidor->createService(UUID_NUS);
  caracteristicaTx = servico->createCharacteristic(UUID_NUS_TX, BLECharacteristic::PROPERTY_NOTIFY);
  caracteristicaTx->addDescriptor(new BLE2902());
  BLECharacteristic *rx = servico->createCharacteristic(
      UUID_NUS_RX, BLECharacteristic::PROPERTY_WRITE | BLECharacteristic::PROPERTY_WRITE_NR);
  rx->setCallbacks(new AoEscrever());
  servico->start();
  servidor->getAdvertising()->addServiceUUID(UUID_NUS);
  servidor->getAdvertising()->start();
  Serial.println("Módulo LoRa pronto");
}

void loop() {
  int tamanho = LoRa.parsePacket();
  if (tamanho > 0 && tamanho <= TAM_MAXIMO) {
    uint8_t dados[TAM_MAXIMO];
    size_t n = 0;
    while (LoRa.available() && n < sizeof(dados)) dados[n++] = (uint8_t)LoRa.read();
    enviarAoCelular(dados, n);
  }
  delay(2);
}
