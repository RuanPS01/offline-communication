import type { Armazenamento } from '@plataforma/nucleo';

/** localStorage com tratamento de erro (aba anônima, cota cheia, bloqueio). */
export class ArmazenamentoLocal implements Armazenamento {
  constructor(private readonly prefixo = 'offline.') {}

  async ler(chave: string): Promise<string | undefined> {
    try {
      return localStorage.getItem(this.prefixo + chave) ?? undefined;
    } catch {
      return undefined;
    }
  }

  async gravar(chave: string, valor: string): Promise<void> {
    try {
      localStorage.setItem(this.prefixo + chave, valor);
    } catch {
      // Sem espaço ou sem permissão: segue só em memória.
    }
  }

  async apagar(chave: string): Promise<void> {
    try {
      localStorage.removeItem(this.prefixo + chave);
    } catch {
      // Ignora.
    }
  }
}

export function lerPreferencia<T>(chave: string, padrao: T): T {
  try {
    const v = localStorage.getItem(`offline.pref.${chave}`);
    return v === null ? padrao : (JSON.parse(v) as T);
  } catch {
    return padrao;
  }
}

export function gravarPreferencia<T>(chave: string, valor: T): void {
  try {
    localStorage.setItem(`offline.pref.${chave}`, JSON.stringify(valor));
  } catch {
    // Ignora.
  }
}
