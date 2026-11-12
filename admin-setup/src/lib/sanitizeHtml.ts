/** Allowlisted tags/attrs for admin-authored portal HTML (holding message, hotel content). */

const ALLOWED_TAGS = new Set([
  'p',
  'br',
  'div',
  'span',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'a',
  'h1',
  'h2',
  'h3',
  'h4',
]);

const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'target', 'rel', 'style']),
  span: new Set(['style']),
  p: new Set(['style']),
  div: new Set(['style']),
  strong: new Set(['style']),
  b: new Set(['style']),
  em: new Set(['style']),
  i: new Set(['style']),
  u: new Set(['style']),
  s: new Set(['style']),
  h1: new Set(['style']),
  h2: new Set(['style']),
  h3: new Set(['style']),
  h4: new Set(['style']),
  li: new Set(['style']),
};

const ALLOWED_STYLE_PROPS = new Set([
  'color',
  'background-color',
  'font-size',
  'text-align',
  'font-weight',
  'font-style',
  'text-decoration',
  'text-decoration-line',
  'line-height',
  'padding',
  'margin',
  'margin-top',
  'margin-bottom',
  'border',
  'border-left',
  'border-radius',
]);

function sanitizeStyle(value: string): string | null {
  const parts: string[] = [];
  for (const decl of value.split(';')) {
    const [rawProp, ...rest] = decl.split(':');
    if (!rawProp || rest.length === 0) continue;
    const prop = rawProp.trim().toLowerCase();
    const val = rest.join(':').trim();
    if (!ALLOWED_STYLE_PROPS.has(prop) || !val) continue;
    if (/url\s*\(|expression\s*\(|@import|javascript:/i.test(val)) continue;
    parts.push(`${prop}: ${val}`);
  }
  return parts.length ? parts.join('; ') : null;
}

/** Normalize admin-entered URLs so createLink + sanitize keep working hrefs. */
export function normalizeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith('/') || trimmed.startsWith('#')) return trimmed;
  // Bare domains / www. — assume https
  if (/^(www\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(\/.*)?$/i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return null;
}

function sanitizeHref(href: string): string | null {
  return normalizeHref(href);
}

export function looksLikeHtml(value: string): boolean {
  return /<[a-z][\s\S]*>/i.test(value);
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-4])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hasRichTextContent(value: string | null | undefined): boolean {
  if (!value?.trim()) return false;
  return stripHtmlToText(value).length > 0;
}

export function plainTextToEditorHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n/)
    .map((line) => `<p>${line || '<br>'}</p>`)
    .join('');
}

/** Browsers often emit <font color/size> from execCommand; normalize to span styles. */
const FONT_SIZE_MAP: Record<string, string> = {
  '1': '10px',
  '2': '13px',
  '3': '16px',
  '4': '18px',
  '5': '24px',
  '6': '32px',
  '7': '48px',
};

function normalizeFontElements(root: ParentNode): void {
  const fonts = Array.from(root.querySelectorAll('font'));
  for (const font of fonts) {
    const color = font.getAttribute('color')?.trim();
    const size = font.getAttribute('size')?.trim();
    const span = document.createElement('span');
    if (color) span.style.color = color;
    if (size && FONT_SIZE_MAP[size]) span.style.fontSize = FONT_SIZE_MAP[size];
    const style = font.getAttribute('style');
    if (style) {
      const cleaned = sanitizeStyle(style);
      if (cleaned) {
        for (const decl of cleaned.split(';')) {
          const [prop, ...rest] = decl.split(':');
          if (!prop || rest.length === 0) continue;
          span.style.setProperty(prop.trim(), rest.join(':').trim());
        }
      }
    }
    while (font.firstChild) span.appendChild(font.firstChild);
    font.replaceWith(span);
  }
}

function unwrapElement(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) parent.insertBefore(el.firstChild, el);
  parent.removeChild(el);
}

export function sanitizeHtml(dirty: string): string {
  if (typeof document === 'undefined') return stripHtmlToText(dirty);

  const template = document.createElement('template');
  template.innerHTML = dirty;
  normalizeFontElements(template.content);

  const walk = (node: Node): void => {
    const children = Array.from(node.childNodes);
    for (const child of children) {
      if (child.nodeType === Node.COMMENT_NODE) {
        child.parentNode?.removeChild(child);
        continue;
      }
      if (child.nodeType !== Node.ELEMENT_NODE) continue;
      const el = child as HTMLElement;
      const tag = el.tagName.toLowerCase();
      if (!ALLOWED_TAGS.has(tag)) {
        unwrapElement(el);
        continue;
      }

      for (const attr of Array.from(el.attributes)) {
        const name = attr.name.toLowerCase();
        const allowed = ALLOWED_ATTRS[tag];
        if (!allowed?.has(name)) {
          el.removeAttribute(attr.name);
          continue;
        }
        if (name === 'style') {
          const cleaned = sanitizeStyle(attr.value);
          if (cleaned) el.setAttribute('style', cleaned);
          else el.removeAttribute('style');
        }
        if (name === 'href') {
          const href = sanitizeHref(attr.value);
          if (href) {
            el.setAttribute('href', href);
          } else {
            el.removeAttribute('href');
          }
        }
        if (name === 'target' && attr.value !== '_blank') {
          el.removeAttribute('target');
        }
      }

      if (tag === 'a') {
        const href = el.getAttribute('href');
        if (!href) {
          unwrapElement(el);
          continue;
        }
        if (/^https?:/i.test(href)) {
          el.setAttribute('target', '_blank');
          el.setAttribute('rel', 'noopener noreferrer');
        }
      }

      walk(el);
    }
  };

  walk(template.content);
  return template.innerHTML.trim();
}
