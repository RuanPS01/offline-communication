import { MeioSimulado } from '@plataforma/canal-memoria';
import { type Capacidades, Nucleo, type OpcoesNucleo } from '../src/index.ts';

export function esperar(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Espera até a condição ficar verdadeira (ou estoura o tempo). */
export async function ate(condicao: () => boolean, limiteMs = 3000): Promise<void> {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > limiteMs) throw new Error('tempo esgotado esperando condição');
    await esperar(5);
  }
}

export interface Rede {
  meio: MeioSimulado;
  nos: Record<string, Nucleo>;
  parar(): Promise<void>;
}

/** Cria nós com um canal simulado cada, sem ligar ninguém ainda. */
export function criarRede(
  nomes: string[],
  opcoes: Partial<OpcoesNucleo> = {},
  capacidades: Partial<Capacidades> = {},
): Rede {
  const meio = new MeioSimulado();
  const nos: Record<string, Nucleo> = {};
  for (const nome of nomes) {
    const n = new Nucleo({
      apelido: nome,
      atrasoRepasseMs: [0, 0],
      intervaloPresencaMs: 60_000,
      esperaEscalonamentoMs: 0,
      ...opcoes,
    });
    n.registrarCanal(meio.criarCanal(nome, capacidades));
    nos[nome] = n;
  }
  return {
    meio,
    nos,
    parar: async () => {
      await Promise.all(Object.values(nos).map((n) => n.parar()));
    },
  };
}
