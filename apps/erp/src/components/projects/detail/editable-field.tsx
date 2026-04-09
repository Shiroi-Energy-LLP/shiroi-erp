'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Check, X, Pencil } from 'lucide-react';
import { updateProjectField } from '@/lib/project-detail-actions';

export type EditableFieldType = 'text' | 'number' | 'textarea' | 'select' | 'date' | 'email' | 'tel' | 'url';

export interface SelectOption {
  value: string;
  label: string;
}

interface EditableFieldProps {
  projectId: string;
  field: string;
  /** Current stored value (raw DB value) */
  value: string | number | null | undefined;
  /** Display-only value when the user is not editing. If omitted, uses `value`. */
  displayValue?: React.ReactNode;
  type?: EditableFieldType;
  /** For select type */
  options?: SelectOption[];
  label?: string;
  /** Visual layout — stacked (label on top) or inline (label left, value right) */
  layout?: 'stacked' | 'inline';
  /** Disable editing (read-only) */
  readOnly?: boolean;
  /** Placeholder shown when value is empty */
  placeholder?: string;
  /** Optional custom renderer for the display mode */
  render?: (value: string | number | null | undefined) => React.ReactNode;
  /** Class for the value wrapper */
  valueClassName?: string;
}

/**
 * Click-to-edit inline field for the project detail page.
 *
 * Behavior:
 *   - Click (or Pencil icon) to enter edit mode
 *   - Enter / blur / check-icon = save
 *   - Escape / X-icon = cancel
 *   - Textarea: Ctrl/Cmd+Enter = save
 *   - Select: change fires save immediately
 */
export function EditableField({
  projectId,
  field,
  value,
  displayValue,
  type = 'text',
  options = [],
  label,
  layout = 'stacked',
  readOnly = false,
  placeholder = '—',
  render,
  valueClassName,
}: EditableFieldProps) {
  const router = useRouter();
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState<string>(value == null ? '' : String(value));
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const inputRef = React.useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

  // Keep draft in sync when server value changes underneath us
  React.useEffect(() => {
    if (!editing) setDraft(value == null ? '' : String(value));
  }, [value, editing]);

  React.useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      if ('select' in inputRef.current && typeof inputRef.current.select === 'function') {
        try {
          inputRef.current.select();
        } catch {
          // ignore — some elements (date input) don't support select()
        }
      }
    }
  }, [editing]);

  async function save(nextValue: string) {
    setSaving(true);
    setError(null);

    // Coerce empty string to null; for numeric fields parse to number
    let payload: string | number | null = nextValue.trim();
    if (payload === '') {
      payload = null;
    } else if (type === 'number') {
      const n = Number(payload);
      if (!Number.isFinite(n)) {
        setError('Must be a number');
        setSaving(false);
        return;
      }
      payload = n;
    }

    const res = await updateProjectField({ projectId, field, value: payload });
    setSaving(false);

    if (!res.success) {
      setError(res.error ?? 'Failed to save');
      return;
    }
    setEditing(false);
    router.refresh();
  }

  function cancel() {
    setDraft(value == null ? '' : String(value));
    setError(null);
    setEditing(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      return;
    }
    if (e.key === 'Enter') {
      if (type === 'textarea' && !(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      void save(draft);
    }
  }

  // ── Render ─────────────────────────────────────────────────
  const labelEl = label ? (
    <div className="text-xs text-n-500 mb-0.5">{label}</div>
  ) : null;

  const computedDisplay = (() => {
    if (render) return render(value);
    if (displayValue !== undefined) return displayValue;
    if (value == null || value === '') {
      return <span className="text-n-400">{placeholder}</span>;
    }
    // For select, show the matching option label
    if (type === 'select') {
      const match = options.find((o) => o.value === String(value));
      return match?.label ?? String(value);
    }
    return String(value);
  })();

  if (readOnly) {
    if (layout === 'inline') {
      return (
        <div className="flex items-center justify-between text-sm">
          {label && <span className="text-n-500">{label}</span>}
          <span className={valueClassName ?? 'font-medium'}>{computedDisplay}</span>
        </div>
      );
    }
    return (
      <div>
        {labelEl}
        <div className={valueClassName ?? 'text-sm font-medium text-n-900'}>{computedDisplay}</div>
      </div>
    );
  }

  if (!editing) {
    const display = (
      <div
        role="button"
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setEditing(true);
          }
        }}
        className="group flex items-center gap-1.5 cursor-pointer hover:bg-n-50 rounded px-1 -mx-1 py-0.5 transition-colors"
      >
        <span className={valueClassName ?? 'text-sm font-medium text-n-900'}>
          {computedDisplay}
        </span>
        <Pencil className="h-3 w-3 text-n-300 group-hover:text-n-500 opacity-0 group-hover:opacity-100 transition-opacity" />
      </div>
    );

    if (layout === 'inline') {
      return (
        <div className="flex items-center justify-between gap-2">
          {label && <span className="text-sm text-n-500 shrink-0">{label}</span>}
          <div className="min-w-0 flex-1 flex justify-end">{display}</div>
        </div>
      );
    }
    return (
      <div>
        {labelEl}
        {display}
      </div>
    );
  }

  // Editing mode ─────────────────────────────────
  const editor = (() => {
    const baseCls =
      'h-8 text-sm border border-shiroi-green rounded px-2 bg-white focus:outline-none focus:ring-1 focus:ring-shiroi-green w-full';

    if (type === 'select') {
      return (
        <select
          ref={inputRef as React.RefObject<HTMLSelectElement>}
          value={draft}
          disabled={saving}
          className={baseCls}
          onChange={(e) => {
            setDraft(e.target.value);
            void save(e.target.value);
          }}
          onKeyDown={handleKeyDown}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    if (type === 'textarea') {
      return (
        <textarea
          ref={inputRef as React.RefObject<HTMLTextAreaElement>}
          value={draft}
          disabled={saving}
          className={`${baseCls} h-24 py-1.5 resize-none`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
        />
      );
    }

    return (
      <input
        ref={inputRef as React.RefObject<HTMLInputElement>}
        type={type === 'number' ? 'number' : type === 'date' ? 'date' : type === 'email' ? 'email' : type === 'tel' ? 'tel' : type === 'url' ? 'url' : 'text'}
        value={draft}
        disabled={saving}
        className={baseCls}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={handleKeyDown}
      />
    );
  })();

  const editingRow = (
    <div className="flex items-center gap-1.5">
      <div className="flex-1 min-w-0">{editor}</div>
      {type !== 'select' && (
        <>
          <button
            type="button"
            onClick={() => void save(draft)}
            disabled={saving}
            className="h-7 w-7 flex items-center justify-center rounded border border-shiroi-green bg-shiroi-green text-white hover:opacity-90 disabled:opacity-50"
            title="Save (Enter)"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            onClick={cancel}
            disabled={saving}
            className="h-7 w-7 flex items-center justify-center rounded border border-n-300 bg-white text-n-600 hover:bg-n-50 disabled:opacity-50"
            title="Cancel (Escape)"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </>
      )}
    </div>
  );

  return (
    <div>
      {labelEl}
      {editingRow}
      {error && <div className="text-xs text-red-600 mt-1">{error}</div>}
    </div>
  );
}
