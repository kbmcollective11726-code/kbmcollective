import { createPortal } from 'react-dom';
import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from './MemberSearchSelect.module.css';

export type MemberPickOption = {
  user_id: string;
  role?: string;
  user?: { full_name?: string | null; email?: string | null };
};

function memberLabel(m: MemberPickOption): string {
  const name = m.user?.full_name?.trim() || m.user?.email?.trim() || m.user_id;
  const email = m.user?.email?.trim();
  if (email && m.user?.full_name?.trim() && email.toLowerCase() !== name.toLowerCase()) {
    return `${name} · ${email}`;
  }
  return name;
}

function matchesQuery(m: MemberPickOption, q: string): boolean {
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  const name = (m.user?.full_name ?? '').toLowerCase();
  const email = (m.user?.email ?? '').toLowerCase();
  const role = (m.role ?? '').toLowerCase();
  return name.includes(needle) || email.includes(needle) || role.includes(needle);
}

type ListPosition = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
};

const VIEWPORT_PAD = 8;
const GAP = 4;
const PREFERRED_MAX = 280;

function computeListPosition(rect: DOMRect): ListPosition {
  const width = Math.max(rect.width, 240);
  let left = rect.left;
  if (left + width > window.innerWidth - VIEWPORT_PAD) {
    left = Math.max(VIEWPORT_PAD, window.innerWidth - width - VIEWPORT_PAD);
  }

  const spaceBelow = window.innerHeight - rect.bottom - VIEWPORT_PAD - GAP;
  const spaceAbove = rect.top - VIEWPORT_PAD - GAP;
  const openUp = spaceBelow < 180 && spaceAbove > spaceBelow;

  if (openUp) {
    const maxHeight = Math.max(96, Math.min(PREFERRED_MAX, spaceAbove));
    return { bottom: window.innerHeight - rect.top + GAP, left, width, maxHeight };
  }

  const maxHeight = Math.max(96, Math.min(PREFERRED_MAX, spaceBelow));
  return { top: rect.bottom + GAP, left, width, maxHeight };
}

type Props = {
  members: MemberPickOption[];
  value: string;
  onChange: (userId: string) => void;
  emptyLabel?: string;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
};

export default function MemberSearchSelect({
  members,
  value,
  onChange,
  emptyLabel = '— Member —',
  placeholder = 'Search name or email…',
  ariaLabel,
  className,
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [listPos, setListPos] = useState<ListPosition>({
    top: 0,
    left: 0,
    width: 240,
    maxHeight: PREFERRED_MAX,
  });

  const selected = useMemo(() => members.find((m) => m.user_id === value) ?? null, [members, value]);

  const filtered = useMemo(() => {
    const list = members.filter((m) => matchesQuery(m, query));
    if (value && selected && !list.some((m) => m.user_id === value)) {
      return [selected, ...list];
    }
    return list;
  }, [members, query, value, selected]);

  const updateListPosition = useCallback(() => {
    const el = inputRef.current ?? rootRef.current;
    if (!el) return;
    setListPos(computeListPosition(el.getBoundingClientRect()));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updateListPosition();
    window.addEventListener('resize', updateListPosition);
    window.addEventListener('scroll', updateListPosition, true);
    return () => {
      window.removeEventListener('resize', updateListPosition);
      window.removeEventListener('scroll', updateListPosition, true);
    };
  }, [open, updateListPosition, query, filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (rootRef.current?.contains(t)) return;
      const portal = document.getElementById(listId);
      if (portal?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open, listId]);

  const displayValue = open ? query : selected ? memberLabel(selected) : '';

  const listContent = (
    <ul
      id={listId}
      className={styles.listPortal}
      role="listbox"
      aria-label={`${ariaLabel} options`}
      style={{
        top: listPos.top,
        bottom: listPos.bottom,
        left: listPos.left,
        width: listPos.width,
        maxHeight: listPos.maxHeight,
      }}
    >
      <li role="presentation">
        <button
          type="button"
          className={`${styles.option} ${!value ? styles.optionSelected : ''}`}
          role="option"
          aria-selected={!value}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onChange('');
            setQuery('');
            setOpen(false);
          }}
        >
          {emptyLabel}
        </button>
      </li>
      {filtered.map((m) => (
        <li key={m.user_id} role="presentation">
          <button
            type="button"
            className={`${styles.option} ${m.user_id === value ? styles.optionSelected : ''}`}
            role="option"
            aria-selected={m.user_id === value}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              onChange(m.user_id);
              setQuery('');
              setOpen(false);
            }}
          >
            <span className={styles.optionName}>{memberLabel(m)}</span>
            {m.role ? <span className={styles.optionRole}>{m.role}</span> : null}
          </button>
        </li>
      ))}
      {filtered.length === 0 ? (
        <li className={styles.empty} role="presentation">
          No members match. Clear search to see all.
        </li>
      ) : null}
    </ul>
  );

  return (
    <div className={`${styles.root} ${className ?? ''}`.trim()} ref={rootRef}>
      <input
        ref={inputRef}
        type="search"
        className={styles.input}
        value={displayValue}
        placeholder={value && !open ? undefined : placeholder}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (!e.target.value.trim() && value) onChange('');
        }}
        onFocus={() => {
          setOpen(true);
          setQuery(selected && value ? memberLabel(selected) : '');
        }}
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
      />
      {open && typeof document !== 'undefined' ? createPortal(listContent, document.body) : null}
    </div>
  );
}
