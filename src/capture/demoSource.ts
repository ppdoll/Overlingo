import type { Mode, NormRect } from '../core/types';

// A fake desktop with a video player and a game chat, drawn on a canvas and captured as a
// MediaStream. Lets people try the app without sharing their screen, and exercises the exact
// same pipeline as a real screen share.

const WIDTH = 1280;
const HEIGHT = 720;
const SUBTITLE_SECONDS = 3.5;
const CHAT_SECONDS = 2.5;
const VISIBLE_CHAT_LINES = 11;

const SUBTITLES = [
  "I never thought I'd see you here again.",
  'Where have you been all this time?',
  "It doesn't matter now. We have to leave.",
  'Wait. Someone is coming.',
];

const CHAT: [string, string][] = [
  ['Kenji', '次のラウンド行く？'],
  ['Mia', 'gg, that was close lol'],
  ['Sam', 'wait for me, brb'],
  ['Kenji', 'ナイス！'],
  ['Mia', '3, 2, 1, go'],
  ['Sam', '右から来てる！'],
  ['Kenji', 'on it'],
  ['Mia', '回復お願いします'],
  ['Sam', 'omw, hold on'],
  ['Kenji', 'あと一人だけ！'],
];

/** Regions that frame the demo's subtitle line and chat messages. */
export const DEMO_REGIONS: Record<Mode, NormRect> = {
  subtitle: { x: 60 / WIDTH, y: 455 / HEIGHT, w: 760 / WIDTH, h: 70 / HEIGHT },
  chat: { x: 884 / WIDTH, y: 92 / HEIGHT, w: 352 / WIDTH, h: 584 / HEIGHT },
};

export function startDemoStream(): { stream: MediaStream; stop: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const startedAt = performance.now();

  const draw = () => {
    const t = (performance.now() - startedAt) / 1000;
    ctx.fillStyle = '#d8dde3';
    ctx.fillRect(0, 0, WIDTH, HEIGHT);
    drawPlayer(ctx, t);
    drawChat(ctx, t);
  };

  draw();
  const timer = window.setInterval(draw, 100);
  const stream = canvas.captureStream(10);
  return {
    stream,
    stop: () => {
      window.clearInterval(timer);
      for (const track of stream.getTracks()) track.stop();
    },
  };
}

function drawPlayer(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = '#2c2c2a';
  ctx.fillRect(40, 40, 800, 520);
  ctx.fillStyle = '#444441';
  ctx.fillRect(40, 40, 800, 36);
  ctx.fillStyle = '#d3d1c7';
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('동영상 플레이어', 56, 64);

  // Moving shapes, so the background behind the subtitle changes like real video.
  ctx.fillStyle = '#5f5e5a';
  ctx.beginPath();
  ctx.arc(220 + 70 * Math.sin(t), 250, 95, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6b6a64';
  ctx.fillRect(500 + 50 * Math.cos(t * 0.7), 170, 240, 190);

  const phase = t % SUBTITLE_SECONDS;
  if (phase < SUBTITLE_SECONDS - 0.4) {
    const line = SUBTITLES[Math.floor(t / SUBTITLE_SECONDS) % SUBTITLES.length];
    ctx.font = '600 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(line, 440, 502);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, 440, 502);
  }
}

function drawChat(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(880, 40, 360, 640);
  ctx.fillStyle = '#f1efe8';
  ctx.fillRect(880, 40, 360, 36);
  ctx.fillStyle = '#5f5e5a';
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('채팅', 896, 64);

  const total = 3 + Math.floor(t / CHAT_SECONDS);
  const first = Math.max(0, total - VISIBLE_CHAT_LINES);
  ctx.font = '22px sans-serif';
  ctx.fillStyle = '#1f1e1c';
  for (let i = first; i < total; i++) {
    const [name, text] = CHAT[i % CHAT.length];
    ctx.fillText(`[${name}] ${text}`, 896, 122 + (i - first) * 50);
  }
}
