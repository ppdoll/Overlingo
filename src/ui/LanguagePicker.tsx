import { IconArrowRight } from '@tabler/icons-react';
import type { OverlingoController } from '../app/controller';
import { AUTO, LANGUAGES } from '../core/languages';
import { useStore } from '../state/store';

export function LanguagePicker({ controller }: { controller: OverlingoController }) {
  const { source, target } = useStore(controller.settings);
  return (
    <div className="languages">
      <select aria-label="원문 언어" value={source} onChange={(e) => controller.updateSettings({ source: e.target.value })}>
        <option value={AUTO}>자동 감지</option>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
      <IconArrowRight size={18} className="muted" aria-hidden />
      <select aria-label="번역할 언어" value={target} onChange={(e) => controller.updateSettings({ target: e.target.value })}>
        {LANGUAGES.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    </div>
  );
}
