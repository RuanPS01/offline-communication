<script lang="ts">
  import { addProtocol, Map as MapaLibre, Marker, setWorkerUrl } from 'maplibre-gl';
  import 'maplibre-gl/dist/maplibre-gl.css';
  import urlWorker from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
  import { onDestroy, onMount } from 'svelte';
  import { app, chaveConversaPrivada } from '../lib/estado.svelte.ts';
  import { baixarArea, buscarComCache, deCache, ESTILO_MAPA, paraCache } from '../lib/mapa-offline.ts';
  import { iniciais } from '../lib/formato.ts';

  let elemento: HTMLDivElement;
  let mapa: MapaLibre | undefined;
  let marcadores = new globalThis.Map<string, Marker>();
  let progresso = $state<{ feitos: number; total: number } | undefined>();
  let erro = $state('');

  setWorkerUrl(urlWorker);
  addProtocol('cache', async (params, controle) => {
    const resposta = await buscarComCache(deCache(params.url), controle.signal);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    if (params.type === 'json') return { data: await resposta.json() };
    if (params.type === 'string') return { data: await resposta.text() };
    return { data: await resposta.arrayBuffer() };
  });

  onMount(() => {
    const centro = app.posicao ?? app.pessoas.find((p) => p.posicao)?.posicao;
    mapa = new MapaLibre({
      container: elemento,
      style: paraCache(ESTILO_MAPA),
      center: centro ? [centro.lon, centro.lat] : [-47.88, -15.79],
      zoom: centro ? 15 : 3,
      attributionControl: { compact: true },
      transformRequest: (url) => ({ url: paraCache(url) }),
    });
    mapa.on('error', (e) => {
      erro = 'Parte do mapa não está guardada neste aparelho. Baixe a área quando houver internet.';
      console.warn(e.error);
    });
  });

  onDestroy(() => mapa?.remove());

  function elementoMarcador(texto: string, eu: boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = eu ? 'marcador-mapa eu' : 'marcador-mapa';
    el.textContent = texto;
    return el;
  }

  $effect(() => {
    if (!mapa) return;
    const vistos = new Set<string>();
    const lista = [
      ...(app.posicao ? [{ id: 'eu', apelido: app.apelido, pos: app.posicao, eu: true }] : []),
      ...app.pessoas.filter((p) => p.posicao).map((p) => ({ id: p.idNo, apelido: p.apelido, pos: p.posicao!, eu: false })),
    ];
    for (const item of lista) {
      vistos.add(item.id);
      let m = marcadores.get(item.id);
      if (!m) {
        const el = elementoMarcador(item.eu ? 'Eu' : iniciais(item.apelido), item.eu);
        if (!item.eu) el.onclick = () => app.abrirConversa(chaveConversaPrivada(item.id));
        el.title = item.apelido;
        m = new Marker({ element: el }).setLngLat([item.pos.lon, item.pos.lat]).addTo(mapa);
        marcadores.set(item.id, m);
      } else {
        m.setLngLat([item.pos.lon, item.pos.lat]);
      }
    }
    for (const [id, m] of marcadores) {
      if (!vistos.has(id)) {
        m.remove();
        marcadores.delete(id);
      }
    }
  });

  async function baixar(): Promise<void> {
    if (!mapa) return;
    const fonte = mapa.getSource('openmaptiles') as unknown as { tiles?: string[] } | undefined;
    const modelos = fonte?.tiles;
    if (!modelos?.length) {
      erro = 'Abra o mapa com internet ao menos uma vez antes de baixar.';
      return;
    }
    const b = mapa.getBounds();
    const z = Math.floor(mapa.getZoom());
    progresso = { feitos: 0, total: 1 };
    const guardados = await baixarArea(
      modelos,
      [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()],
      Math.max(0, z - 1),
      Math.min(14, z + 2),
      (feitos, total) => (progresso = { feitos, total }),
    );
    progresso = undefined;
    app.avisar(`${guardados} pedaços do mapa guardados para usar sem internet.`);
  }
</script>

<div class="mapa" bind:this={elemento}></div>
<div class="acoes">
  <button onclick={baixar} disabled={!!progresso}>
    {progresso ? `Baixando ${progresso.feitos} de ${progresso.total}` : 'Baixar esta área para usar offline'}
  </button>
</div>
{#if erro}<p class="suave pequeno">{erro}</p>{/if}
<p class="suave pequeno">Só aparece no mapa quem compartilha a posição (GPS). Os outros ficam no radar.</p>

<style>
  .mapa {
    width: 100%;
    height: min(62vh, 560px);
    border-radius: var(--raio);
    overflow: hidden;
    border: 1px solid var(--borda);
  }

  .acoes {
    margin: 0.75rem 0;
  }

  :global(.marcador-mapa) {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    display: grid;
    place-items: center;
    background: var(--acento);
    color: var(--acento-texto);
    font-weight: 700;
    font-size: 0.8rem;
    border: 2px solid #fff;
    cursor: pointer;
  }

  :global(.marcador-mapa.eu) {
    background: var(--verde);
    color: #04201a;
  }
</style>
