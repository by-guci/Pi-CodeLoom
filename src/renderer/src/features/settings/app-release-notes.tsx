import { memo } from 'react'
import DOMPurify from 'dompurify'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'

const tags = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'br', 'hr',
  'ul', 'ol', 'li', 'strong', 'b', 'em', 'i', 'del', 's', 'blockquote', 'pre', 'code',
  'table', 'thead', 'tbody', 'tr', 'th', 'td',
]

export const AppReleaseNotes = memo(function AppReleaseNotes({ notes, label }: { notes: string; label: string }) {
  // GitHub's Atom feed contains HTML; update metadata may contain Markdown or plain text.
  // Keep formatting only. Links are readable text; the panel's release button owns navigation.
  const html = /^\s*<(?:[a-z][\w:-]*)(?:\s|\/?>)/i.test(notes) ? String(DOMPurify.sanitize(notes, {
    ALLOWED_TAGS: tags, ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false, ALLOW_ARIA_ATTR: false,
  })) : null

  return (
    <div role="region" aria-label={label} tabIndex={0}
      className="max-h-60 overflow-auto overscroll-contain break-words rounded-md border border-border bg-muted/30 p-3 text-sm leading-relaxed text-foreground-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
        [&_:is(h1,h2,h3,h4,h5,h6)]:mb-2 [&_:is(h1,h2,h3,h4,h5,h6)]:mt-4 [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:text-foreground
        [&_h1]:text-lg [&_h2]:text-base [&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-1
        [&_pre]:my-2 [&_pre]:overflow-auto [&_pre]:rounded [&_pre]:bg-muted/50 [&_pre]:p-2 [&_code]:font-mono [&_code]:text-xs [&_strong]:font-semibold
        [&_blockquote]:my-2 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_hr]:my-3 [&_hr]:border-border
        [&_table]:my-2 [&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:p-2 [&_td]:border [&_td]:border-border [&_td]:p-2">
      {html !== null ? <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0" dangerouslySetInnerHTML={{ __html: html }} /> : (
        <div className="[&>:first-child]:mt-0 [&>:last-child]:mb-0">
          <ReactMarkdown remarkPlugins={[remarkGfm, remarkBreaks]} allowedElements={tags} unwrapDisallowed skipHtml>{notes}</ReactMarkdown>
        </div>
      )}
    </div>
  )
})
