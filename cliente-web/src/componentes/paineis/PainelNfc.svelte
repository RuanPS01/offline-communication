<script lang="ts">
  import { app } from '../../lib/estado.svelte.ts';

  const web = app.canaisCliente!.nfcWeb;
  const nativo = app.canaisCliente!.nfcNativo;
  let gravando = $state(false);
  let lendo = $state(false);

  async function ler(): Promise<void> {
    if (!nativo) return;
    lendo = true;
    try {
      const r = await nativo.ler(20);
      app.avisar(r.trocou ? `Troca feita: ${r.recebidos ?? 0} pacotes recebidos.` : 'Nenhum celular encostou.');
    } catch (e) {
      app.avisar(`NFC: ${e instanceof Error ? e.message : e}`, 'erro');
    } finally {
      lendo = false;
    }
  }

  async function gravar(): Promise<void> {
    if (!web) return;
    gravando = true;
    try {
      const p = app.nucleo?.pacotePresenca();
      if (p) await web.anunciar(p);
      await web.gravarNoAdesivo();
      app.avisar('Gravado no adesivo.');
    } catch (e) {
      app.avisar(`NFC: ${e instanceof Error ? e.message : e}`, 'erro');
    } finally {
      gravando = false;
    }
  }
</script>

{#if web}
  <div class="pilha">
    <p class="suave pequeno">
      Encoste um adesivo NFC para ler o recado gravado nele. Para deixar um recado, escreva na Conversa e depois
      toque em gravar e encoste o adesivo.
    </p>
    <button class="primario" onclick={gravar} disabled={gravando}>{gravando ? 'Encoste o adesivo...' : 'Gravar no adesivo'}</button>
  </div>
{:else}
  <div class="pilha">
    <p class="suave pequeno">
      Um dos dois toca em "Ler" e os celulares encostam as costas: trocam presença e as mensagens guardadas. O outro
      não precisa fazer nada (ele responde como cartão). No iPhone, "Ler" funciona só com um Android do outro lado.
    </p>
    <button class="primario" onclick={ler} disabled={lendo}>{lendo ? 'Encoste o outro celular...' : 'Ler'}</button>
  </div>
{/if}
