'use client';

import { useEffect, useRef, useState } from 'react';

import { dayKey } from '@/lib/format';
import { useStore } from '@/lib/store';

function Modal({
  title,
  subtitle,
  onClose,
  children,
  width = 'min(620px,92vw)',
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: React.ReactNode;
  width?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-void/70 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="panel panel-accent panel-in flex max-h-[86vh] flex-col"
        style={{ width }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header className="flex items-start justify-between gap-3 px-4 pt-3.5">
          <div>
            <h3 className="font-semibold text-[15px] text-cream">{title}</h3>
            {subtitle && <p className="text-[12px] italic text-muted">{subtitle}</p>}
          </div>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </header>
        <div className="rule mx-4 mt-2.5" />
        <div className="scroll flex-1 px-4 py-3">{children}</div>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ['⌘K / Ctrl K', 'Command palette — every action, and jump to any task'],
  ['N', 'Raise a new task, assigned to you'],
  ['Space', 'Advance the selected task to its next state'],
  ['1 – 5', 'Switch view: Path, Forge, Ledger, Chronicle, Auguries'],
  ['Tab', 'Switch between Aina and Onja'],
  ['F', 'Fit the whole group on screen'],
  ['E', 'Open or close the detail panel'],
  ['⌘Z / ⇧⌘Z', 'Undo and redo'],
  ['/', 'Jump to the search field'],
  ['Esc', 'Close whatever is open, or clear the selection'],
  ['?', 'This list'],
  ['Drag a node', 'Place it by hand; Auto layout puts it back'],
  ['Drag the ◇ handle', 'Draw a dependency into another task'],
  ['Wheel', 'Zoom the group around the pointer'],
];

export function HelpOverlay() {
  const open = useStore((s) => s.helpOpen);
  const setHelp = useStore((s) => s.setHelp);
  if (!open) return null;
  return (
    <Modal
      title="Keyboard shortcuts"
      subtitle="Everything here is reachable from the keyboard."
      onClose={() => setHelp(false)}
    >
      <dl className="space-y-1.5">
        {SHORTCUTS.map(([k, v]) => (
          <div key={k} className="flex items-baseline gap-3">
            <dt className="t-num w-[110px] shrink-0 text-[11px] text-cream">{k}</dt>
            <dd className="text-[12.5px] text-parchment">{v}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export function VaultOverlay() {
  const open = useStore((s) => s.vaultOpen);
  const setVault = useStore((s) => s.setVault);
  const data = useStore((s) => s.data);
  const updateSettings = useStore((s) => s.updateSettings);
  const addGroup = useStore((s) => s.addGroup);
  const updateGroup = useStore((s) => s.updateGroup);
  const deleteGroup = useStore((s) => s.deleteGroup);
  const exportJson = useStore((s) => s.exportJson);
  const importJson = useStore((s) => s.importJson);
  const resetToSeed = useStore((s) => s.resetToSeed);
  const [newName, setNewName] = useState('');
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  const download = () => {
    const blob = new Blob([exportJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `path-of-embers-${dayKey(Date.now())}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const counts = new Map<string, number>();
  for (const t of Object.values(data.tasks)) {
    counts.set(t.groupId, (counts.get(t.groupId) ?? 0) + 1);
  }

  return (
    <Modal
      title="The Vault"
      subtitle="Settings, groups and the project file itself."
      onClose={() => setVault(false)}
      width="min(720px,94vw)"
    >
      <section>
        <h4 className="t-label mb-2">Forecast</h4>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="block">
            <span className="t-label">Day zero</span>
            <input
              type="date"
              value={data.settings.startDate}
              onChange={(e) => updateSettings({ startDate: e.target.value })}
              className="field mt-1"
            />
          </label>
          <label className="block">
            <span className="t-label">Hours per day</span>
            <input
              type="number"
              min={1}
              max={24}
              step={0.5}
              value={data.settings.hoursPerDay}
              onChange={(e) => updateSettings({ hoursPerDay: Math.max(1, Number(e.target.value)) })}
              className="field mt-1"
            />
          </label>
          <label className="flex items-end gap-2 pb-1">
            <input
              type="checkbox"
              checked={data.settings.showDoneInGraph}
              onChange={(e) => updateSettings({ showDoneInGraph: e.target.checked })}
              className="h-4 w-4 accent-[var(--accent)]"
            />
            <span className="text-[12px] text-parchment">Show done tasks on the Path</span>
          </label>
        </div>
      </section>

      <div className="rule my-3.5" />

      <section>
        <h4 className="t-label mb-2">Groups</h4>
        <ul className="space-y-1.5">
          {Object.values(data.groups)
            .sort((a, b) => a.order - b.order)
            .map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <input
                  value={c.glyph}
                  onChange={(e) => updateGroup(c.id, { glyph: e.target.value.slice(0, 2) })}
                  className="field !w-[46px] text-center"
                  aria-label={`Glyph for ${c.name}`}
                />
                <input
                  value={c.name}
                  onChange={(e) => updateGroup(c.id, { name: e.target.value })}
                  className="field !w-[190px]"
                  aria-label={`Name for ${c.name}`}
                />
                <input
                  value={c.blurb}
                  onChange={(e) => updateGroup(c.id, { blurb: e.target.value })}
                  placeholder="what this group covers"
                  className="field flex-1"
                  aria-label={`Description for ${c.name}`}
                />
                <span className="t-num w-8 shrink-0 text-right text-[10px] text-muted">
                  {counts.get(c.id) ?? 0}
                </span>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost btn-danger"
                  onClick={() => deleteGroup(c.id)}
                  title="Delete — its tasks move to the first group"
                >
                  ✕
                </button>
              </li>
            ))}
        </ul>
        <form
          className="mt-2 flex gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (newName.trim()) addGroup(newName.trim());
            setNewName('');
          }}
        >
          <input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New group name…"
            className="field"
          />
          <button type="submit" className="btn btn-sm">
            + Add
          </button>
        </form>
      </section>

      <div className="rule my-3.5" />

      <section>
        <h4 className="t-label mb-2">The project file</h4>
        <p className="mb-2 text-[12px] text-parchment/85">
          The project lives on the server. Export before you clear it, and keep the file with the
          repo if you want the two to travel together.
        </p>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className="btn btn-sm" onClick={download}>
            ⇩ Export JSON
          </button>
          <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            ⇧ Import JSON
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (file) importJson(await file.text());
              e.target.value = '';
            }}
          />
          <button
            type="button"
            className="btn btn-sm btn-danger ml-auto"
            onClick={() => {
              if (confirmReset) {
                resetToSeed();
                setConfirmReset(false);
              } else {
                setConfirmReset(true);
                window.setTimeout(() => setConfirmReset(false), 3200);
              }
            }}
          >
            {confirmReset ? 'Sure? This replaces everything' : 'Reset to default board'}
          </button>
        </div>
        <p className="t-num mt-2 text-[10.5px] text-muted">
          {Object.keys(data.tasks).length} tasks · {Object.keys(data.groups).length}{' '}
          groups · {Object.values(data.tasks).reduce((a, t) => a + t.deps.length, 0)} links
        </p>
      </section>
    </Modal>
  );
}

export function Toaster() {
  const toast = useStore((s) => s.toast);
  const clearToast = useStore((s) => s.clearToast);

  useEffect(() => {
    if (!toast) return;
    const h = window.setTimeout(clearToast, 3400);
    return () => window.clearTimeout(h);
  }, [toast, clearToast]);

  if (!toast) return null;

  const tone =
    toast.tone === 'good'
      ? { c: 'var(--accent-soft)', s: 'var(--accent)' }
      : toast.tone === 'bad'
        ? { c: '#ffb8a4', s: '#ff6a3d' }
        : { c: '#f2ece0', s: 'rgba(240,196,106,0.6)' };

  return (
    <div
      key={toast.id}
      className="pointer-events-none fixed bottom-[86px] left-1/2 z-50"
      style={{ animation: 'toast-in 0.24s cubic-bezier(0.2,0.8,0.3,1) both' }}
      role="status"
    >
      <div
        className="panel px-4 py-2 text-[13px]"
        style={{ color: tone.c, boxShadow: `inset 0 0 0 1px ${tone.s}, 0 12px 40px rgba(0,0,0,0.6)` }}
      >
        {toast.text}
      </div>
    </div>
  );
}
