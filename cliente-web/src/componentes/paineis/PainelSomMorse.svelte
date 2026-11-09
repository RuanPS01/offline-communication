<script lang="ts">
  import { type EstadoSomMorse, paraMorse } from '@plataforma/canal-morse';
  import { onMount } from 'svelte';
  import { app } from '../../lib/estado.svelte.ts';

  const canal = app.canaisCliente!.somMorse;
  let estado = $state<EstadoSomMorse>({ transmitindo: false, parcial: '', nivel: 0 });
  let texto = $state('SOS');

  onMount(() => canal.observar((e) => (estado = e)));
</script>

<div class="pilha">
  <label class="campo">
    Texto
    <input bind:value={texto} maxlength="80" />
  </label>
  <p class="pequeno suave">{paraMorse(texto)}</p>
  <button class="primario" onclick={() => app.enviarMorse('som-morse', texto)} disabled={estado.transmitindo}>
    {estado.transmitindo ? 'Tocando...' : 'Tocar em Morse'}
  </button>
  <p class="pequeno suave">
    Escutando o tom de {canal.frequencia} Hz. Nível: {Math.round(estado.nivel * 100)}%. Decodificando:
    <strong>{estado.parcial || '...'}</strong>
  </p>
</div>
