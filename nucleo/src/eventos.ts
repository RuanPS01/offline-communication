/** Emissor de eventos tipado e mínimo, sem depender de Node nem do DOM. */
export class Emissor<M extends object> {
  private ouvintes = new Map<keyof M, Set<(v: never) => void>>();

  on<K extends keyof M>(evento: K, fn: (v: M[K]) => void): () => void {
    let s = this.ouvintes.get(evento);
    if (!s) {
      s = new Set();
      this.ouvintes.set(evento, s);
    }
    s.add(fn as (v: never) => void);
    return () => s.delete(fn as (v: never) => void);
  }

  emitir<K extends keyof M>(evento: K, valor: M[K]): void {
    const s = this.ouvintes.get(evento);
    if (!s) return;
    for (const fn of [...s]) {
      try {
        (fn as (v: M[K]) => void)(valor);
      } catch (e) {
        console.error(`ouvinte de "${String(evento)}" falhou`, e);
      }
    }
  }
}
