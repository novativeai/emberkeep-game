'use client';

import { useMemo, useRef, useState } from 'react';

import {
  downloadAttachment,
  formatBytes,
  removeAttachment,
  uploadAttachment,
} from '@/lib/attachments';
import { wouldCycle } from '@/lib/graph';
import { formatHours, formatWhen } from '@/lib/format';
import { hoursLogged, isBlocked, taskXp, unlockedBy } from '@/lib/selectors';
import { useStore } from '@/lib/store';
import {
  PRIORITIES,
  PRIORITY_LABEL,
  STATUSES,
  STATUS_LABEL,
  USERS,
  USER_PROFILE,
  type Priority,
  type Status,
} from '@/lib/types';

function Section({ title, children, aside }: { title: string; children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <section className="px-3.5 py-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="t-label">{title}</h4>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function Inspector() {
  const data = useStore((s) => s.data);
  const selectedId = useStore((s) => s.selectedId);
  const open = useStore((s) => s.inspectorOpen);
  const setInspector = useStore((s) => s.setInspector);
  const select = useStore((s) => s.select);
  const updateTask = useStore((s) => s.updateTask);
  const setStatus = useStore((s) => s.setStatus);
  const assign = useStore((s) => s.assign);
  const addDep = useStore((s) => s.addDep);
  const removeDep = useStore((s) => s.removeDep);
  const deleteTask = useStore((s) => s.deleteTask);
  const duplicateTask = useStore((s) => s.duplicateTask);
  const addChecklistItem = useStore((s) => s.addChecklistItem);
  const toggleChecklistItem = useStore((s) => s.toggleChecklistItem);
  const removeChecklistItem = useStore((s) => s.removeChecklistItem);
  const addComment = useStore((s) => s.addComment);
  const logWork = useStore((s) => s.logWork);
  const startTimer = useStore((s) => s.startTimer);
  const advance = useStore((s) => s.advance);
  const activeUser = useStore((s) => s.activeUser);

  const [checkText, setCheckText] = useState('');
  const [commentText, setCommentText] = useState('');
  const [logMinutes, setLogMinutes] = useState('');
  const [logNote, setLogNote] = useState('');
  const [tagText, setTagText] = useState('');
  const [uploading, setUploading] = useState(false);
  const [removingFile, setRemovingFile] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const task = selectedId ? data.tasks[selectedId] : null;

  const candidates = useMemo(() => {
    if (!task) return [];
    return Object.values(data.tasks)
      .filter((o) => o.id !== task.id && !task.deps.includes(o.id) && !wouldCycle(data.tasks, task.id, o.id))
      .sort((a, b) => a.key.localeCompare(b.key));
  }, [data.tasks, task]);

  const dependents = useMemo(
    () => (task ? Object.values(data.tasks).filter((o) => o.deps.includes(task.id)) : []),
    [data.tasks, task],
  );

  if (!open || !task) return null;

  const blocked = isBlocked(data, task);
  const spent = hoursLogged(task);
  const checkedCount = task.checklist.filter((c) => c.done).length;
  const frees = unlockedBy(data, task.id);

  return (
    <aside
      className="panel panel-accent panel-in pointer-events-auto absolute bottom-3 right-3 z-30 flex max-h-[62%] w-[min(380px,30vw)] min-w-[320px] flex-col"
      aria-label={`Details for ${task.key}`}
    >
      <header className="flex items-start gap-2 px-3.5 pt-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="t-num text-[10px] text-muted">{task.key}</span>
            {blocked && <span className="chip">Blocked</span>}
            <span className="chip" style={{ color: 'var(--accent-soft)' }}>
              +{taskXp(task)} xp
            </span>
          </div>
          <input
            value={task.title}
            onChange={(e) => updateTask(task.id, { title: e.target.value })}
            className="font-semibold mt-1 w-full bg-transparent text-[15px] text-cream outline-none"
            aria-label="Title"
          />
        </div>
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={() => setInspector(false)}
          aria-label="Close details"
        >
          ✕
        </button>
      </header>

      <div className="rule mx-3.5 mt-2" />

      <div className="scroll flex-1">
        <Section title="State">
          <div className="flex flex-wrap gap-1">
            {STATUSES.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(task.id, s as Status)}
                className="font-semibold px-2 py-1 text-[10px] transition-colors"
                style={{
                  clipPath: 'var(--panel-clip)',
                  color: task.status === s ? 'var(--accent-soft)' : '#8d9aa8',
                  background:
                    task.status === s ? 'color-mix(in srgb, var(--accent) 16%, transparent)' : 'rgba(255,255,255,0.04)',
                  boxShadow:
                    task.status === s
                      ? 'inset 0 0 0 1px color-mix(in srgb, var(--accent) 55%, transparent)'
                      : 'inset 0 0 0 1px rgba(240,196,106,0.14)',
                }}
              >
                {STATUS_LABEL[s]}
              </button>
            ))}
          </div>

          <div className="mt-2.5 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="t-label">Assignee</span>
              <select
                value={task.assignee ?? ''}
                onChange={(e) => assign(task.id, (e.target.value || null) as typeof task.assignee)}
                className="field mt-1"
                style={{ color: task.assignee ? USER_PROFILE[task.assignee].accentSoft : undefined }}
              >
                <option value="">Unclaimed</option>
                {USERS.map((u) => (
                  <option key={u} value={u}>
                    {USER_PROFILE[u].name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="t-label">Priority</span>
              <select
                value={task.priority}
                onChange={(e) => updateTask(task.id, { priority: e.target.value as Priority })}
                className="field mt-1"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABEL[p]}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="t-label">Group</span>
              <select
                value={task.groupId}
                onChange={(e) => updateTask(task.id, { groupId: e.target.value })}
                className="field mt-1"
              >
                {Object.values(data.groups)
                  .sort((a, b) => a.order - b.order)
                  .map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.glyph} {c.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block">
              <span className="t-label">Estimate (h)</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={task.estimate}
                onChange={(e) => updateTask(task.id, { estimate: Math.max(0, Number(e.target.value)) })}
                className="field mt-1"
              />
            </label>
            <label className="col-span-2 block">
              <span className="t-label">Due</span>
              <input
                type="date"
                value={task.due ?? ''}
                onChange={(e) => updateTask(task.id, { due: e.target.value || null })}
                className="field mt-1"
              />
            </label>
          </div>
        </Section>

        <div className="rule mx-3.5" />

        <Section title="Notes">
          <textarea
            value={task.notes}
            onChange={(e) => updateTask(task.id, { notes: e.target.value })}
            rows={4}
            placeholder="What does done look like?"
            className="field"
          />
        </Section>

        <div className="rule mx-3.5" />

        <Section
          title="Depends on"
          aside={<span className="t-num text-[10px] text-muted">{task.deps.length}</span>}
        >
          {task.deps.length === 0 ? (
            <p className="text-[12px] italic text-muted">None — this task is ready to start.</p>
          ) : (
            <ul className="space-y-1">
              {task.deps.map((d) => {
                const dep = data.tasks[d];
                if (!dep) return null;
                const satisfied = dep.status === 'done';
                return (
                  <li key={d} className="flex items-center gap-2">
                    <span style={{ color: satisfied ? 'var(--color-verdant)' : '#8d9aa8' }}>
                      {satisfied ? '✓' : '·'}
                    </span>
                    <button
                      type="button"
                      onClick={() => select(d)}
                      className="min-w-0 flex-1 truncate text-left text-[12px] text-parchment hover:text-cream"
                    >
                      <span className="t-num text-[10px] text-muted">{dep.key}</span> {dep.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeDep(task.id, d)}
                      className="text-[11px] text-muted hover:text-lava"
                      aria-label={`Remove dependency on ${dep.key}`}
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          <select
            value=""
            onChange={(e) => e.target.value && addDep(task.id, e.target.value)}
            className="field mt-2"
            aria-label="Add a dependency"
          >
            <option value="">+ add a dependency…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.key} — {c.title}
              </option>
            ))}
          </select>
        </Section>

        {dependents.length > 0 && (
          <>
            <div className="rule mx-3.5" />
            <Section
              title="Blocks"
              aside={
                frees.length > 0 ? (
                  <span className="t-num text-[10px]" style={{ color: 'var(--accent-soft)' }}>
                    {frees.length} kindle on done
                  </span>
                ) : undefined
              }
            >
              <ul className="space-y-1">
                {dependents.map((d) => (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => select(d.id)}
                      className="w-full truncate text-left text-[12px] text-parchment hover:text-cream"
                    >
                      <span className="t-num text-[10px] text-muted">{d.key}</span> {d.title}
                    </button>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}

        <div className="rule mx-3.5" />

        <Section
          title="Checklist"
          aside={
            task.checklist.length > 0 ? (
              <span className="t-num text-[10px] text-muted">
                {checkedCount}/{task.checklist.length}
              </span>
            ) : undefined
          }
        >
          <ul className="space-y-1">
            {task.checklist.map((c) => (
              <li key={c.id} className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => toggleChecklistItem(task.id, c.id)}
                  className="grid h-4 w-4 shrink-0 place-items-center text-[10px]"
                  style={{
                    boxShadow: 'inset 0 0 0 1px rgba(240,196,106,0.4)',
                    color: 'var(--accent-soft)',
                  }}
                  aria-label={c.done ? 'Mark undone' : 'Mark done'}
                >
                  {c.done ? '✓' : ''}
                </button>
                <span
                  className="min-w-0 flex-1 text-[12px]"
                  style={{
                    color: c.done ? '#6d7a87' : 'var(--color-parchment)',
                    textDecoration: c.done ? 'line-through' : undefined,
                  }}
                >
                  {c.text}
                </span>
                <button
                  type="button"
                  onClick={() => removeChecklistItem(task.id, c.id)}
                  className="text-[11px] text-muted hover:text-lava"
                  aria-label="Remove"
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
              addChecklistItem(task.id, checkText);
              setCheckText('');
            }}
          >
            <input
              value={checkText}
              onChange={(e) => setCheckText(e.target.value)}
              placeholder="Add a step…"
              className="field"
            />
            <button type="submit" className="btn btn-sm">
              +
            </button>
          </form>
        </Section>

        <div className="rule mx-3.5" />

        <Section
          title="Time"
          aside={
            <span className="t-num text-[10px] text-muted">
              {formatHours(spent)} of {formatHours(task.estimate)}
            </span>
          }
        >
          <div className="meter">
            <i style={{ width: `${task.estimate ? Math.min(100, (spent / task.estimate) * 100) : 0}%` }} />
          </div>
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const m = Number(logMinutes);
              if (m > 0) {
                logWork(task.id, m, logNote);
                setLogMinutes('');
                setLogNote('');
              }
            }}
          >
            <input
              type="number"
              min={1}
              value={logMinutes}
              onChange={(e) => setLogMinutes(e.target.value)}
              placeholder="min"
              className="field w-[74px]"
              aria-label="Minutes"
            />
            <input
              value={logNote}
              onChange={(e) => setLogNote(e.target.value)}
              placeholder="what you did"
              className="field"
              aria-label="Log note"
            />
            <button type="submit" className="btn btn-sm">
              Log
            </button>
          </form>
          {task.logs.length > 0 && (
            <ul className="mt-2 space-y-0.5">
              {[...task.logs].reverse().slice(0, 5).map((l) => (
                <li key={l.id} className="flex items-baseline gap-2 text-[11px]">
                  <span className="t-num" style={{ color: USER_PROFILE[l.by].accentSoft }}>
                    {l.minutes}m
                  </span>
                  <span className="min-w-0 flex-1 truncate text-muted">{l.note || '—'}</span>
                  <span className="t-num shrink-0 text-[9.5px] text-muted">{formatWhen(l.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="rule mx-3.5" />

        <Section
          title="Files"
          aside={
            task.attachments.length > 0 ? (
              <span className="t-num text-[10px] text-muted">{task.attachments.length}</span>
            ) : undefined
          }
        >
          {task.attachments.length === 0 ? (
            <p className="text-[12px] text-muted">No files attached.</p>
          ) : (
            <ul className="space-y-1">
              {task.attachments.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 transition-opacity"
                  style={{ opacity: removingFile === a.id ? 0.45 : 1 }}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-parchment" title={a.name}>
                      {a.name}
                    </span>
                    <span className="t-num text-[10px] text-muted">
                      {removingFile === a.id
                        ? 'Removing…'
                        : `${formatBytes(a.size)}${a.uploadedBy ? ` · ${USER_PROFILE[a.uploadedBy].name}` : ''}`}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    title={`Download ${a.name}`}
                    disabled={removingFile === a.id}
                    onClick={() => downloadAttachment(task.key, a.id, a.name)}
                  >
                    Download
                  </button>
                  <button
                    type="button"
                    className="text-[11px] text-muted hover:text-lava disabled:opacity-40"
                    aria-label={`Remove ${a.name}`}
                    disabled={removingFile === a.id}
                    onClick={async () => {
                      setRemovingFile(a.id);
                      await removeAttachment(task.key, a.id);
                      setRemovingFile(null);
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              setUploading(true);
              await uploadAttachment(task.key, file, activeUser);
              setUploading(false);
            }}
          />
          <button
            type="button"
            className="btn btn-sm mt-2 w-full"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? 'Uploading…' : '+ Attach a file'}
          </button>
        </Section>

        <div className="rule mx-3.5" />

        <Section title="Tags">
          <div className="flex flex-wrap gap-1.5">
            {task.tags.map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip hover:text-lava"
                onClick={() => updateTask(task.id, { tags: task.tags.filter((x) => x !== tag) })}
                title="Remove tag"
              >
                {tag} ✕
              </button>
            ))}
          </div>
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              const v = tagText.trim().toLowerCase();
              if (v && !task.tags.includes(v)) updateTask(task.id, { tags: [...task.tags, v] });
              setTagText('');
            }}
          >
            <input
              value={tagText}
              onChange={(e) => setTagText(e.target.value)}
              placeholder="add a tag…"
              className="field"
            />
            <button type="submit" className="btn btn-sm">
              +
            </button>
          </form>
        </Section>

        <div className="rule mx-3.5" />

        <Section title="Comments">
          <ul className="space-y-2">
            {task.comments.map((c) => (
              <li key={c.id}>
                <div className="flex items-baseline gap-2">
                  <span
                    className="font-semibold text-[10px]"
                    style={{ color: USER_PROFILE[c.author].accentSoft }}
                  >
                    {USER_PROFILE[c.author].name}
                  </span>
                  <span className="t-num text-[9.5px] text-muted">{formatWhen(c.at)}</span>
                </div>
                <p className="whitespace-pre-wrap text-[12px] text-parchment">{c.body}</p>
              </li>
            ))}
            {task.comments.length === 0 && (
              <li className="text-[12px] italic text-muted">No entries yet.</li>
            )}
          </ul>
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              addComment(task.id, commentText);
              setCommentText('');
            }}
          >
            <input
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={`Write as ${USER_PROFILE[activeUser].name}…`}
              className="field"
            />
            <button type="submit" className="btn btn-sm">
              Post
            </button>
          </form>
        </Section>

        <div className="rule mx-3.5" />

        <Section title="History">
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            <dt className="text-muted">Created</dt>
            <dd className="t-num text-right text-parchment">{formatWhen(task.createdAt)}</dd>
            <dt className="text-muted">Updated</dt>
            <dd className="t-num text-right text-parchment">{formatWhen(task.updatedAt)}</dd>
            {task.startedAt && (
              <>
                <dt className="text-muted">Started</dt>
                <dd className="t-num text-right text-parchment">{formatWhen(task.startedAt)}</dd>
              </>
            )}
            {task.completedAt && (
              <>
                <dt className="text-muted">Completed</dt>
                <dd className="t-num text-right" style={{ color: 'var(--accent-soft)' }}>
                  {formatWhen(task.completedAt)}
                </dd>
              </>
            )}
          </dl>
        </Section>
      </div>

      <footer className="flex flex-wrap items-center gap-1.5 border-t border-white/10 px-3.5 py-2.5">
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => advance(task.id)}
          disabled={task.status === 'done'}
        >
          Advance
        </button>
        <button type="button" className="btn btn-sm" onClick={() => startTimer(task.id)}>
          Start timer
        </button>
        <button type="button" className="btn btn-sm" onClick={() => duplicateTask(task.id)}>
          Duplicate
        </button>
        <button
          type="button"
          className="btn btn-sm btn-danger ml-auto"
          onClick={() => {
            if (confirmDelete) {
              deleteTask(task.id);
              setConfirmDelete(false);
            } else {
              setConfirmDelete(true);
              window.setTimeout(() => setConfirmDelete(false), 3200);
            }
          }}
        >
          {confirmDelete ? 'Sure?' : 'Delete'}
        </button>
      </footer>
    </aside>
  );
}
