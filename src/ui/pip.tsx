import { createRoot } from 'react-dom/client';
import type { OverlingoController } from '../app/controller';
import { PipView } from './PipView';

export function pipSupported(): boolean {
  return window.documentPictureInPicture !== undefined;
}

/**
 * Opens the always-on-top translation window (Document Picture-in-Picture). It needs user
 * activation, so call it straight from a click handler: requestWindow runs before any await.
 * If it can't open, the translations are still shown in the main tab.
 */
export async function openPip(controller: OverlingoController): Promise<void> {
  const api = window.documentPictureInPicture;
  if (!api || api.window) return;
  let pipWindow: Window;
  try {
    pipWindow = await api.requestWindow({ width: 440, height: controller.settings.get().mode === 'chat' ? 300 : 170 });
  } catch {
    return;
  }

  copyStyles(pipWindow.document);
  pipWindow.document.title = 'Overlingo';
  const container = pipWindow.document.createElement('div');
  pipWindow.document.body.append(container);
  const root = createRoot(container);
  root.render(<PipView controller={controller} />);
  controller.setPipWindow(pipWindow);
  pipWindow.addEventListener('pagehide', () => {
    root.unmount();
    controller.setPipWindow(null);
  });
}

function copyStyles(target: Document) {
  for (const node of document.head.querySelectorAll('style')) target.head.append(node.cloneNode(true));
  for (const link of document.head.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"]')) {
    const copy = target.createElement('link');
    copy.rel = 'stylesheet';
    // The PiP document is about:blank, so relative URLs wouldn't resolve there.
    copy.href = link.href;
    target.head.append(copy);
  }
}
