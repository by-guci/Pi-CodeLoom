import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProjectSidebar } from './project-sidebar'

const mocks = vi.hoisted(() => ({
  activateWorkspace: vi.fn(),
  statResult: { ok: true, isDirectory: true },
  toastError: vi.fn(),
}))

const invokeMock = vi.fn(async (method: string) => {
  if (method === 'workspace.fs.stat') return mocks.statResult
  if (method === 'workspace.sandbox.list') return { sandboxes: [] }
  if (method === 'session.list') return { sessions: [] }
  if (method === 'settings.get') return { settings: {} }
  if (method === 'workspace.open' || method === 'settings.set') return { ok: true }
  return {}
})

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: string) => invokeMock(method) },
}))
vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: mocks.activateWorkspace,
  switchSessionInPlace: vi.fn(async () => {}),
  previewSessionInPlace: vi.fn(async () => {}),
}))
vi.mock('@renderer/lib/refresh-workspace-session-lists', () => ({
  refreshWorkspaceSessionLists: vi.fn(async () => {}),
}))
vi.mock('@renderer/features/timeline/tool-card-registry', () => ({
  useToolCardCatalogReady: () => true,
}))
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }))

/** jsdom 没有 preload：drop 的 File 没有真实磁盘路径，走 (file as any).path 兜底。 */
function fakeFile(path: string): File {
  return { path, name: path.split(/[\\/]/).pop(), size: 0 } as unknown as File
}

function dropFiles(paths: string[]): void {
  const { container } = render(<ProjectSidebar onOpenProject={() => {}} openProjectLabel="打开文件夹" />)
  const dt = { types: ['Files'], files: paths.map(fakeFile) }
  fireEvent.drop(container.firstElementChild as HTMLElement, { dataTransfer: dt })
}

describe('ProjectSidebar folder drop', () => {
  beforeEach(() => {
    mocks.activateWorkspace.mockReset()
    mocks.toastError.mockReset()
    mocks.statResult.ok = true
    mocks.statResult.isDirectory = true
    invokeMock.mockClear()
  })

  afterEach(() => vi.clearAllMocks())

  it('adds a dropped folder as a project and opens it', async () => {
    mocks.statResult = { ok: true, isDirectory: true }
    dropFiles(['/proj/D'])

    await vi.waitFor(() => {
      expect(mocks.activateWorkspace).toHaveBeenCalledWith('/proj/D', { preferHome: true })
    })
  })

  it('skips dropped files that are not directories', async () => {
    mocks.statResult = { ok: true, isDirectory: false }
    dropFiles(['/proj/note.md'])
    await Promise.resolve()
    expect(mocks.activateWorkspace).not.toHaveBeenCalled()
    expect(mocks.toastError).toHaveBeenCalled()
  })
})