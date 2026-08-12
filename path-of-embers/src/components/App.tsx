'use client';

import { useEffect } from 'react';

import { useStore } from '@/lib/store';
import { useServerSync } from '@/lib/sync';
import type { ViewId } from '@/lib/types';

import { Backdrop } from './Backdrop';
import { BoardView } from './BoardView';
import { CharacterArt } from './CharacterArt';
import { CommandPalette } from './CommandPalette';
import { FilterBar } from './FilterBar';
import { GraphView } from './GraphView';
import { HelpOverlay, Toaster, VaultOverlay } from './Overlays';
import { Inspector } from './Inspector';
import { ListView } from './ListView';
import { StatsView } from './StatsView';
import { TimelineView } from './TimelineView';
import { TopBar } from './TopBar';

const VIEW_ORDER: ViewId[] = ['graph', 'board', 'list', 'timeline', 'stats'];

function isTyping(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    el.tagName === 'INPUT' ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
}

/** Every keyboard shortcut in one place, so none of them can quietly conflict. */
function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState();
      const mod = e.metaKey || e.ctrlKey;

      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        s.setPalette(!s.paletteOpen);
        return;
      }
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
        return;
      }
      if (e.key === 'Escape') {
        if (s.paletteOpen) s.setPalette(false);
        else if (s.helpOpen) s.setHelp(false);
        else if (s.vaultOpen) s.setVault(false);
        else if (s.linkingFrom) s.beginLink(null);
        else if (s.selectedId) s.select(null);
        return;
      }

      if (isTyping(e.target) || mod) return;

      switch (e.key) {
        case 'n':
        case 'N':
          e.preventDefault();
          s.addTask({ assignee: s.activeUser });
          break;
        case ' ':
          if (s.selectedId) {
            e.preventDefault();
            s.advance(s.selectedId);
          }
          break;
        case 'Tab':
          e.preventDefault();
          s.setActiveUser(s.activeUser === 'aina' ? 'onja' : 'aina');
          break;
        case 'f':
        case 'F':
          window.dispatchEvent(new CustomEvent('poe:fit'));
          break;
        case 'e':
        case 'E':
          s.setInspector(!s.inspectorOpen);
          break;
        case '?':
          s.setHelp(true);
          break;
        case '/': {
          e.preventDefault();
          const field = document.querySelector<HTMLInputElement>('input[aria-label="Search tasks"]');
          field?.focus();
          break;
        }
        default:
          if (/^[1-5]$/.test(e.key)) {
            s.setView(VIEW_ORDER[Number(e.key) - 1]!);
          }
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

function Loading() {
  return (
    <div className="grid h-dvh place-items-center bg-void">
      <div className="text-center">
        <div className="font-semibold text-[15px] text-parchment/70">Emberkeep</div>
        <div className="mt-2 text-[12px] italic text-muted">loading…</div>
      </div>
    </div>
  );
}

export function App() {
  const hydrated = useStore((s) => s.hydrated);
  const loaded = useStore((s) => s.loaded);
  const view = useStore((s) => s.view);
  const activeUser = useStore((s) => s.activeUser);
  useShortcuts();
  useServerSync();

  if (!hydrated || !loaded) return <Loading />;

  return (
    <div data-user={activeUser} className="relative flex h-dvh flex-col overflow-hidden">
      <Backdrop />
      <CharacterArt />

      <TopBar />
      <FilterBar />

      <main className="relative mt-2.5 min-h-0 flex-1 pr-[clamp(0px,14vw,230px)]">
        {/* Dense views need the characters to step back behind the data. */}
        {view !== 'graph' && (
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0"
            style={{
              background:
                'linear-gradient(90deg, rgba(7,12,19,0.8) 0%, rgba(7,12,19,0.9) 12%, rgba(7,12,19,0.9) 80%, rgba(7,12,19,0.35) 100%)',
            }}
          />
        )}
        {view === 'graph' && <GraphView />}
        {view === 'board' && <BoardView />}
        {view === 'list' && <ListView />}
        {view === 'timeline' && <TimelineView />}
        {view === 'stats' && <StatsView />}
        <Inspector />
      </main>

      <CommandPalette />
      <HelpOverlay />
      <VaultOverlay />
      <Toaster />
    </div>
  );
}
