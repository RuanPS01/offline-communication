<script lang="ts">
  import Icone from './componentes/Icone.svelte';
  import BotaoFalar from './componentes/BotaoFalar.svelte';
  import Inicio from './telas/Inicio.svelte';
  import Radar from './telas/Radar.svelte';
  import Conversa from './telas/Conversa.svelte';
  import Canais from './telas/Canais.svelte';
  import Perfil from './telas/Perfil.svelte';
  import { app, type Tela } from './lib/estado.svelte.ts';

  const abas: { tela: Tela; nome: string; icone: string }[] = [
    { tela: 'radar', nome: 'Radar', icone: 'radar' },
    { tela: 'conversa', nome: 'Conversa', icone: 'conversa' },
    { tela: 'canais', nome: 'Canais', icone: 'canais' },
    { tela: 'perfil', nome: 'Perfil', icone: 'perfil' },
  ];

  function lerRota(): void {
    const t = location.hash.replace(/^#\/?/, '') as Tela;
    if (['radar', 'mapa', 'conversa', 'canais', 'perfil'].includes(t)) app.tela = t;
  }
  lerRota();

  const naoLidasTotal = $derived(Object.values(app.naoLidas).reduce((a, b) => a + b, 0));
  const ativos = $derived(app.canais.filter((c) => c.ativo));
  const falando = $derived(app.ptt.tipo === 'outro' ? app.ptt : undefined);
</script>

<svelte:window onhashchange={lerRota} />

{#if !app.pronto}
  <Inicio />
{:else}
  <div class="casca">
    <header>
      <div class="titulo">
        <strong>{app.apelido}</strong>
        <span class="suave pequeno">#{app.conversaAtual?.nome ?? 'geral'}</span>
      </div>
      <div class="canais-ativos" aria-label="Canais ligados">
        {#each ativos as c (c.id)}
          <span class="chip" class:ativo={c.vizinhos > 0} title="{c.nome}: {c.vizinhos} por perto">
            <Icone nome={c.id} tamanho={14} />
            {c.vizinhos || ''}
          </span>
        {/each}
      </div>
    </header>

    {#if falando}
      <div class="faixa-falando" role="status">
        <Icone nome="microfone" tamanho={18} />
        {falando.apelido ?? 'Alguém'} falando
      </div>
    {/if}

    <main>
      {#if app.tela === 'radar' || app.tela === 'mapa'}
        <Radar />
      {:else if app.tela === 'conversa'}
        <Conversa />
      {:else if app.tela === 'canais'}
        <Canais />
      {:else}
        <Perfil />
      {/if}
    </main>

    {#if app.tela === 'radar' || app.tela === 'mapa'}
      <BotaoFalar />
    {/if}

    <nav aria-label="Navegação principal">
      {#each abas as aba (aba.tela)}
        <button
          class:atual={app.tela === aba.tela || (aba.tela === 'radar' && app.tela === 'mapa')}
          onclick={() => app.irPara(aba.tela)}
          aria-current={app.tela === aba.tela ? 'page' : undefined}
        >
          <Icone nome={aba.icone} />
          <span>{aba.nome}</span>
          {#if aba.tela === 'conversa' && naoLidasTotal > 0}
            <span class="contador" aria-label="{naoLidasTotal} não lidas">{naoLidasTotal}</span>
          {/if}
        </button>
      {/each}
    </nav>
  </div>
{/if}

<div class="avisos" aria-live="polite">
  {#each app.avisos as a (a.id)}
    <div class="aviso" class:erro={a.tipo === 'erro'}>{a.texto}</div>
  {/each}
</div>

<style>
  .casca {
    min-height: 100dvh;
    display: grid;
    grid-template-rows: auto auto 1fr auto;
    padding-top: env(safe-area-inset-top);
  }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--borda);
    position: sticky;
    top: 0;
    background: var(--fundo);
    z-index: 5;
  }

  .titulo {
    display: grid;
    min-width: 0;
  }

  .titulo strong {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .canais-ativos {
    display: flex;
    gap: 0.3rem;
    flex-wrap: wrap;
    justify-content: flex-end;
  }

  .faixa-falando {
    display: flex;
    gap: 0.5rem;
    align-items: center;
    justify-content: center;
    padding: 0.5rem;
    background: var(--acento);
    color: var(--acento-texto);
    font-weight: 700;
  }

  main {
    padding: 1rem;
    padding-bottom: 10rem;
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
  }

  nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    background: var(--superficie);
    border-top: 1px solid var(--borda);
    padding-bottom: env(safe-area-inset-bottom);
    z-index: 10;
  }

  nav button {
    flex-direction: column;
    gap: 0.1rem;
    border: none;
    border-radius: 0;
    background: transparent;
    min-height: 60px;
    font-size: 0.75rem;
    color: var(--texto-suave);
    position: relative;
  }

  nav button.atual {
    color: var(--acento);
  }

  .contador {
    position: absolute;
    top: 6px;
    right: calc(50% - 22px);
    background: var(--vermelho);
    color: #fff;
    border-radius: 999px;
    font-size: 0.7rem;
    padding: 0 0.35rem;
    min-width: 1.1rem;
  }

  .avisos {
    position: fixed;
    left: 1rem;
    right: 1rem;
    bottom: 5.5rem;
    display: grid;
    gap: 0.5rem;
    z-index: 30;
    pointer-events: none;
  }

  .aviso {
    background: var(--superficie-2);
    border: 1px solid var(--borda);
    border-radius: 10px;
    padding: 0.7rem 0.9rem;
    box-shadow: var(--sombra);
  }

  .aviso.erro {
    border-color: var(--vermelho);
  }
</style>
