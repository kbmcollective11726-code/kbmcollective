import { useEffect, useRef } from 'react';
import {
  hasRichTextContent,
  looksLikeHtml,
  normalizeHref,
  plainTextToEditorHtml,
  sanitizeHtml,
} from '../lib/sanitizeHtml';
import styles from './RichTextEditor.module.css';

interface Props {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  minHeight?: number;
}

const COLORS = [
  '#0f172a',
  '#1e4f8a',
  '#b45309',
  '#047857',
  '#be123c',
  '#6d28d9',
  '#475569',
];

const FONT_SIZES: { label: string; size: string }[] = [
  { label: 'S', size: '14px' },
  { label: 'M', size: '16px' },
  { label: 'L', size: '20px' },
  { label: 'XL', size: '24px' },
];

export default function RichTextEditor({ value, onChange, placeholder, minHeight = 120 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);
  const initialized = useRef(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const html = !value.trim()
      ? ''
      : looksLikeHtml(value)
        ? sanitizeHtml(value)
        : plainTextToEditorHtml(value);
    if (!initialized.current) {
      el.innerHTML = html;
      lastEmitted.current = html;
      initialized.current = true;
      return;
    }
    if (value === lastEmitted.current || html === lastEmitted.current) return;
    el.innerHTML = html;
    lastEmitted.current = html;
  }, [value]);

  const emit = () => {
    const el = ref.current;
    if (!el) return;
    const raw = el.innerHTML;
    const cleaned = hasRichTextContent(raw) ? sanitizeHtml(raw) : '';
    lastEmitted.current = cleaned;
    onChange(cleaned);
  };

  const focusEditor = () => {
    ref.current?.focus();
  };

  const run = (command: string, commandValue?: string) => {
    focusEditor();
    document.execCommand(command, false, commandValue);
    emit();
  };

  const wrapSelectionInSpan = (stylesToApply: Partial<CSSStyleDeclaration>) => {
    const el = ref.current;
    const sel = window.getSelection();
    if (!el || !sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
    const range = sel.getRangeAt(0);
    if (!el.contains(range.commonAncestorContainer)) return false;
    const span = document.createElement('span');
    Object.assign(span.style, stylesToApply);
    try {
      range.surroundContents(span);
    } catch {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    const next = document.createRange();
    next.selectNodeContents(span);
    sel.addRange(next);
    return true;
  };

  const applyColor = (color: string) => {
    focusEditor();
    document.execCommand('styleWithCSS', false, 'true');
    document.execCommand('foreColor', false, color);
    emit();
    const el = ref.current;
    if (el && !/style\s*=\s*["'][^"']*color/i.test(el.innerHTML) && !/<font\s/i.test(el.innerHTML)) {
      wrapSelectionInSpan({ color });
      emit();
    }
  };

  const applyFontSize = (size: string) => {
    focusEditor();
    const el = ref.current;
    const sel = window.getSelection();
    if (el && sel && (sel.isCollapsed || sel.rangeCount === 0 || !el.contains(sel.anchorNode))) {
      const range = document.createRange();
      range.selectNodeContents(el);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
    wrapSelectionInSpan({ fontSize: size });
    emit();
  };

  const applyLink = () => {
    focusEditor();
    const sel = window.getSelection();
    const hasSelection = Boolean(sel && !sel.isCollapsed && sel.rangeCount > 0);
    const rawUrl = window.prompt('Link URL', 'https://');
    if (!rawUrl?.trim()) return;
    const href = normalizeHref(rawUrl.trim());
    if (!href) {
      window.alert('Enter a valid link (https://…, mailto:…, or a website like example.com).');
      return;
    }
    if (!hasSelection) {
      document.execCommand('insertHTML', false, `<a href="${href}" target="_blank" rel="noopener noreferrer">${href}</a>`);
    } else {
      document.execCommand('createLink', false, href);
    }
    emit();
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.toolbar} role="toolbar" aria-label="Text formatting">
        <button type="button" className={styles.toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => run('bold')} title="Bold">
          <strong>B</strong>
        </button>
        <button type="button" className={styles.toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => run('italic')} title="Italic">
          <em>I</em>
        </button>
        <button type="button" className={styles.toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => run('underline')} title="Underline">
          <span className={styles.underline}>U</span>
        </button>
        <span className={styles.sep} />
        <span className={styles.colorLabel}>Size</span>
        {FONT_SIZES.map(({ label, size }) => (
          <button
            key={size}
            type="button"
            className={styles.toolBtn}
            title={`Font size ${size}`}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyFontSize(size)}
          >
            {label}
          </button>
        ))}
        <span className={styles.sep} />
        <button type="button" className={styles.toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => run('insertUnorderedList')} title="Bullet list">
          • List
        </button>
        <button type="button" className={styles.toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => run('insertOrderedList')} title="Numbered list">
          1. List
        </button>
        <button type="button" className={styles.toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={applyLink} title="Insert link">
          Link
        </button>
        <span className={styles.sep} />
        <span className={styles.colorLabel}>Color</span>
        {COLORS.map((color) => (
          <button
            key={color}
            type="button"
            className={styles.colorSwatch}
            style={{ background: color }}
            title={color}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => applyColor(color)}
          />
        ))}
        <span className={styles.sep} />
        <button type="button" className={styles.toolBtn} onMouseDown={(e) => e.preventDefault()} onClick={() => run('removeFormat')} title="Clear formatting">
          Clear
        </button>
      </div>
      <div
        ref={ref}
        className={styles.editor}
        style={{ minHeight }}
        contentEditable
        role="textbox"
        aria-multiline
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
      />
    </div>
  );
}
