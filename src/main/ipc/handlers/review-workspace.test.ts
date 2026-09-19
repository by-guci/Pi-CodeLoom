import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  handlers: new Map<string, (request: Record<string, unknown>) => Promise<unknown>>(),
  currentProject: '/project-b' as string | null,
  workerCwd: '/project-a' as string | null,
  read: vi.fn(),
  stage: vi.fn(),
  unstage: vi.fn(),
  commit: vi.fn(),
}))

vi.mock('../registry', () => ({
  registerHandler: (name: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => mocks.handlers.set(name, handler),
  registerHandlerWithSchema: (
    name: string,
    schema: { parse: (request: unknown) => Record<string, unknown> },
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => mocks.handlers.set(name, (request) => handler(schema.parse(request))),
}))
vi.mock('../../config-store', () => ({ configStore: { get: (key: string) => key === 'currentProject' ? mocks.currentProject : undefined } }))
vi.mock('../../worker-manager', () => ({ workerManager: { get cwd() { return mocks.workerCwd } } }))
vi.mock('../../sandbox-workspaces', () => ({ isSandboxWorkspacePath: () => false }))
vi.mock('../../session-file-meta', () => ({ readSessionMetaFromFile: () => null }))
vi.mock('../../git-workspace', () => ({
  readGitWorkspaceSnapshot: mocks.read,
  stageHunks: mocks.stage,
  unstageHunks: mocks.unstage,
  commitChanges: mocks.commit,
}))

import { registerReviewHandlers } from './review'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.handlers.clear()
  mocks.currentProject = '/project-b'
  mocks.workerCwd = '/project-a'
  mocks.read.mockImplementation(async (cwd: string) => ({ isRepo: true, raw: cwd, stagedRaw: '', status: '', branch: 'main', log: '' }))
  mocks.stage.mockReturnValue({ ok: true })
  mocks.unstage.mockReturnValue({ ok: true })
  mocks.commit.mockReturnValue({ ok: true, commitHash: 'abc123' })
  registerReviewHandlers()
})

describe('Review workspace identity', () => {
  it('reads the selected project while the foreground worker still belongs to another project', async () => {
    const result = await mocks.handlers.get('ipc:review.getDiff')!({ scope: 'git', cwd: '/project-b' })
    expect(mocks.read).toHaveBeenCalledWith('/project-b')
    expect(result).toMatchObject({ diff: { raw: '/project-b' } })
  })

  it.each([
    ['stageHunks', 'stage'],
    ['unstageHunks', 'unstage'],
    ['commit', 'commit'],
  ] as const)('allows %s in the selected project without moving the worker', async (method, mockKey) => {
    const result = await mocks.handlers.get(`ipc:review.${method}`)!({ cwd: '/project-b', files: [], message: 'test' })
    expect(result).toMatchObject({ ok: true })
    expect(mocks[mockKey]).toHaveBeenCalledWith('/project-b', method === 'commit' ? 'test' : [])
  })

  it('rejects a stale request after the selected workspace changes', async () => {
    const result = await mocks.handlers.get('ipc:review.getDiff')!({ scope: 'git', cwd: '/project-a' })
    expect(result).toMatchObject({ diff: { error: 'cwd_not_trusted' } })
    expect(mocks.read).not.toHaveBeenCalled()
    expect(await mocks.handlers.get('ipc:review.commit')!({ cwd: '/project-a', message: 'stale' })).toEqual({ ok: false, error: 'cwd_not_trusted' })
    expect(mocks.commit).not.toHaveBeenCalled()
  })

  it('does not read the process working directory when no project is trusted', async () => {
    mocks.currentProject = null
    mocks.workerCwd = null
    expect(await mocks.handlers.get('ipc:review.getDiff')!({ scope: 'git' })).toMatchObject({ diff: { error: 'no_trusted_workspace' } })
    expect(mocks.read).not.toHaveBeenCalled()
  })
})
