<script lang="ts">
  import { app } from '../lib/estado.svelte.ts';

  let apelido = $state(app.apelido);

  async function entrar(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    await app.iniciar(apelido);
  }

  const cliente = app.ambiente.cliente;
</script>

<section class="inicio">
  <img src="./icones/icone.svg" alt="" width="88" height="88" />
  <h1>Comunicação Offline</h1>
  <p class="suave">
    Converse com quem está por perto sem internet: por som, QR, rede local, luz
    {cliente === 'web' ? '' : ', Bluetooth e Wi-Fi direto'}. Ninguém precisa de cadastro.
  </p>

  <form onsubmit={entrar} class="pilha">
    <label class="campo">
      Como quer ser chamado?
      <input bind:value={apelido} maxlength="24" placeholder="Seu apelido" autocomplete="nickname" required />
    </label>
    <button class="primario" type="submit" disabled={app.iniciando}>
      {app.iniciando ? 'Ligando...' : 'Entrar'}
    </button>
  </form>

  <p class="suave pequeno">
    A cada abertura o aparelho cria uma identidade nova. Mensagens privadas são cifradas de ponta a ponta.
    {#if cliente === 'web' && !app.ambiente.seguro}
      Esta página foi aberta sem HTTPS: câmera e microfone ficam bloqueados pelo navegador, mas a conversa
      pela rede local funciona.
    {/if}
  </p>
</section>

<style>
  .inicio {
    max-width: 460px;
    margin: 0 auto;
    padding: 2.5rem 1.25rem;
    display: grid;
    gap: 1rem;
    text-align: center;
  }

  img {
    margin: 0 auto;
    border-radius: 22px;
  }

  form {
    text-align: left;
  }
</style>
