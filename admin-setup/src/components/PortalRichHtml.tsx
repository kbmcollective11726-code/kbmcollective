import { hasRichTextContent, looksLikeHtml, sanitizeHtml } from '../lib/sanitizeHtml';

interface Props {
  html: string | null | undefined;
  className?: string;
}

/** Renders admin-authored portal HTML safely; plain text keeps line breaks. */
export default function PortalRichHtml({ html, className }: Props) {
  const raw = html?.trim() ?? '';
  if (!hasRichTextContent(raw)) return null;

  if (!looksLikeHtml(raw)) {
    return (
      <div className={className} style={{ whiteSpace: 'pre-wrap' }}>
        {raw}
      </div>
    );
  }

  return <div className={className} dangerouslySetInnerHTML={{ __html: sanitizeHtml(raw) }} />;
}
