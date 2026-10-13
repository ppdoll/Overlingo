import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen, type UnlistenFn } from '@tauri-apps/api/event';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { NormRect } from '../core/types';
import type { OverlayState } from '../overlay/state';

// Wrappers around the desktop app's native commands (src-tauri/src/lib.rs).

/** True inside the Tauri desktop app, false in a regular browser. */
export const isDesktop = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export const GUIDE_URL = isDesktop ? 'https://overlingo.vercel.app/guide.html' : '/guide.html';

/** Opens a link in the system browser on the desktop, or in a new tab on the web. */
export function openExternal(url: string): void {
  if (isDesktop) void openUrl(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}

/** A rectangle on the virtual desktop, in physical pixels. */
export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawImage {
  buffer: ArrayBuffer;
  /** Where the RGBA pixels start in `buffer`. */
  offset: number;
  width: number;
  height: number;
  /** How much of the region (0..1) another app's window covers, when following a window. */
  covered: number;
}

/** A window on screen, as the user picked it to translate. */
export interface PickedWindow {
  id: number;
  title: string;
  app: string;
  rect: ScreenRect;
}

/** What the user picked: a region, and the window it's part of when they picked a window. */
export interface RegionChoice {
  region: ScreenRect;
  window: PickedWindow | null;
}

/** A followed window right now. Hidden means minimized or on another virtual desktop. */
export type WindowState = { state: 'shown'; rect: ScreenRect } | { state: 'hidden' } | { state: 'gone' };

/** Opens a selector over every monitor; the choice arrives through `onRegionSelected`. */
export function startRegionSelect(): Promise<void> {
  return invoke('start_region_select');
}

export function onRegionSelected(handler: (choice: RegionChoice | null) => void): Promise<UnlistenFn> {
  return listen<RegionChoice | null>('region-selected', (event) => handler(event.payload));
}

/**
 * Captures `region` after `waitMs`. The wait happens natively, so it isn't throttled. With
 * `windowId`, also measures how much of the region other apps' windows cover.
 */
export async function captureRegion(region: ScreenRect, waitMs: number, windowId?: number): Promise<RawImage> {
  const buffer = await invoke<ArrayBuffer>('capture_region', { region, waitMs, window: windowId ?? null });
  const header = new DataView(buffer, 0, 12);
  return {
    buffer,
    offset: 12,
    width: header.getUint32(0, true),
    height: header.getUint32(4, true),
    covered: header.getUint32(8, true) / 100,
  };
}

/** Where window `id` is after `waitMs`, waited natively like `captureRegion`. */
export function windowState(id: number, waitMs: number): Promise<WindowState> {
  return invoke('window_state', { id, waitMs });
}

/** Shows the overlay over the monitor holding `region` and returns that monitor's rect. */
export function showOverlay(region: ScreenRect): Promise<ScreenRect> {
  return invoke('show_overlay', { region });
}

export function hideOverlay(): Promise<void> {
  return invoke('hide_overlay');
}

export function sendOverlayState(state: OverlayState): Promise<void> {
  return emitTo('overlay', 'overlay-state', state);
}

export function onOverlayReady(handler: () => void): Promise<UnlistenFn> {
  return listen('overlay-ready', handler);
}

/**
 * Opens the sample chat window and returns `part` of it (its chat panel or subtitle line) as
 * a region of a picked window, so it's followed like any other. `onFocus` is called when the
 * window comes to the front: being always on top too, it then covers the overlay.
 */
export async function openDemoWindow(part: NormRect, onFocus: () => void): Promise<RegionChoice> {
  const id = await invoke<number | null>('open_demo');
  let demo: WebviewWindow | null = null;
  for (let attempt = 0; attempt < 50 && !demo; attempt++) {
    demo = await WebviewWindow.getByLabel('demo');
    if (!demo) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!demo) throw new Error('샘플 채팅 창을 열지 못했어요');
  // Let the window settle into its final position first.
  await new Promise((resolve) => setTimeout(resolve, 600));
  void demo.onFocusChanged(({ payload: focused }) => {
    if (focused) onFocus();
  });
  const region = await screenRectOf(demo, part);
  const state = id === null ? null : await windowState(id, 0);
  const window =
    id !== null && state?.state === 'shown' ? { id, title: await demo.title(), app: 'Overlingo', rect: state.rect } : null;
  return { region, window };
}

/** Where `part` of a window's client area is on screen. The demo canvas fills it exactly. */
async function screenRectOf(window: WebviewWindow, part: NormRect): Promise<ScreenRect> {
  const position = await window.innerPosition();
  const size = await window.innerSize();
  return {
    x: Math.round(position.x + part.x * size.width),
    y: Math.round(position.y + part.y * size.height),
    width: Math.round(part.w * size.width),
    height: Math.round(part.h * size.height),
  };
}

export function closeDemoWindow(): Promise<void> {
  return invoke('close_demo');
}

/** Whether this window sits over `region`, where it would end up in the capture. */
export async function windowCovers(region: ScreenRect): Promise<boolean> {
  const window = getCurrentWindow();
  if (await window.isMinimized()) return false;
  const position = await window.outerPosition();
  const size = await window.outerSize();
  return (
    position.x < region.x + region.width &&
    region.x < position.x + size.width &&
    position.y < region.y + region.height &&
    region.y < position.y + size.height
  );
}

export function minimizeWindow(): Promise<void> {
  return getCurrentWindow().minimize();
}
