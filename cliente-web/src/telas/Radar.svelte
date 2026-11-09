<script lang="ts">
  import type { Pessoa } from '@plataforma/nucleo';
  import Icone from '../componentes/Icone.svelte';
  import { app, chaveConversaPrivada } from '../lib/estado.svelte.ts';
  import { ROTULO_CURTO } from '../lib/canais.ts';
  import { anguloDoId, haQuanto, iniciais, metros, saltos } from '../lib/formato.ts';

  const RAIOS = { perto: 0.3, medio: 0.6, longe: 0.88, desconhecida: 0.75 };
  const pessoas = $derived(app.pessoas);
  const modoMapa = $derived(app.tela === 'mapa');

  // Quem não tem rumo (sem GPS) é espalhado em volta, para os marcadores não se sobreporem.
  const semRumo = $derived(pessoas.filter((p) => p.rumo === undefined).map((p) => p.idNo).sort());

  function posicao(p: Pessoa): { x: number; y: number } {
    let r = RAIOS[p.distancia.classe];
    if (p.distancia.metros !== undefined && p.posicao) {
      // Escala logarítmica: 5 m perto do centro, 2 km na borda.
      r = Math.min(0.92, Math.max(0.15, Math.log10(Math.max(5, p.distancia.metros)) / Math.log10(2000) * 0.9));
    }
    if (p.saltos > 0) r = Math.max(r, 0.8);
    const i = semRumo.indexOf(p.idNo);
    const angulo =
      p.rumo !== undefined
        ? (p.rumo * Math.PI) / 180
        : anguloDoId(semRumo[0] ?? p.idNo) + (i * 2 * Math.PI) / Math.max(1, semRumo.length);
    return { x: 50 + Math.sin(angulo) * r * 46, y: 50 - Math.cos(angulo) * r * 46 };
  }

  function abrir(p: Pessoa): void {
    app.abrirConversa(chaveConversaPrivada(p.idNo));
  }

  let MapaComponente = $state<typeof import('./Mapa.svelte').default | undefined>();
  $effect(() => {
    if (modoMapa && !MapaComponente) {
      void import('./Mapa.svelte').then((m) => (MapaComponente = m.default));
    }
  });
</script>

<div class="topo">
  <h2>{pessoas.length ? `${pessoas.length} por perto` : 'Ninguém por perto ainda'}</h2>
  <div class="alternar" role="group" aria-label="Modo de visualização">
    <button class:atual={!modoMapa} onclick={() => app.irPara('radar')}><Icone nome="radar" tamanho={18} /> Radar</button>
    <button class:atual={modoMapa} onclick={() => app.irPara('mapa')}><Icone nome="mapa" tamanho={18} /> Mapa</button>
  </div>
</div>

{#if modoMapa}
  {#if MapaComponente}
    <MapaComponente />
  {:else}
    <p class="suave">Carregando o mapa...</p>
  {/if}
{:else}
  <div class="radar">
    <svg viewBox="0 0 100 100" role="img" aria-label="Radar com as pessoas por perto">
      <circle cx="50" cy="50" r="46" class="anel" />
      <circle cx="50" cy="50" r="27.6" class="anel" />
      <circle cx="50" cy="50" r="13.8" class="anel" />
      <line x1="50" y1="4" x2="50" y2="96" class="eixo" />
      <line x1="4" y1="50" x2="96" y2="50" class="eixo" />
      <text x="50" y="7.5" class="rotulo-anel">N</text>
      <circle cx="50" cy="50" r="2.6" class="eu" />
    </svg>
    {#each pessoas as p (p.idNo)}
      {@const pos = posicao(p)}
      <button
        class="marcador"
        class:falando={p.falando}
        class:distante={p.saltos > 0}
        style="left: {pos.x}%; top: {pos.y}%"
        onclick={() => abrir(p)}
        aria-label="Conversar com {p.apelido}, {saltos(p.saltos)}"
      >
        <span class="bolinha">{iniciais(p.apelido)}</span>
        <span class="nome">{p.apelido}</span>
        <span class="vias">
          {#each p.vistoPor.slice(0, 3) as v (v.canal)}
            <span class="via">{ROTULO_CURTO[v.canal] ?? v.canal}{v.saltos ? ` ${v.saltos}` : ''}</span>
          {/each}
        </span>
      </button>
    {/each}
  </div>
  <p class="suave pequeno legenda">
    Anéis: perto, médio e longe. Com GPS dos dois lados a posição é real; sem ele, a distância vem do sinal.
    Toque numa pessoa para conversar em particular.
  </p>
{/if}

<section class="lista">
  {#each pessoas as p (p.idNo)}
    <button class="pessoa cartao" onclick={() => abrir(p)}>
      <span class="bolinha">{iniciais(p.apelido)}</span>
      <span class="info">
        <strong>{p.apelido}</strong>
        <span class="suave pequeno">
          {saltos(p.saltos)}
          {#if p.distancia.metros !== undefined} · {metros(p.distancia.metros)}{:else if p.distancia.classe !== 'desconhecida'} · {p.distancia.classe === 'medio' ? 'médio' : p.distancia.classe}{/if}
          · {haQuanto(p.ultimaVez)}
          {#if p.bateria !== undefined} · bateria {p.bateria}%{/if}
          {#if p.canalConversa} · #{p.canalConversa}{/if}
        </span>
        <span class="linha">
          {#each p.vistoPor as v (v.canal)}
            <span class="chip"><Icone nome={v.canal} tamanho={12} /> {ROTULO_CURTO[v.canal] ?? v.canal}{v.rssi !== undefined ? ` ${v.rssi} dBm` : ''}</span>
          {/each}
        </span>
      </span>
    </button>
  {:else}
    <div class="cartao vazio">
      <p><strong>Para achar alguém:</strong></p>
      <ul class="suave">
        <li>Ligue o <strong>som</strong> em Canais nos dois celulares e toque em "Anunciar por som".</li>
        <li>Mostre o <strong>QR</strong> da tela de Canais e aponte a câmera do outro.</li>
        <li>Num Wi-Fi ou hotspot, abram a página do mesmo servidor (<strong>rede local</strong>).</li>
        {#if app.ambiente.cliente !== 'web'}<li>Com o app, Bluetooth e Wi-Fi direto acham sozinhos.</li>{/if}
      </ul>
      <button onclick={() => app.irPara('canais')}>Abrir canais</button>
    </div>
  {/each}
</section>

<style>
  .topo {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.75rem;
  }

  .topo h2 {
    margin: 0;
  }

  .alternar {
    display: flex;
    gap: 0.25rem;
  }

  .alternar button.atual {
    border-color: var(--acento);
    color: var(--acento);
  }

  .radar {
    position: relative;
    width: min(100%, 520px);
    aspect-ratio: 1;
    margin: 0 auto;
  }

  .radar svg {
    width: 100%;
    height: 100%;
  }

  .anel {
    fill: none;
    stroke: var(--borda);
    stroke-width: 0.4;
  }

  .eixo {
    stroke: var(--borda);
    stroke-width: 0.2;
    stroke-dasharray: 1 1;
  }

  .rotulo-anel {
    fill: var(--texto-suave);
    font-size: 3px;
    text-anchor: middle;
  }

  .eu {
    fill: var(--verde);
  }

  .marcador {
    position: absolute;
    transform: translate(-50%, -22px);
    background: none;
    border: none;
    padding: 0;
    min-height: 0;
    display: grid;
    justify-items: center;
    gap: 2px;
    transition:
      left 0.6s ease,
      top 0.6s ease;
  }

  .bolinha {
    width: 40px;
    height: 40px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--acento);
    color: var(--acento-texto);
    font-weight: 700;
    font-size: 0.85rem;
    flex: none;
  }

  .marcador.distante .bolinha {
    background: var(--superficie-2);
    color: var(--texto);
    border: 2px dashed var(--acento);
  }

  .marcador.falando .bolinha {
    box-shadow: 0 0 0 5px color-mix(in srgb, var(--verde) 55%, transparent);
  }

  .nome {
    font-size: 0.75rem;
    max-width: 90px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    background: color-mix(in srgb, var(--fundo) 80%, transparent);
    padding: 0 4px;
    border-radius: 4px;
  }

  .vias {
    display: flex;
    gap: 2px;
  }

  .via {
    font-size: 0.55rem;
    font-weight: 700;
    background: var(--superficie-2);
    border: 1px solid var(--borda);
    border-radius: 4px;
    padding: 0 3px;
  }

  .legenda {
    text-align: center;
    margin-top: 0.5rem;
  }

  .lista {
    display: grid;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .pessoa {
    display: flex;
    justify-content: flex-start;
    text-align: left;
    gap: 0.75rem;
    align-items: center;
  }

  .info {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  .vazio ul {
    padding-left: 1.2rem;
  }
</style>
