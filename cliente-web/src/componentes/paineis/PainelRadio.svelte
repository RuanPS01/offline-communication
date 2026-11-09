<script lang="ts">
  import { app } from '../../lib/estado.svelte.ts';

  const canal = app.canaisCliente!.radio;
  const ativo = $derived(app.canais.find((c) => c.id === 'radio')?.ativo);
</script>

<div class="pilha">
  {#if ativo}
    <p>Conectado ao módulo <strong>{canal.modulo}</strong>. Texto e presença saem também por LoRa.</p>
  {:else}
    <p class="suave pequeno">
      Precisa de um módulo LoRa externo (ESP32 com rádio SX1276) com o firmware da plataforma, ligado por
      Bluetooth. Ligue o canal para escolher o módulo.
    </p>
  {/if}
</div>
