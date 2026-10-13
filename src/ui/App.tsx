import { IconLanguage, IconSettings } from '@tabler/icons-react';
import type { OverlingoController } from '../app/controller';
import { useStore } from '../state/store';
import { Banner } from './common';
import { LiveView } from './LiveView';
import { RegionSelect } from './RegionSelect';
import { SettingsPanel } from './SettingsPanel';
import { StartScreen } from './StartScreen';

export function App({ controller }: { controller: OverlingoController }) {
  const ui = useStore(controller.ui);
  return (
    <div className="app">
      <header className="header">
        <IconLanguage size={26} className="logo" aria-hidden />
        <div>
          <h1>Overlingo</h1>
          <p className="muted small">화면 속 채팅과 자막을 실시간으로 번역해요</p>
        </div>
        <button className="push" onClick={() => controller.openSettings(true)}>
          <IconSettings size={18} />
          설정
        </button>
      </header>
      {ui.error && (
        <Banner tone="danger" onClose={() => controller.dismissError()}>
          {ui.error}
        </Banner>
      )}
      {ui.view === 'start' && <StartScreen controller={controller} />}
      {ui.view === 'select' && <RegionSelect controller={controller} />}
      {ui.view === 'live' && <LiveView controller={controller} />}
      {ui.settingsOpen && <SettingsPanel controller={controller} />}
    </div>
  );
}
