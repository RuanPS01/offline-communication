<script lang="ts">
  import { onMount } from 'svelte';
  import { app } from '../lib/estado.svelte.ts';

  let apelido = $state(app.apelido);
  let nomeCanal = $state('');
  let senhaCanal = $state('');
  let intervaloTeste = $state(10);
  let versaoTeste = $state(0);

  onMount(() => app.teste.observar(() => versaoTeste++));

  const resumo = $derived.by(() => {
    void versaoTeste;
    return app.teste.resumo();
  });
  // Relê as estatísticas do núcleo sempre que o tráfego muda.
  const estatisticas = $derived.by(() => {
    void app.trafego.entrada;
    void app.trafego.saida;
    return app.nucleo ? { ...app.nucleo.estatisticas } : undefined;
  });

  function entrar(ev: SubmitEvent): void {
    ev.preventDefault();
    app.entrarConversa(nomeCanal, senhaCanal);
    nomeCanal = '';
    senhaCanal = '';
  }

  function exportarTeste(): void {
    const blob = new Blob([app.teste.csv()], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `teste-de-campo-${new Date().toISOString().slice(0, 16)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
</script>

<div class="pilha">
  <section class="cartao pilha">
    <h2>Você</h2>
    <form class="linha" onsubmit={(e) => (e.preventDefault(), app.definirApelido(apelido))}>
      <input bind:value={apelido} maxlength="24" aria-label="Apelido" />
      <button type="submit">Salvar</button>
    </form>
    <p class="pequeno">
      Impressão digital desta sessão: <strong class="digital">{app.nucleo?.impressaoDigital}</strong><br />
      <span class="suave">Confira em voz alta com quem estiver numa conversa particular. Muda a cada abertura.</span>
    </p>
    <label class="interruptor">
      <span>Compartilhar minha posição (GPS) com quem está por perto</span>
      <input type="checkbox" checked={app.compartilharPosicao} onchange={(e) => app.definirCompartilharPosicao((e.currentTarget as HTMLInputElement).checked)} />
    </label>
    <label class="interruptor">
      <span>Modo rádio ligado (tela ativa{app.ambiente.cliente === 'android' ? ' e serviço em segundo plano' : ''})</span>
      <input type="checkbox" checked={app.radioLigado} onchange={() => app.alternarModoRadio()} />
    </label>
  </section>

  <section class="cartao pilha">
    <h2>Canais de conversa</h2>
    {#each app.conversas as c (c.id)}
      <div class="linha entre">
        <span>#{c.nome} {c.privado ? '(privado, cifrado)' : '(público)'}</span>
        {#if !(c.nome === 'geral' && !c.privado)}
          <button class="perigo" onclick={() => app.sairConversa(c.id)}>Sair</button>
        {/if}
      </div>
    {/each}
    <form class="pilha" onsubmit={entrar}>
      <input bind:value={nomeCanal} placeholder="Nome do canal (ex.: familia)" maxlength="16" required />
      <input bind:value={senhaCanal} type="password" placeholder="Senha (deixe vazio para canal público)" autocomplete="off" />
      <button type="submit" class="primario">Entrar no canal</button>
    </form>
    <p class="pequeno suave">Quem não tem a senha só retransmite, sem conseguir ler.</p>
  </section>

  <section class="cartao pilha">
    <h2>Teste de campo</h2>
    <p class="pequeno suave">
      Um aparelho manda mensagens numeradas; os outros registram canal, saltos e atraso. Leve os aparelhos para campo
      aberto e para dentro de prédios e exporte o resultado.
    </p>
    <div class="linha">
      <label class="campo">
        Intervalo (s)
        <input type="number" min="2" max="300" bind:value={intervaloTeste} />
      </label>
      {#if app.teste.ativo}
        <button onclick={() => app.teste.parar()}>Parar envio ({app.teste.enviados})</button>
      {:else}
        <button onclick={() => app.nucleo && app.teste.iniciar(app.nucleo, intervaloTeste)}>Começar a enviar</button>
      {/if}
    </div>
    <p class="pequeno">
      Recebidas: {resumo.recebidas} · perdidas: {resumo.perdidas}
      {resumo.latenciaMedianaMs !== undefined ? ` · atraso mediano ${resumo.latenciaMedianaMs} ms` : ''}
    </p>
    <div class="linha">
      <button onclick={exportarTeste} disabled={!resumo.recebidas}>Exportar CSV</button>
      <button onclick={() => app.teste.limpar()}>Limpar</button>
    </div>
  </section>

  <section class="cartao pilha">
    <h2>Diagnóstico</h2>
    {#if estatisticas}
      <p class="pequeno">
        Pacotes recebidos {estatisticas.recebidos} · enviados {estatisticas.enviados} · retransmitidos
        {estatisticas.retransmitidos} · duplicados descartados {estatisticas.duplicados} · inválidos
        {estatisticas.invalidos} · fila store-and-forward {app.nucleo?.fila.tamanho ?? 0}
      </p>
    {/if}
    <p class="pequeno suave">
      Versão {__VERSAO__} · cliente {app.ambiente.cliente} · {app.ambiente.seguro ? 'contexto seguro' : 'sem HTTPS'}
    </p>
    <button class="perigo" onclick={() => app.limparHistorico()}>Apagar histórico de mensagens</button>
  </section>
</div>

<style>
  .digital {
    font-family: ui-monospace, monospace;
    letter-spacing: 0.05em;
  }

  .entre {
    justify-content: space-between;
  }
</style>
