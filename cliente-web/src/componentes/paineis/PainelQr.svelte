<script lang="ts">
  import { desenharQr, type QuadroQr } from '@plataforma/canal-qr';
  import { onDestroy, onMount } from 'svelte';
  import { app } from '../../lib/estado.svelte.ts';

  const canal = app.canaisCliente!.qr;
  let tela: HTMLCanvasElement;
  let video: HTMLVideoElement;
  let quadro = $state<QuadroQr | undefined>();
  let lendo = $state(false);
  let camera = $state<'user' | 'environment'>('user');
  let colado = $state('');
  let lidos = $state(0);

  onMount(() =>
    canal.observar((q) => {
      quadro = q;
      if (q && tela) desenharQr(tela, q.texto, Math.min(360, window.innerWidth - 48));
    }),
  );

  onDestroy(() => void canal.pararLeitura());

  async function alternarLeitura(): Promise<void> {
    if (lendo) {
      await canal.pararLeitura();
      lendo = false;
      return;
    }
    try {
      await canal.iniciarLeitura(video, camera);
      lendo = true;
    } catch (e) {
      app.avisar(`Câmera indisponível: ${e instanceof Error ? e.message : e}`, 'erro');
    }
  }

  async function trocarCamera(): Promise<void> {
    camera = camera === 'user' ? 'environment' : 'user';
    if (lendo) {
      await canal.pararLeitura();
      await canal.iniciarLeitura(video, camera);
    }
  }

  function colar(): void {
    if (canal.receberTexto(colado)) lidos++;
    else app.avisar('Esse texto não é um QR da plataforma.', 'erro');
    colado = '';
  }
</script>

<div class="pilha">
  <div class="qr">
    <canvas bind:this={tela} aria-label="QR com a sua presença e as últimas mensagens"></canvas>
    {#if quadro}
      <span class="suave pequeno">Quadro {quadro.indice + 1} de {quadro.total}: presença e mensagens recentes, em rodízio.</span>
    {/if}
  </div>
  <div class="linha">
    <button class="primario" onclick={alternarLeitura}>{lendo ? 'Parar câmera' : 'Ler QR do outro'}</button>
    <button onclick={trocarCamera}>Câmera {camera === 'user' ? 'frontal' : 'traseira'}</button>
  </div>
  <!-- svelte-ignore a11y_media_has_caption -->
  <video bind:this={video} class:oculto={!lendo} playsinline muted></video>
  <p class="suave pequeno">
    Frente a frente com as câmeras frontais, os dois mostram e leem ao mesmo tempo. Escreva a mensagem na
    Conversa: ela entra no rodízio de QRs.
  </p>
  <details>
    <summary class="pequeno">Colar o texto de um QR lido por outro aplicativo</summary>
    <div class="linha">
      <input bind:value={colado} placeholder="OC1:..." />
      <button onclick={colar} disabled={!colado}>Usar</button>
    </div>
  </details>
</div>

<style>
  .qr {
    display: grid;
    justify-items: center;
    gap: 0.4rem;
    background: #fff;
    border-radius: 12px;
    padding: 0.5rem;
  }

  .qr span {
    color: #333;
  }

  canvas {
    max-width: 100%;
    image-rendering: pixelated;
  }

  video {
    width: 100%;
    border-radius: 12px;
    background: #000;
    max-height: 320px;
    object-fit: cover;
  }

  .oculto {
    display: none;
  }
</style>
