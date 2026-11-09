/**
 * Contrato de canal. Todo meio de comunicação (BLE, Wi-Fi, som, luz, QR,
 * NFC, rádio...) é um plugin que implementa esta interface. O núcleo trata
 * todos do mesmo jeito e decide o uso de cada um olhando as `capacidades`.
 *
 * Canal novo = uma classe nova que cumpre este contrato, registrada no
 * núcleo com `nucleo.registrarCanal(canal)`. Nada mais muda.
 */

/** Identificadores conhecidos. Um plugin novo pode usar qualquer outro texto. */
export type IdCanal =
  | 'ble'
  | 'wifi'
  | 'rede-local'
  | 'som'
  | 'qr'
  | 'luz'
  | 'som-morse'
  | 'nfc'
  | 'radio'
  | 'memoria'
  | (string & {});

export interface Capacidades {
  /** Vazão útil aproximada. */
  bytesPorSegundo: number;
  /** Serve para voz em tempo real? */
  aoVivo: boolean;
  /** Envia e recebe (falso para canais só de escuta, como a PWA recebendo luz). */
  bidirecional: boolean;
  /** Alcance típico, para estimar distância no radar. */
  alcanceMetros: number;
  /** Maior pacote que o canal leva de uma vez. Acima disso o núcleo fragmenta. */
  mtu: number;
  /**
   * Custo relativo de usar o canal (energia, ruído, incômodo). Quanto menor,
   * mais "barato". O roteador prefere os canais baratos.
   */
  custo?: number;
  /** Exige gesto do usuário (mirar a câmera, encostar os celulares). */
  exigeAcao?: boolean;
  /**
   * Um único envio alcança todos os vizinhos do canal (ex.: rede local com
   * servidor central). O núcleo não repete no mesmo canal ao retransmitir.
   */
  meioUnico?: boolean;
  /**
   * O canal transporta só texto legível por humanos (Morse). O núcleo entrega
   * o texto puro em UTF-8 em vez de um pacote binário.
   */
  somenteTexto?: boolean;
}

/** Alguém percebido por perto num canal. */
export interface Vizinho {
  /** Identificador do vizinho dentro do canal (endereço BLE, endpoint, cliente...). */
  idLocal: string;
  /** Id do nó, quando o canal já sabe. Normalmente o núcleo descobre pela presença. */
  idNo?: string;
  /** Intensidade do sinal, em dBm, quando o rádio informa. */
  rssi?: number;
  /** Distância medida (Wi-Fi RTT, UWB), quando existe. */
  distanciaMetros?: number;
  /** Falso quando o vizinho saiu de alcance. */
  presente: boolean;
}

/** Chamado pelo canal ao receber bytes. `origemLocal` é o idLocal de quem mandou, se o canal souber. */
export type AoReceberPacote = (dados: Uint8Array, origemLocal?: string) => void;

/** Chamado pelo canal quando alguém aparece ou some. */
export type AoMudarVizinho = (vizinho: Vizinho) => void;

export interface Canal {
  /** "ble", "som", "qr", "rede-local"... */
  readonly id: IdCanal;
  /** Nome para mostrar na interface. */
  readonly nome: string;
  readonly capacidades: Capacidades;
  /** O aparelho tem o hardware e a permissão? */
  disponivel(): Promise<boolean>;
  /** Começa a escutar; chama de volta ao receber pacotes e ao perceber vizinhos. */
  iniciar(onPacote: AoReceberPacote, onVizinho: AoMudarVizinho): Promise<void>;
  /** Divulga quem eu sou (pacote de presença já codificado). */
  anunciar(presenca: Uint8Array): Promise<void>;
  /** Manda bytes. Destino vazio = todos ao redor. */
  enviar(pacote: Uint8Array, destino?: string): Promise<void>;
  parar(): Promise<void>;
}

/** Ordem dos bits do campo "canais acessíveis" do pacote de presença. */
export const BITS_DE_CANAL: readonly IdCanal[] = [
  'ble',
  'wifi',
  'rede-local',
  'som',
  'qr',
  'luz',
  'som-morse',
  'nfc',
  'radio',
];

export function custoDoCanal(c: Capacidades): number {
  return c.custo ?? 5;
}
