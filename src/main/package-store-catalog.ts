import { PACKAGE_NAME_PATTERN, PACKAGE_SUMMARIES_ZH, type PackageCatalog, type StorePackage } from '@shared/package-store'

function decode(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (entity, key: string) => {
    if (key[0] === '#') {
      const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1))
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' } as Record<string, string>)[key.toLowerCase()] || entity
  })
}
function plain(text = '') { return decode(text.replace(/<[^>]*>/g, '')).trim() }
function attribute(html: string, name: string) { return decode(html.match(new RegExp(`${name}="([^"]*)"`))?.[1] || '') }

export function parsePackageCatalog(html: string, page: number): PackageCatalog {
  if (!html.includes('packages-count')) throw new Error('CATALOG_FORMAT_CHANGED')
  const packages: StorePackage[] = []
  for (const match of html.matchAll(/<article\b[^>]*data-package-card="true"[^>]*>[\s\S]*?<\/article>/g)) {
    const card = match[0]
    const name = attribute(card, 'data-package-name')
    if (!PACKAGE_NAME_PATTERN.test(name)) continue
    const reportVersion = card.match(/package-version=([^"&]+)/)?.[1]
    packages.push({
      name,
      description: plain(card.match(/<p class="packages-desc">([\s\S]*?)<\/p>/)?.[1]),
      author: plain(card.match(/<div class="packages-meta"><span>([\s\S]*?)<\/span>/)?.[1]),
      types: attribute(card, 'data-package-types').split(/[\s,]+/).filter(Boolean),
      downloads: Number(attribute(card, 'data-package-downloads')) || 0,
      version: reportVersion ? decodeURIComponent(reportVersion) : '',
    })
  }
  const total = Number(html.match(/class="packages-count"[^>]*>[^<]*\/\s*([\d,]+)/)?.[1]?.replace(/,/g, '')) || packages.length
  if (total > 0 && page === 1 && packages.length === 0) throw new Error('CATALOG_FORMAT_CHANGED')
  return { packages, total, page, hasNext: page * 50 < total }
}

const cache = new Map<string, { at: number; data: PackageCatalog }>()
export async function browsePackages(query: { search?: string; type?: string; sort?: string; page?: number }): Promise<PackageCatalog> {
  let search = query.search?.trim() || ''
  if (/[\u3400-\u9fff]/.test(search)) {
    const matches = Object.entries(PACKAGE_SUMMARIES_ZH).filter(([, summary]) => summary.includes(search))
    if (matches.length === 1) search = matches[0][0]
    else search = ({ '技能': 'skill', '主题': 'theme', '记忆': 'memory', '浏览器': 'browser', '搜索': 'search', '规划': 'plan', '子代理': 'subagent' } as Record<string, string>)[search] || search
  }
  const page = query.page || 1
  const url = new URL('https://pi.dev/packages')
  url.searchParams.set('name', search)
  url.searchParams.set('page', String(page))
  if (query.type) url.searchParams.set('type', query.type)
  if (query.sort) url.searchParams.set('sort', query.sort)
  const key = url.href
  const cached = cache.get(key)
  if (cached && Date.now() - cached.at < 120_000) return cached.data
  const response = await fetch(url, { signal: AbortSignal.timeout(20_000) })
  if (!response.ok) throw new Error(`CATALOG_HTTP_${response.status}`)
  const html = await response.text()
  if (html.length > 5_000_000) throw new Error('CATALOG_TOO_LARGE')
  const data = parsePackageCatalog(html, page)
  if (cache.size >= 30) cache.delete(cache.keys().next().value!)
  cache.set(key, { at: Date.now(), data })
  return data
}

export async function verifyCatalogPackage(name: string): Promise<void> {
  if (!PACKAGE_NAME_PATTERN.test(name)) throw new Error('INVALID_PACKAGE_NAME')
  const catalog = await browsePackages({ search: name, page: 1, sort: 'name' })
  if (!catalog.packages.some((pkg) => pkg.name === name)) throw new Error('PACKAGE_NOT_IN_CATALOG')
}
