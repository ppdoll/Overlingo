import { DEMO_SIZE, drawDemo } from '../capture/demoSource';

// The sample desktop (video player and game chat) shown in a window of its own, so the
// desktop app's overlay can be tried without a real messenger.

const canvas = document.querySelector('canvas')!;
canvas.width = DEMO_SIZE.width;
canvas.height = DEMO_SIZE.height;
const ctx = canvas.getContext('2d')!;
const startedAt = performance.now();

function frame() {
  drawDemo(ctx, (performance.now() - startedAt) / 1000);
  requestAnimationFrame(frame);
}
frame();
