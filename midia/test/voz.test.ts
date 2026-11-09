import { MeioSimulado } from '@plataforma/canal-memoria';
import { Nucleo } from '@plataforma/nucleo';
import { afterEach, describe, expect, it } from 'vitest';
import { type FonteAudio, type OpcoesCaptura, type SaidaAudio, Voz } from '../src/index.ts';

class FonteFalsa implements FonteAudio {
  private t?: ReturnType<typeof setInterval>;
  async iniciar(o: OpcoesCaptura): Promise<void> {
    let n = 0;
    this.t = setInterval(() => {
      const pcm = Float32Array.from({ length: o.amostrasPorQuadro }, (_, i) => 0.3 * Math.sin((i + n) / 5));
      n += o.amostrasPorQuadro;
      o.aoQuadro(pcm);
    }, 5);
  }
  async parar(): Promise<void> {
    clearInterval(this.t);
  }
}

class SaidaFalsa implements SaidaAudio {
  amostras = 0;
  agendar(pcm: Float32Array): void {
    this.amostras += pcm.length;
  }
  get folga(): number {
    return 0;
  }
}

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const limpar: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const f of limpar.splice(0)) await f();
});

async function dupla() {
  const meio = new MeioSimulado();
  const criar = async (nome: string) => {
    const n = new Nucleo({ apelido: nome, atrasoRepasseMs: [0, 0], intervaloPresencaMs: 60_000 });
    n.registrarCanal(meio.criarCanal(nome));
    const saida = new SaidaFalsa();
    const v = new Voz(n, { criarFonte: () => new FonteFalsa(), saida });
    await v.preparar();
    limpar.push(async () => {
      await v.destruir();
      await n.parar();
    });
    return { n, v, saida };
  };
  const a = await criar('Ana');
  const b = await criar('Beto');
  meio.ligar('Ana', 'Beto');
  await a.n.iniciar();
  await b.n.iniciar();
  await esperar(20);
  return { a, b };
}

describe('voz de ponta a ponta sobre o canal simulado', () => {
  it('quem ouve vê "Ana falando", toca o áudio e o botão volta a ficar livre', async () => {
    const { a, b } = await dupla();
    expect(a.v.vozAoVivoDisponivel()).toBe(true);
    expect(await a.v.apertar()).toBe(true);
    await esperar(150);
    expect(b.v.ptt.estado).toMatchObject({ tipo: 'outro', apelido: 'Ana' });
    expect(await b.v.apertar()).toBe(false);
    await a.v.soltar();
    await esperar(400);
    expect(b.v.ptt.estado.tipo).toBe('livre');
    expect(b.saida.amostras).toBeGreaterThan(8000 * 0.3);
  });

  it('mensagem de voz gravada chega guardada e pode ser tocada', async () => {
    const { a, b } = await dupla();
    expect(await a.v.iniciarGravacao()).toBe(true);
    await esperar(100);
    await a.v.terminarGravacao();
    await esperar(50);
    expect(b.v.mensagens).toHaveLength(1);
    expect(b.v.mensagens[0]!.apelido).toBe('Ana');
    await b.v.tocar(b.v.mensagens[0]!);
    expect(b.saida.amostras).toBeGreaterThan(0);
  });
});
