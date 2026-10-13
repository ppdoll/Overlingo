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
}

/** Opens a selector over every monitor; the choice arrives through `onRegionSelected`. */
export function startRegionSelect(): Promise<void> {
  return invoke('start_region_select');
}

export function onRegionSelected(handler: (region: ScreenRect | null) => void): Promise<UnlistenFn> {
  return listen<ScreenRect | null>('region-selected', (event) => handler(event.payload));
}

/** Captures `region` after `waitMs`. The wait happens natively, so it isn't throttled. */
export async function captureRegion(region: ScreenRect, waitMs: number): Promise<RawImage> {
  const buffer = await invoke<ArrayBuffer>('capture_region', { region, waitMs });
  const header = new DataView(buffer, 0, 8);
  return { buffer, offset: 8, width: header.getUint32(0, true), height: header.getUint32(4, true) };
}

export function showOverlay(region: ScreenRect): Promise<void> {
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
 * Opens the sample chat window and returns where `part` of it (its chat panel or subtitle
 * line) is on screen. `onMove` gets the new position whenever the window moves or comes to
 * the front.
 */
export async function openDemoWindow(part: NormRect, onMove: (region: ScreenRect) => void): Promise<ScreenRect> {
  await invoke('open_demo');
  let demo: WebviewWindow | null = null;
  for (let attempt = 0; attempt < 50 && !demo; attempt++) {
    demo = await WebviewWindow.getByLabel('demo');
    if (!demo) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!demo) throw new Error('샘플 채팅 창을 열지 못했어요');
  const window = demo;
  // Let the window settle into its final position first.
  await new Promise((resolve) => setTimeout(resolve, 600));
  void window.onMoved(async () => onMove(await screenRectOf(window, part)));
  // Focusing the always-on-top sample puts it over the overlay; reporting it re-raises the overlay.
  void window.onFocusChanged(async ({ payload: focused }) => {
    if (focused) onMove(await screenRectOf(window, part));
  });
  return screenRectOf(window, part);
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
