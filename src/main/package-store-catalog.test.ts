import { afterEach, describe, expect, it, vi } from 'vitest'
import { parsePackageCatalog, browsePackages, verifyCatalogPackage } from './package-store-catalog'

const card = (name: string) => `<article data-package-card="true" data-package-name="${name}" data-package-types="extension skill" data-package-downloads="123"><p class="packages-desc">Tools &amp; skills &#x4e2d;&#25991;</p><div class="packages-meta"><span>Author</span></div><a href="https://github.com/report?package-version=1.2.3">report</a></article>`
const html = `<span class="packages-count">1-50 / 5,368</span>${card('@test/plugin')}`
afterEach(() => vi.unstubAllGlobals())
describe('official package catalog', () => {
  it('reads catalog cards, versions, types and pagination as text', () => {
    expect(parsePackageCatalog(html, 1)).toEqual({ page: 1, total: 5368, hasNext: true, packages: [{ name: '@test/plugin', description: 'Tools & skills 中文', author: 'Author', types: ['extension', 'skill'], downloads: 123, version: '1.2.3' }] })
  })
  it('rejects unexpected page formats and unsafe package names', () => {
    expect(() => parsePackageCatalog('<h1>Server unavailable</h1>', 1)).toThrow('CATALOG_FORMAT_CHANGED')
    expect(parsePackageCatalog(`<span class="packages-count">0 / 0</span>${card('../evil; echo token')}`, 1).packages).toEqual([])
  })
  it('uses only the official catalog endpoint and encodes queries', async () => {
    const fetch = vi.fn(async (_url: unknown) => ({ ok: true, text: async () => html }))
    vi.stubGlobal('fetch', fetch)
    await browsePackages({ search: 'a&redirect=http://bad.test', page: 2, type: 'skill' })
    const url = new URL(String(fetch.mock.calls[0][0]))
    expect(url.origin).toBe('https://pi.dev')
    expect(url.searchParams.get('name')).toBe('a&redirect=http://bad.test')
    expect(url.searchParams.has('redirect')).toBe(false)
  })
  it('requires the exact package to exist in the official directory', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, text: async () => html })))
    await expect(verifyCatalogPackage('@test/plugin')).resolves.toBeUndefined()
    await expect(verifyCatalogPackage('not-in-catalog')).rejects.toThrow('PACKAGE_NOT_IN_CATALOG')
    await expect(verifyCatalogPackage('x && bad')).rejects.toThrow('INVALID_PACKAGE_NAME')
  })
})
