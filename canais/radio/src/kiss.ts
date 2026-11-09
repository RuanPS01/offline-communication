/**
 * Enquadramento KISS (o mesmo dos TNCs de rádio amador). Separa pacotes num
 * fluxo de bytes serial: FEND delimita, FESC escapa.
 */

export const FEND = 0xc0;
export const FESC = 0xdb;
export const TFEND = 0xdc;
export const TFESC = 0xdd;
export const CMD_DADOS = 0x00;

export function codificarKiss(dados: Uint8Array, porta = 0): Uint8Array {
  const saida: number[] = [FEND, ((porta & 0x0f) << 4) | CMD_DADOS];
  for (const b of dados) {
    if (b === FEND) saida.push(FESC, TFEND);
    else if (b === FESC) saida.push(FESC, TFESC);
    else saida.push(b);
  }
  saida.push(FEND);
  return Uint8Array.from(saida);
}

/** Decodificador incremental: alimente com pedaços do fluxo e receba pacotes inteiros. */
export class DecodificadorKiss {
  private atual: number[] = [];
  private escapando = false;
  private dentro = false;

  constructor(
    private readonly aoPacote: (dados: Uint8Array, porta: number) => void,
    private readonly tamanhoMaximo = 1024,
  ) {}

  alimentar(pedaco: Uint8Array): void {
    for (const b of pedaco) {
      if (b === FEND) {
        if (this.dentro && this.atual.length > 1) {
          const cmd = this.atual[0]!;
          if ((cmd & 0x0f) === CMD_DADOS) this.aoPacote(Uint8Array.from(this.atual.slice(1)), cmd >> 4);
        }
        this.atual = [];
        this.escapando = false;
        this.dentro = true;
        continue;
      }
      if (!this.dentro) continue;
      if (this.escapando) {
        this.atual.push(b === TFEND ? FEND : b === TFESC ? FESC : b);
        this.escapando = false;
      } else if (b === FESC) {
        this.escapando = true;
      } else {
        this.atual.push(b);
      }
      if (this.atual.length > this.tamanhoMaximo) {
        this.atual = [];
        this.dentro = false;
      }
    }
  }
}
