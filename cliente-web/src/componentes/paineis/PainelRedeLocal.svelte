<script lang="ts">
  import { qrSvg } from '@plataforma/canal-qr';
  import { ENDERECOS_HOTSPOT, type ServidorEncontrado } from '@plataforma/canal-rede-local';
  import { onDestroy } from 'svelte';
  import { app } from '../../lib/estado.svelte.ts';

  const nativo = app.canaisCliente!.redeLocalNativo;
  const web = app.canaisCliente!.redeLocal;
  let endereco = $state(`${ENDERECOS_HOTSPOT[0]}:8080`);
  let servidor = $state<{ enderecos: string[]; porta: number } | undefined>();
  let hotspot = $state<{ ssid: string; senha: string } | undefined>();
  let encontrados = $state<ServidorEncontrado[]>([]);
  let procurando = $state(false);
  let escuta: { remove(): Promise<void> } | undefined;

  onDestroy(() => {
    void escuta?.remove();
    if (procurando) void nativo?.rede.pararDescoberta();
  });

  function abrirEndereco(): void {
    const alvo = endereco.trim().replace(/^https?:\/\//, '');
    location.href = `http://${alvo}${alvo.includes(':') ? '' : ':8080'}/`;
  }

  async function virarServidor(): Promise<void> {
    if (!nativo) return;
    try {
      if (!app.canais.find((c) => c.id === 'rede-local')?.ativo) await app.alternarCanal('rede-local', true);
      if (app.ambiente.cliente === 'android') hotspot = await nativo.rede.criarHotspot().catch(() => undefined);
      servidor = await nativo.rede.iniciarServidor({ nome: `Rede de ${app.apelido}` });
    } catch (e) {
      app.avisar(`Não deu para virar servidor: ${e instanceof Error ? e.message : e}`, 'erro');
    }
  }

  async function pararServidor(): Promise<void> {
    await nativo?.rede.pararServidor();
    await nativo?.rede.pararHotspot().catch(() => undefined);
    servidor = undefined;
    hotspot = undefined;
  }

  async function procurar(): Promise<void> {
    if (!nativo) return;
    encontrados = [];
    escuta ??= await nativo.aoEncontrarServidor((s) => {
      if (!encontrados.some((e) => e.host === s.host && e.porta === s.porta)) encontrados = [...encontrados, s];
    });
    procurando = true;
    await nativo.rede.descobrir();
  }

  async function entrar(s: ServidorEncontrado): Promise<void> {
    if (!nativo) return;
    if (!app.canais.find((c) => c.id === 'rede-local')?.ativo) await app.alternarCanal('rede-local', true);
    await nativo.rede.conectar({ url: `ws://${s.host}:${s.porta}/ws` });
    app.avisar(`Conectado a ${s.nome}`);
  }
</script>

{#if nativo}
  <div class="pilha">
    <h3>Virar servidor</h3>
    {#if servidor}
      <p>Os outros entram no mesmo Wi-Fi{hotspot ? ' (ou no seu hotspot)' : ''} e abrem no navegador:</p>
      {#each servidor.enderecos as e (e)}
        <div class="endereco">
          <strong>{e}</strong>
          <div class="qr">{@html qrSvg(e)}</div>
        </div>
      {/each}
      {#if hotspot}
        <p>Hotspot: <strong>{hotspot.ssid}</strong>, senha <strong>{hotspot.senha}</strong></p>
      {/if}
      <button class="perigo" onclick={pararServidor}>Parar servidor</button>
    {:else}
      <p class="suave pequeno">
        Este celular sobe um servidor e se anuncia na rede. No Android o app também cria um hotspot; no iPhone,
        ligue o Compartilhamento de Internet à mão antes.
      </p>
      <button class="primario" onclick={virarServidor}>Virar servidor</button>
    {/if}
    <h3>Entrar numa rede próxima</h3>
    <button onclick={procurar}>{procurando ? 'Procurando...' : 'Procurar servidores'}</button>
    {#each encontrados as s (s.host + s.porta)}
      <button onclick={() => entrar(s)}>{s.nome} ({s.host}:{s.porta})</button>
    {/each}
  </div>
{:else}
  <div class="pilha">
    {#if app.ambiente.servidaPorRedeLocal}
      <p>
        Você abriu esta página pelo servidor de outro aparelho. Todos conectados a ele conversam entre si.
        {web?.info ? `Servidor: ${web.info.nome}.` : ''}
      </p>
    {:else}
      <h3>Entrar numa rede próxima</h3>
      <p class="suave pequeno">
        Conecte-se ao Wi-Fi ou hotspot de quem virou servidor e abra o endereço dele. Endereços comuns de hotspot:
        {ENDERECOS_HOTSPOT.join(', ')} (porta 8080).
      </p>
      <div class="linha">
        <input bind:value={endereco} inputmode="url" aria-label="Endereço do servidor" />
        <button class="primario" onclick={abrirEndereco}>Abrir</button>
      </div>
      <h3>Virar servidor</h3>
      <p class="suave pequeno">
        No Android com o app, é um toque. Num computador, rode
        <code>npx servidor-rede-local</code> na pasta do projeto (veja a página inicial) e compartilhe o endereço.
        O navegador sozinho não consegue abrir um servidor.
      </p>
    {/if}
  </div>
{/if}

<style>
  .endereco {
    display: grid;
    gap: 0.5rem;
    justify-items: center;
  }

  .qr {
    width: 200px;
    background: #fff;
    border-radius: 8px;
  }

  code {
    background: var(--superficie-2);
    padding: 0 0.3rem;
    border-radius: 4px;
  }
</style>
