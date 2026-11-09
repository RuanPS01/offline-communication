<script lang="ts">
  import type { Component } from 'svelte';
  import Icone from '../componentes/Icone.svelte';
  import PainelLuz from '../componentes/paineis/PainelLuz.svelte';
  import PainelNfc from '../componentes/paineis/PainelNfc.svelte';
  import PainelQr from '../componentes/paineis/PainelQr.svelte';
  import PainelRadio from '../componentes/paineis/PainelRadio.svelte';
  import PainelRedeLocal from '../componentes/paineis/PainelRedeLocal.svelte';
  import PainelSom from '../componentes/paineis/PainelSom.svelte';
  import PainelSomMorse from '../componentes/paineis/PainelSomMorse.svelte';
  import { app } from '../lib/estado.svelte.ts';
  import { DESCRICAO_CANAL } from '../lib/canais.ts';
  import { metros, vazao } from '../lib/formato.ts';

  const PAINEIS: Record<string, Component | undefined> = {
    qr: PainelQr,
    som: PainelSom,
    luz: PainelLuz,
    'som-morse': PainelSomMorse,
    'rede-local': PainelRedeLocal,
    nfc: PainelNfc,
    radio: PainelRadio,
  };

  /** Painéis que valem mesmo com o canal desligado (instruções, servidor). */
  const PAINEL_SEMPRE = new Set(['rede-local', 'radio']);

  let aberto = $state<string | undefined>('qr');
  let mudando = $state<string | undefined>();

  async function alternar(id: string, ligar: boolean): Promise<void> {
    mudando = id;
    await app.alternarCanal(id, ligar);
    mudando = undefined;
    if (ligar) aberto = id;
  }
</script>

<h2>Canais</h2>
<p class="suave pequeno">
  O núcleo escolhe sozinho por onde mandar cada mensagem. Aqui você liga, desliga e usa os canais que exigem um
  gesto (mirar a câmera, piscar a lanterna, encostar).
</p>

<div class="lista">
  {#each app.canais as c (c.id)}
    {@const Painel = PAINEIS[c.id]}
    <section class="cartao canal" class:ligado={c.ativo}>
      <header>
        <button class="titulo" onclick={() => (aberto = aberto === c.id ? undefined : c.id)} aria-expanded={aberto === c.id}>
          <Icone nome={c.id} />
          <span class="nome">
            <strong>{c.nome}</strong>
            <span class="pequeno suave">
              {#if c.ativo}
                Ligado{c.vizinhos ? ` · ${c.vizinhos} por perto` : ''}
              {:else if c.disponivel === false}
                Indisponível{c.erro ? `: ${c.erro}` : ''}
              {:else}
                Desligado
              {/if}
            </span>
          </span>
        </button>
        <label class="interruptor">
          <span class="oculto-visualmente">Ligar {c.nome}</span>
          <input
            type="checkbox"
            checked={c.ativo}
            disabled={mudando === c.id}
            onchange={(e) => alternar(c.id, (e.currentTarget as HTMLInputElement).checked)}
          />
        </label>
      </header>
      {#if aberto === c.id}
        <div class="detalhe">
          <p class="pequeno">{DESCRICAO_CANAL[c.id] ?? ''}</p>
          <p class="pequeno suave">
            {vazao(c.capacidades.bytesPorSegundo)} · alcance {metros(c.capacidades.alcanceMetros)}
            {c.capacidades.aoVivo ? ' · voz ao vivo' : ''}
            {c.capacidades.somenteTexto ? ' · só texto' : ''}
          </p>
          {#if app.errosCanal[c.id]}
            <p class="pequeno erro">Último erro: {app.errosCanal[c.id]}</p>
          {/if}
          {#if Painel && (c.ativo || PAINEL_SEMPRE.has(c.id))}
            <Painel />
          {:else if Painel && !c.ativo && c.disponivel !== false}
            <button class="primario" onclick={() => alternar(c.id, true)}>Ligar {c.nome}</button>
          {/if}
        </div>
      {/if}
    </section>
  {/each}
</div>

<style>
  .lista {
    display: grid;
    gap: 0.6rem;
  }

  .canal {
    padding: 0.5rem 0.75rem;
  }

  .canal.ligado {
    border-color: color-mix(in srgb, var(--verde) 60%, var(--borda));
  }

  header {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .titulo {
    flex: 1;
    justify-content: flex-start;
    background: none;
    border: none;
    padding: 0.25rem 0;
    text-align: left;
    gap: 0.75rem;
  }

  .nome {
    display: grid;
  }

  .detalhe {
    border-top: 1px solid var(--borda);
    margin-top: 0.5rem;
    padding-top: 0.75rem;
  }

  .erro {
    color: var(--vermelho);
  }
</style>
