<script lang="ts">
  import { app } from '../../lib/estado.svelte.ts';

  const web = app.canaisCliente!.nfcWeb;
  let gravando = $state(false);

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
  <p class="suave pequeno">
    Encoste as costas dos dois celulares: eles trocam presença e as mensagens guardadas. No iPhone, abra esta tela
    e toque no aviso de leitura antes de encostar num Android.
  </p>
{/if}
