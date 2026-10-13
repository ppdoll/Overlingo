import { IconX } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { AUTO, findLanguage } from '../core/languages';

export function Banner({
  tone,
  children,
  action,
  onClose,
}: {
  tone: 'info' | 'warning' | 'danger';
  children: ReactNode;
  action?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className={`banner ${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span>{children}</span>
      <span className="push row">
        {action}
        {onClose && (
          <button className="icon ghost" aria-label="닫기" onClick={onClose}>
            <IconX size={16} />
          </button>
        )}
      </span>
    </div>
  );
}

export function languageLabel(code: string): string {
  if (code === AUTO) return '자동 감지';
  return findLanguage(code)?.label ?? code;
}

export function formatTime(at: number): string {
  return new Date(at).toLocaleTimeString('ko-KR', { hour12: false });
}
