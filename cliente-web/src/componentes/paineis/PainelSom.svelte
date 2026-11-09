<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../../lib/estado.svelte.ts';

  const canal = app.canaisCliente!.som;
  let opcoes = $state({ ...canal.opcoes });
  let transmitindo = $state(false);
  let naFila = $state(0);

  onMount(() =>
    canal.observarEstado((t, n) => {
      transmitindo = t;
      naFila = n;
    }),
  );

  $effect(() => {
    canal.opcoes = { ...opcoes };
  });

  async function anunciar(): Promise<void> {
    const p = app.nucleo?.pacotePresenca();
    if (p) await canal.anunciarAgora(p).catch((e) => app.avisar(String(e), 'erro'));
  }
</script>

<div class="pilha">
  <div class="linha">
    <button class="primario" onclick={anunciar} disabled={transmitindo}>Anunciar minha presença por som</button>
    {#if transmitindo}<span class="chip ativo">Transmitindo{naFila ? ` (+${naFila} na fila)` : ''}</span>{/if}
  </div>
  <label class="campo">
    Faixa
    <select bind:value={opcoes.protocolo}>
      <option value="audivel">Audível (mais robusta)</option>
      <option value="ultrassom">Ultrassom (silenciosa, falha em alguns aparelhos)</option>
    </select>
  </label>
  <label class="campo">
    Velocidade
    <select bind:value={opcoes.velocidade}>
      <option value="normal">Normal (mais longe)</option>
      <option value="rapido">Rápida</option>
      <option value="maisRapido">Mais rápida (mais perto)</option>
    </select>
  </label>
  <label class="campo">
    Volume: {opcoes.volume}
    <input type="range" min="5" max="100" bind:value={opcoes.volume} />
  </label>
  <label class="interruptor">
    <span>Anunciar presença por som a cada 2 minutos</span>
    <input type="checkbox" bind:checked={opcoes.anunciarPresenca} />
  </label>
  <p class="suave pequeno">
    Os dois aparelhos escutam e falam pelo alto-falante. Um texto curto leva poucos segundos. Se a faixa audível
    falhar, teste o ultrassom; se nada funcionar, use o QR.
  </p>
</div>
