<script lang="ts">
  import Icone from './Icone.svelte';
  import { app } from '../lib/estado.svelte.ts';

  let apertado = $state(false);
  const aoVivo = $derived(app.canais.some((c) => c.ativo && c.capacidades.aoVivo));
  const ocupado = $derived(app.ptt.tipo === 'outro');

  async function apertar(ev: PointerEvent): Promise<void> {
    (ev.currentTarget as HTMLElement).setPointerCapture?.(ev.pointerId);
    if (apertado || !app.voz) return;
    apertado = true;
    const ok = await app.voz.apertar();
    if (!ok) {
      apertado = false;
      if (ocupado) app.avisar('O canal está ocupado: espere a outra pessoa terminar.');
    }
  }

  async function soltar(): Promise<void> {
    if (!apertado) return;
    apertado = false;
    await app.voz?.soltar();
  }

  async function teclado(ev: KeyboardEvent, descendo: boolean): Promise<void> {
    if (ev.key !== ' ' && ev.key !== 'Enter') return;
    ev.preventDefault();
    if (descendo && !ev.repeat) await apertar(new PointerEvent('pointerdown'));
    if (!descendo) await soltar();
  }
</script>

{#if aoVivo}
  <div class="area">
    <button
      class="falar"
      class:apertado
      class:ocupado
      disabled={ocupado && !apertado}
      onpointerdown={apertar}
      onpointerup={soltar}
      onpointercancel={soltar}
      onkeydown={(e) => teclado(e, true)}
      onkeyup={(e) => teclado(e, false)}
      oncontextmenu={(e) => e.preventDefault()}
      aria-pressed={apertado}
      style="--nivel: {apertado ? app.nivelMicrofone : 0}"
    >
      <Icone nome="microfone" tamanho={30} />
      <span>
        {#if apertado}Falando com #{app.conversaAtual?.nome}... solte para terminar
        {:else if ocupado}{app.ptt.tipo === 'outro' ? (app.ptt.apelido ?? 'Alguém') : ''} está falando
        {:else}Segure para falar com #{app.conversaAtual?.nome}{/if}
      </span>
    </button>
  </div>
{/if}

<style>
  .area {
    position: fixed;
    left: 0;
    right: 0;
    bottom: calc(68px + env(safe-area-inset-bottom));
    display: flex;
    justify-content: center;
    padding: 0 1rem;
    z-index: 9;
    pointer-events: none;
  }

  .falar {
    pointer-events: auto;
    width: min(100%, 520px);
    min-height: 68px;
    border-radius: 34px;
    background: var(--acento);
    color: var(--acento-texto);
    font-weight: 700;
    border: none;
    box-shadow: var(--sombra);
    user-select: none;
    -webkit-user-select: none;
    touch-action: none;
  }

  .falar.apertado {
    background: var(--verde);
    box-shadow: 0 0 0 calc(4px + var(--nivel) * 24px) color-mix(in srgb, var(--verde) 35%, transparent);
  }

  .falar.ocupado:not(.apertado) {
    background: var(--superficie-2);
    color: var(--texto-suave);
  }
</style>
