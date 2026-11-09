/**
 * Armazenamento chave-valor simples. Cada cliente fornece o seu
 * (localStorage na web, arquivo no app); os testes usam a memória.
 */
export interface Armazenamento {
  ler(chave: string): Promise<string | undefined>;
  gravar(chave: string, valor: string): Promise<void>;
  apagar(chave: string): Promise<void>;
}

export class ArmazenamentoMemoria implements Armazenamento {
  private dados = new Map<string, string>();

  async ler(chave: string): Promise<string | undefined> {
    return this.dados.get(chave);
  }

  async gravar(chave: string, valor: string): Promise<void> {
    this.dados.set(chave, valor);
  }

  async apagar(chave: string): Promise<void> {
    this.dados.delete(chave);
  }
}
