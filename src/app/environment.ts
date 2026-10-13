import { frameProcessingSupported } from '../capture/captureController';
import { chromeTranslatorSupported } from '../translate/chromeEngine';

export interface Environment {
  screenShare: boolean;
  frameProcessing: boolean;
  translator: boolean;
  pip: boolean;
}

export function checkEnvironment(): Environment {
  return {
    screenShare: typeof navigator.mediaDevices?.getDisplayMedia === 'function',
    frameProcessing: frameProcessingSupported(),
    translator: chromeTranslatorSupported(),
    pip: 'documentPictureInPicture' in window,
  };
}
