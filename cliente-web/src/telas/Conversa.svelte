<script lang="ts">
  import { tick } from 'svelte';
  import Icone from '../componentes/Icone.svelte';
  import { app, chaveConversaCanal, chaveConversaPrivada, type ItemConversa } from '../lib/estado.svelte.ts';
  import { ROTULO_CURTO } from '../lib/canais.ts';
  import { hora, saltos, TEXTO_ESTADO } from '../lib/formato.ts';

  let texto = $state('');
  let importante = $state(false);
  let lista: HTMLElement | undefined = $state();
  let gravando = $state(false);

  const itens = $derived(app.itens.filter((i) => i.conversa === app.conversaAberta));
  const privada = $derived(app.conversaAberta.startsWith('privada:'));
  const pessoa = $derived(app.pessoaDaConversa);
  const idPrivado = $derived(privada ? app.conversaAberta.slice('privada:'.length) : '');

  $effect(() => {
    void itens.length;
    void tick().then(() => lista?.scrollTo({ top: lista.scrollHeight, behavior: 'smooth' }));
  });

  async function enviar(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    const t = texto;
    texto = '';
    await app.enviarTexto(t, importante);
    importante = false;
  }

  async function alternarGravacao(): Promise<void> {
    if (!app.voz) return;
    if (gravando) {
      gravando = false;
      await app.voz.terminarGravacao();
    } else {
      gravando = await app.voz.iniciarGravacao();
    }
  }

  function vias(i: ItemConversa): string {
    if (i.propria) return (i.canais ?? []).map((c) => ROTULO_CURTO[c] ?? c).join(', ');
    return i.viaCanal ? ROTULO_CURTO[i.viaCanal] ?? i.viaCanal : '';
  }

  function selecionar(ev: Event): void {
    app.abrirConversa((ev.currentTarget as HTMLSelectElement).value);
  }
</script>

<div class="cabecalho">
  <label class="campo">
    <span class="oculto-visualmente">Conversa</span>
    <select value={app.conversaAberta} onchange={selecionar}>
      {#each app.conversas as c (c.id)}
        <option value={chaveConversaCanal(c.id)}>
          #{c.nome}{c.privado ? ' (privado)' : ''}{app.naoLidas[chaveConversaCanal(c.id)] ? ` · ${app.naoLidas[chaveConversaCanal(c.id)]} novas` : ''}
        </option>
      {/each}
      {#each app.conversasPrivadas as p (p.idNo)}
        <option value={chaveConversaPrivada(p.idNo)}>
          Particular com {p.apelido}{app.naoLidas[chaveConversaPrivada(p.idNo)] ? ` · ${app.naoLidas[chaveConversaPrivada(p.idNo)]} novas` : ''}
        </option>
      {/each}
      {#if privada && !app.conversasPrivadas.some((p) => p.idNo === idPrivado)}
        <option value={app.conversaAberta}>Particular com {pessoa?.apelido ?? idPrivado.slice(0, 6)}</option>
      {/if}
    </select>
  </label>
  {#if privada}
    <p class="suave pequeno linha">
      <Icone nome="cadeado" tamanho={14} />
      Cifrada de ponta a ponta. {#if pessoa}Confira com {pessoa.apelido} a impressão digital da identidade
        no Perfil de cada um.{:else}Esta pessoa não está por perto agora: a mensagem fica guardada e segue quando
        ela (ou alguém na direção dela) aparecer.{/if}
    </p>
  {/if}
</div>

<section class="mensagens" bind:this={lista} aria-live="polite">
  {#each itens as i (i.chave)}
    <article class="bolha" class:propria={i.propria} class:anonima={i.anonima}>
      {#if !i.propria}<strong class="autor">{i.apelido ?? i.de.slice(0, 6)}</strong>{/if}
      {#if i.texto !== undefined}
        <p>{i.texto}</p>
      {:else if i.voz}
        <button class="voz" onclick={() => app.voz?.tocar(i.voz!)}>
          <Icone nome="tocar" tamanho={16} /> Mensagem de voz ({Math.round((i.voz.quadros.length * i.voz.duracaoQuadroMs) / 1000)} s)
        </button>
      {/if}
      <footer class="pequeno suave">
        {hora(i.carimbo)}
        {#if vias(i)} · {vias(i)}{/if}
        {#if !i.propria} · {saltos(i.saltos)}{/if}
        {#if i.cifrada}<Icone nome="cadeado" tamanho={12} titulo="cifrada" />{/if}
        {#if i.verificada}<Icone nome="escudo" tamanho={12} titulo="origem verificada" />{/if}
        {#if i.propria && i.estado}
          · <span class="estado {i.estado}">
            <Icone nome={i.estado === 'entregue' ? 'checkDuplo' : i.estado === 'pendente' ? 'relogio' : 'check'} tamanho={12} />
            {TEXTO_ESTADO[i.estado]}
          </span>
        {/if}
      </footer>
    </article>
  {:else}
    <p class="suave vazio">
      Nenhuma mensagem aqui ainda. O que você escrever sai pelo canal mais barato que estiver ligado; se ninguém
      responder, o núcleo tenta outro sozinho.
    </p>
  {/each}
</section>

<form class="escrever" onsubmit={enviar}>
  <label class="importante" title="Mandar por todos os canais de uma vez">
    <input type="checkbox" bind:checked={importante} />
    <Icone nome="alerta" tamanho={18} />
    <span class="oculto-visualmente">Importante: mandar por todos os canais</span>
  </label>
  <input bind:value={texto} placeholder={privada ? 'Mensagem particular' : `Mensagem para #${app.conversaAtual?.nome}`} maxlength="1000" />
  <button type="button" class:gravando onclick={alternarGravacao} aria-label={gravando ? 'Parar e enviar gravação' : 'Gravar mensagem de voz'} disabled={privada}>
    <Icone nome={gravando ? 'parar' : 'microfone'} />
  </button>
  <button class="primario" type="submit" aria-label="Enviar" disabled={!texto.trim()}>
    <Icone nome="enviar" />
  </button>
</form>

<style>
  .cabecalho {
    display: grid;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }

  .mensagens {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    max-height: calc(100dvh - 300px);
    min-height: 200px;
    overflow-y: auto;
    padding: 0.25rem;
  }

  .bolha {
    max-width: 85%;
    background: var(--superficie);
    border: 1px solid var(--borda);
    border-radius: 14px 14px 14px 4px;
    padding: 0.5rem 0.75rem;
    align-self: flex-start;
  }

  .bolha.propria {
    align-self: flex-end;
    background: color-mix(in srgb, var(--acento) 18%, var(--superficie));
    border-radius: 14px 14px 4px 14px;
  }

  .bolha.anonima {
    border-style: dashed;
  }

  .bolha p {
    margin: 0.1rem 0 0.25rem;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .autor {
    font-size: 0.8rem;
    color: var(--acento);
  }

  footer {
    display: flex;
    gap: 0.25rem;
    align-items: center;
    flex-wrap: wrap;
  }

  .estado.entregue {
    color: var(--verde);
  }

  .estado.pendente {
    color: var(--acento);
  }

  .voz {
    min-height: 36px;
    margin: 0.25rem 0;
  }

  .vazio {
    text-align: center;
    margin: 2rem 1rem;
  }

  .escrever {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(60px + env(safe-area-inset-bottom));
    display: flex;
    gap: 0.4rem;
    padding: 0.6rem 0.75rem;
    background: var(--fundo);
    border-top: 1px solid var(--borda);
    z-index: 8;
  }

  .escrever input:not([type='checkbox']) {
    flex: 1;
  }

  .importante {
    display: flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0 0.3rem;
  }

  .importante input {
    width: auto;
    min-height: 0;
    accent-color: var(--vermelho);
  }

  button.gravando {
    background: var(--vermelho);
    color: #fff;
  }
</style>
