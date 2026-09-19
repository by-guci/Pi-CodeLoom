import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resolvePathUnderWorkspace, workspaceFsCreate, workspaceFsReadText } from './workspace-fs'

const mocks = vi.hoisted(() => ({ open: vi.fn(), mkdir: vi.fn(), write: vi.fn() }))

// Exercise Windows volume boundaries on every CI host without requiring a second drive.
vi.mock('path', async (importOriginal) => {
  const actual = await importOriginal<typeof import('path')>()
  return { ...actual.win32, default: actual.win32 }
})
vi.mock('fs', async (importOriginal) => ({
  ...await importOriginal<typeof import('fs')>(),
  existsSync: () => false,
  openSync: mocks.open,
  mkdirSync: mocks.mkdir,
  writeFileSync: mocks.write,
}))

beforeEach(() => vi.clearAllMocks())

describe('Windows workspace boundaries', () => {
  it.each(['D:\\outside.txt', '\\\\server\\share\\outside.txt'])('rejects another volume: %s', (path) => {
    const workspaceRoot = 'C:\\workspace'
    expect(resolvePathUnderWorkspace(workspaceRoot, path)).toEqual({ ok: false, error: 'outside_workspace' })
    expect(workspaceFsReadText({ workspaceRoot, path })).toEqual({ ok: false, error: 'outside_workspace' })
    expect(workspaceFsCreate({ workspaceRoot, relativePath: path })).toEqual({ ok: false, error: 'outside_workspace' })
    expect(mocks.open).not.toHaveBeenCalled()
    expect(mocks.mkdir).not.toHaveBeenCalled()
    expect(mocks.write).not.toHaveBeenCalled()
  })

  it('allows descendants while rejecting sibling traversal on the same drive', () => {
    expect(resolvePathUnderWorkspace('C:\\workspace', 'src/file.ts')).toEqual({
      ok: true, abs: 'C:\\workspace\\src\\file.ts',
    })
    expect(resolvePathUnderWorkspace('C:\\workspace', '../outside.txt')).toEqual({
      ok: false, error: 'outside_workspace',
    })
  })
})
