<script lang="ts">
  import { type EstadoLuz, type Lanterna, LanternaNativa, LanternaTela, LanternaWeb } from '@plataforma/canal-morse';
  import { paraMorse } from '@plataforma/canal-morse';
  import { onDestroy, onMount } from 'svelte';
  import { app } from '../../lib/estado.svelte.ts';

  const canal = app.canaisCliente!.luz;
  let estado = $state<EstadoLuz>({ transmitindo: false, progresso: 0, recebendo: false, parcial: '', nivel: 0, aceso: false });
  let texto = $state('SOS');
  let opcoesLanterna = $state<Lanterna[]>([]);
  let escolhida = $state(0);
  let telaAcesa = $state(false);
  let telaCheia = $state(false);
  let video: HTMLVideoElement;
  let unidade = $state(canal.unidadeMs);

  const tela = new LanternaTela((aceso) => (telaAcesa = aceso));

  onMount(() => {
    void (async () => {
      const lista: Lanterna[] = [];
      for (const l of [new LanternaNativa(), new LanternaWeb()]) {
        if (await l.disponivel().catch(() => false)) lista.push(l);
      }
      opcoesLanterna = [...lista, tela];
    })();
    return canal.observar((e) => (estado = e));
  });

  onDestroy(() => void canal.pararRecepcao());

  async function piscar(): Promise<void> {
    canal.lanterna = opcoesLanterna[escolhida];
    canal.unidadeMs = unidade;
    telaCheia = canal.lanterna === tela;
    await app.enviarMorse('luz', texto);
  }

  $effect(() => {
    if (!estado.transmitindo) telaCheia = false;
  });

  async function alternarRecepcao(): Promise<void> {
    if (estado.recebendo) return canal.pararRecepcao();
    canal.unidadeMs = unidade;
    try {
      await canal.iniciarRecepcao(video);
    } catch (e) {
      app.avisar(`Câmera indisponível: ${e instanceof Error ? e.message : e}`, 'erro');
    }
  }

  function marcarArea(ev: MouseEvent): void {
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    canal.selecionarArea((ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
  }
</script>

<div class="pilha">
  <h3>Transmitir</h3>
  <label class="campo">
    Texto
    <input bind:value={texto} maxlength="60" />
  </label>
  <p class="pequeno suave codigo">{paraMorse(texto)}</p>
  <label class="campo">
    Como piscar
    <select bind:value={escolhida}>
      {#each opcoesLanterna as l, i (l.nome)}<option value={i}>{l.nome}</option>{/each}
    </select>
  </label>
  <label class="campo">
    Ritmo: ponto de {unidade} ms ({Math.round(1200 / unidade)} palavras por minuto)
    <input type="range" min="120" max="400" step="10" bind:value={unidade} />
  </label>
  <div class="linha">
    <button class="primario" onclick={piscar} disabled={estado.transmitindo || !texto.trim()}>Piscar</button>
    {#if estado.transmitindo}
      <button onclick={() => canal.cancelarTransmissao()}>Parar</button>
      <progress max="1" value={estado.progresso}></progress>
    {/if}
  </div>

  <h3>Receber pela câmera</h3>
  <button onclick={alternarRecepcao}>{estado.recebendo ? 'Parar câmera' : 'Abrir câmera traseira'}</button>
  <div class="visor" class:oculto={!estado.recebendo}>
    <!-- svelte-ignore a11y_media_has_caption -->
    <video bind:this={video} playsinline muted></video>
    <button class="grade" onclick={marcarArea} aria-label="Toque onde está a lanterna do outro">
      {#if estado.area}
        <span
          class="area"
          class:manual={estado.area.manual}
          class:aceso={estado.aceso}
          style="left: {(estado.area.coluna / 8) * 100}%; top: {(estado.area.linha / 6) * 100}%"
        ></span>
      {/if}
    </button>
  </div>
  {#if estado.recebendo}
    <p class="pequeno suave">
      Toque onde está a luz do outro (ou deixe no automático: o app escolhe o ponto que mais pisca). Brilho:
      {Math.round(estado.nivel * 100)}%
    </p>
    <p class="parcial">{estado.parcial || '...'}</p>
    <button onclick={() => canal.selecionarArea()}>Voltar ao automático</button>
  {/if}
</div>

{#if telaCheia}
  <button class="flash" class:aceso={telaAcesa} onclick={() => canal.cancelarTransmissao()} aria-label="Tela piscando. Toque para parar">
  </button>
{/if}

<style>
  .codigo {
    font-family: ui-monospace, monospace;
    letter-spacing: 0.1em;
    overflow-wrap: anywhere;
  }

  .visor {
    position: relative;
    border-radius: 12px;
    overflow: hidden;
    background: #000;
  }

  .visor video {
    width: 100%;
    display: block;
    aspect-ratio: 4 / 3;
    object-fit: cover;
  }

  .grade {
    position: absolute;
    inset: 0;
    background: none;
    border: none;
    border-radius: 0;
    padding: 0;
  }

  .area {
    position: absolute;
    width: 12.5%;
    height: 16.66%;
    border: 2px dashed var(--acento);
  }

  .area.manual {
    border-style: solid;
  }

  .area.aceso {
    background: color-mix(in srgb, var(--acento) 40%, transparent);
  }

  .parcial {
    font-family: ui-monospace, monospace;
    font-size: 1.3rem;
    min-height: 1.5em;
  }

  .oculto {
    display: none;
  }

  .flash {
    position: fixed;
    inset: 0;
    z-index: 100;
    background: #000;
    border: none;
    border-radius: 0;
  }

  .flash.aceso {
    background: #fff;
  }
</style>
