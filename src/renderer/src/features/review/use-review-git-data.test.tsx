import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { useReviewGitData } from './use-review-git-data'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
  onGitWorkspaceChanged: () => () => {},
}))

beforeEach(() => { mocks.invoke.mockReset() })

it('requests the viewed workspace explicitly', async () => {
  mocks.invoke.mockResolvedValue({ diff: { raw: 'project-b', status: '', isRepo: true } })
  const { result } = renderHook(() => useReviewGitData({ enabled: true, workspace: '/project-b', worktreeChangeSignal: null }))
  await waitFor(() => expect(result.current.gitData?.raw).toBe('project-b'))
  expect(mocks.invoke).toHaveBeenCalledWith('review.getDiff', { sessionId: '', scope: 'git', cwd: '/project-b' })
})

it('ignores a previous workspace response and queues a request for the newly viewed workspace', async () => {
  let finishA!: (value: unknown) => void
  let finishB!: (value: unknown) => void
  mocks.invoke.mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve }))
    .mockImplementationOnce(() => new Promise((resolve) => { finishB = resolve }))
  const { result, rerender } = renderHook(({ workspace }) => useReviewGitData({ enabled: true, workspace, worktreeChangeSignal: null }), {
    initialProps: { workspace: '/project-a' },
  })
  rerender({ workspace: '/project-b' })
  await act(async () => finishA({ diff: { raw: 'stale-a', isRepo: true } }))
  expect(result.current.gitData).toBeNull()
  expect(mocks.invoke).toHaveBeenNthCalledWith(2, 'review.getDiff', { sessionId: '', scope: 'git', cwd: '/project-b' })
  await act(async () => finishB({ diff: { raw: 'current-b', isRepo: true } }))
  expect(result.current.gitData?.raw).toBe('current-b')
})
