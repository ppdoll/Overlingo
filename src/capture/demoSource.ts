import type { Mode, NormRect } from '../core/types';
import { wrapText } from '../core/wrap';

// A fake desktop with a video player and a game chat. The web app captures it as a MediaStream
// and the desktop app shows it in a window of its own, so both can be tried without a real
// video or messenger, through the exact same pipeline.

const WIDTH = 1280;
const HEIGHT = 720;
export const DEMO_SIZE = { width: WIDTH, height: HEIGHT };
const SUBTITLE_SECONDS = 3.5;
const CHAT_SECONDS = 3;

const SUBTITLES = [
  "I never thought I'd see you here again.",
  'Where have you been all this time?',
  "It doesn't matter now. We have to go.",
  'Wait. Someone is coming.',
];

// The video player on the left; its subtitle line is centered under the picture.
const PLAYER = { x: 40, y: 40, w: 560, h: 520 };
const SUBTITLE_X = PLAYER.x + PLAYER.w / 2;
const SUBTITLE_Y = 502;

/** `from: null` is you: your messages sit on the right, like in a real messenger. */
const CHAT: { from: string | null; text: string }[] = [
  { from: 'Kenji', text: '次のラウンド行く？' },
  { from: 'Mia', text: 'gg, that was close lol. I really thought we were going to lose that one.' },
  { from: null, text: 'wait for me, brb' },
  { from: 'Sam', text: '右から来てる！気をつけて' },
  { from: 'Mia', text: "Nice save!\n\nLet's group up near the bridge before the next wave." },
  { from: null, text: 'omw, hold on' },
  { from: 'Kenji', text: 'あと一人だけ！回復お願いします' },
  { from: 'Sam', text: 'gg everyone, same time tomorrow?' },
];

const NAME_COLORS: Record<string, string> = { Kenji: '#c0582b', Mia: '#2e7bb8', Sam: '#8a4bb0' };

// The chat panel, Telegram style: bubbles on a patterned green background. The desktop to its
// right stays empty, so the desktop app's overlay has room for translations there.
const PANEL = { x: 640, y: 40, w: 360, h: 640, header: 36 };
const BODY_TOP = PANEL.y + PANEL.header;
const BODY_BOTTOM = PANEL.y + PANEL.h;
const BUBBLE = { maxText: 250, padX: 12, padY: 10, line: 24, name: 22, gap: 10 };

/** Regions that frame the demo's subtitle line and chat messages. */
export const DEMO_REGIONS: Record<Mode, NormRect> = {
  subtitle: { x: (PLAYER.x + 10) / WIDTH, y: 466 / HEIGHT, w: (PLAYER.w - 20) / WIDTH, h: 54 / HEIGHT },
  chat: { x: PANEL.x / WIDTH, y: BODY_TOP / HEIGHT, w: PANEL.w / WIDTH, h: (BODY_BOTTOM - BODY_TOP) / HEIGHT },
};

/** Fixed doodle positions for the chat background. */
const DOODLES = Array.from({ length: 70 }, (_, i) => ({
  x: PANEL.x + ((i * 97) % PANEL.w),
  y: BODY_TOP + ((i * 61) % (BODY_BOTTOM - BODY_TOP)),
  r: 3 + (i % 4),
}));

export function startDemoStream(): { stream: MediaStream; stop: () => void } {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  const startedAt = performance.now();
  const draw = () => drawDemo(ctx, (performance.now() - startedAt) / 1000);

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

/** Draws the whole sample desktop as it looks `t` seconds in. */
export function drawDemo(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = '#d8dde3';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  drawPlayer(ctx, t);
  drawChat(ctx, t);
}

function drawPlayer(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = '#2c2c2a';
  ctx.fillRect(PLAYER.x, PLAYER.y, PLAYER.w, PLAYER.h);
  ctx.fillStyle = '#444441';
  ctx.fillRect(PLAYER.x, PLAYER.y, PLAYER.w, 36);
  ctx.fillStyle = '#d3d1c7';
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('동영상 플레이어', PLAYER.x + 16, PLAYER.y + 24);

  // Moving shapes, so the background behind the subtitle changes like real video.
  ctx.fillStyle = '#5f5e5a';
  ctx.beginPath();
  ctx.arc(190 + 60 * Math.sin(t), 250, 90, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6b6a64';
  ctx.fillRect(360 + 40 * Math.cos(t * 0.7), 170, 180, 180);

  const phase = t % SUBTITLE_SECONDS;
  if (phase < SUBTITLE_SECONDS - 0.4) {
    const line = SUBTITLES[Math.floor(t / SUBTITLE_SECONDS) % SUBTITLES.length];
    ctx.font = '600 26px sans-serif';
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#000000';
    ctx.strokeText(line, SUBTITLE_X, SUBTITLE_Y);
    ctx.fillStyle = '#ffffff';
    ctx.fillText(line, SUBTITLE_X, SUBTITLE_Y);
  }
}

function drawChat(ctx: CanvasRenderingContext2D, t: number) {
  ctx.fillStyle = '#f1efe8';
  ctx.fillRect(PANEL.x, PANEL.y, PANEL.w, PANEL.header);
  ctx.fillStyle = '#5f5e5a';
  ctx.font = '18px sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('게임 채팅', PANEL.x + 16, PANEL.y + 24);

  ctx.save();
  ctx.beginPath();
  ctx.rect(PANEL.x, BODY_TOP, PANEL.w, BODY_BOTTOM - BODY_TOP);
  ctx.clip();
  ctx.fillStyle = '#c9dcb4';
  ctx.fillRect(PANEL.x, BODY_TOP, PANEL.w, BODY_BOTTOM - BODY_TOP);
  ctx.strokeStyle = '#b4cb9c';
  ctx.lineWidth = 2;
  for (const d of DOODLES) {
    ctx.beginPath();
    ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Newest message at the bottom; older ones scroll off the top.
  const total = 3 + Math.floor(t / CHAT_SECONDS);
  let bottom = BODY_BOTTOM - 12;
  for (let i = total - 1; i >= 0 && bottom > BODY_TOP; i--) {
    bottom = drawBubble(ctx, CHAT[i % CHAT.length], bottom) - BUBBLE.gap;
  }
  ctx.restore();
}

/** Draws one message bubble ending at `bottom` and returns its top. */
function drawBubble(ctx: CanvasRenderingContext2D, message: { from: string | null; text: string }, bottom: number): number {
  ctx.font = '18px sans-serif';
  const lines = wrapText(message.text, BUBBLE.maxText, (line) => ctx.measureText(line).width);
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width));
  ctx.font = '600 16px sans-serif';
  const nameWidth = message.from ? ctx.measureText(message.from).width : 0;
  const width = Math.max(textWidth, nameWidth) + BUBBLE.padX * 2;
  const height = BUBBLE.padY * 2 + (message.from ? BUBBLE.name : 0) + lines.length * BUBBLE.line;
  const top = bottom - height;
  const x = message.from ? PANEL.x + 12 : PANEL.x + PANEL.w - 12 - width;

  ctx.fillStyle = message.from ? '#ffffff' : '#e1fec6';
  ctx.beginPath();
  ctx.roundRect(x, top, width, height, 12);
  ctx.fill();

  let y = top + BUBBLE.padY;
  if (message.from) {
    ctx.fillStyle = NAME_COLORS[message.from] ?? '#2e7bb8';
    ctx.fillText(message.from, x + BUBBLE.padX, y + 16);
    y += BUBBLE.name;
  }
  ctx.font = '18px sans-serif';
  ctx.fillStyle = '#1f1e1c';
  for (const line of lines) {
    ctx.fillText(line, x + BUBBLE.padX, y + 18);
    y += BUBBLE.line;
  }
  return top;
}
