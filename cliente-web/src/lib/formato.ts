import type { EstadoEnvio } from '@plataforma/nucleo';

export function hora(ms: number): string {
  return new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function haQuanto(ms: number, agora = Date.now()): string {
  const s = Math.max(0, Math.round((agora - ms) / 1000));
  if (s < 10) return 'agora';
  if (s < 60) return `há ${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `há ${m} min`;
  return `há ${Math.round(m / 60)} h`;
}

export function metros(m: number | undefined): string {
  if (m === undefined) return '';
  if (m < 1) return `${Math.round(m * 100)} cm`;
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(1).replace('.', ',')} km`;
}

export function saltos(n: number): string {
  if (n === 0) return 'direto';
  return n === 1 ? '1 salto' : `${n} saltos`;
}

export const TEXTO_ESTADO: Record<EstadoEnvio, string> = {
  pendente: 'guardada, esperando alguém',
  enviada: 'enviada',
  ouvida: 'ouvida por perto',
  entregue: 'entregue',
};

export function vazao(bps: number): string {
  if (bps >= 1000) return `${Math.round(bps / 1000)} kB/s`;
  return `${bps} B/s`;
}

/** Ângulo estável para quem não tem posição: derivado do id. */
export function anguloDoId(id: string): number {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return (h % 360) * (Math.PI / 180);
}

export function iniciais(apelido: string): string {
  const partes = apelido.trim().split(/\s+/);
  return ((partes[0]?.[0] ?? '?') + (partes[1]?.[0] ?? '')).toUpperCase();
}
