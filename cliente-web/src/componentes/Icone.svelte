<script lang="ts">
  // Ícones de traço em 24x24, desenhados para a plataforma.
  const CAMINHOS: Record<string, string> = {
    radar: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0 -18 0M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M12 12l6 -6',
    mapa: 'M9 4l-6 2v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
    conversa: 'M4 5h16v11H9l-5 4V5z',
    canais: 'M12 13v8M8.5 9.5a5 5 0 0 1 7 0M5.6 6.6a9 9 0 0 1 12.8 0M12 12.5a.5.5 0 1 0 0-1',
    perfil: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
    microfone: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3zM5 11a7 7 0 0 0 14 0M12 18v3',
    enviar: 'M4 12l16-8-6 16-2-6-8-2z',
    qr: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2',
    luz: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.6.6 1 1.4 1 2.5h6c0-1.1.4-1.9 1-2.5A6 6 0 0 0 12 3z',
    som: 'M4 10v4h4l5 4V6L8 10H4zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
    'som-morse': 'M3 12h3M8 12h8M18 12h3',
    wifi: 'M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0M12 19.5h.01',
    ble: 'M7 7l10 10-5 4V3l5 4L7 17',
    nfc: 'M6 8a8 8 0 0 1 0 8M10 6a12 12 0 0 1 0 12M14 4a16 16 0 0 1 0 16',
    radio: 'M4 9h16v11H4zM8 9l9-5M8 14.5a1.5 1.5 0 1 0 0 .01M13 13h4M13 16h4',
    'rede-local': 'M3 5h18v10H3zM8 19h8M12 15v4',
    cadeado: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 8 0v4',
    check: 'M5 12l4 4 10-10',
    checkDuplo: 'M2 12l4 4 10-10M10 16l1 1 10-10',
    relogio: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2',
    camera: 'M4 7h4l2-3h4l2 3h4v13H4zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    fechar: 'M6 6l12 12M18 6L6 18',
    voltar: 'M15 5l-7 7 7 7',
    tocar: 'M7 4l13 8-13 8z',
    parar: 'M6 6h12v12H6z',
    mais: 'M12 5v14M5 12h14',
    alerta: 'M12 3l10 18H2L12 3zM12 10v4M12 17.5h.01',
    escudo: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z',
    bateria: 'M3 8h16v8H3zM21 11v2',
    baixar: 'M12 4v12M7 11l5 5 5-5M5 20h14',
    memoria: 'M6 6h12v12H6zM9 3v3M15 3v3M9 18v3M15 18v3M3 9h3M3 15h3M18 9h3M18 15h3',
  };

  let { nome, tamanho = 22, titulo }: { nome: string; tamanho?: number; titulo?: string } = $props();
</script>

<svg
  width={tamanho}
  height={tamanho}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="2"
  stroke-linecap="round"
  stroke-linejoin="round"
  role={titulo ? 'img' : undefined}
  aria-hidden={titulo ? undefined : 'true'}
  aria-label={titulo}
>
  <path d={CAMINHOS[nome] ?? CAMINHOS.canais} />
</svg>
