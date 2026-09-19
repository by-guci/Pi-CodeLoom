import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { parseGitDiff } from '@shared/diff-model'
import { FileDiffView } from './review-diff-views'

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (method: string, request: unknown) => method.startsWith('review.') ? mocks.invoke(method, request) : Promise.resolve({}) },
}))
vi.mock('react-i18next', async (importOriginal) => ({ ...await importOriginal<typeof import('react-i18next')>(), useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@renderer/stores/ui-store', () => ({ useUIStore: vi.fn() }))
vi.mock('@renderer/components/ui/line-gutter-add', () => ({ LineGutterAddButton: () => null }))
vi.mock('./review-hunk-comments', () => ({ ReviewHunkComments: () => null }))

const file = parseGitDiff('diff --git a/file.txt b/file.txt\n--- a/file.txt\n+++ b/file.txt\n@@ -1 +1 @@\n-old\n+new\n')[0]

beforeEach(() => { mocks.invoke.mockReset() })

it.each(['staged', 'unstaged'] as const)('shows a %s hunk failure and clears it after a successful retry', async (group) => {
  const onMutated = vi.fn()
  mocks.invoke.mockResolvedValueOnce({ ok: false, error: 'patch does not apply' }).mockResolvedValueOnce({ ok: true })
  render(<FileDiffView file={file} fallbackPath="file.txt" fallbackChangeType="modified" group={group} mode="inline" cwd="/project" defaultOpen onMutated={onMutated} />)
  const button = screen.getByTitle(group === 'staged' ? '撤销暂存此 hunk' : '暂存此 hunk')
  fireEvent.click(button)
  expect(await screen.findByRole('alert')).toHaveTextContent('patch does not apply')
  expect(onMutated).not.toHaveBeenCalled()
  fireEvent.click(button)
  await waitFor(() => expect(onMutated).toHaveBeenCalledOnce())
  expect(screen.queryByRole('alert')).not.toBeInTheDocument()
})

it('shows IPC rejection instead of silently ignoring it', async () => {
  mocks.invoke.mockRejectedValue(new Error('IPC disconnected'))
  render(<FileDiffView file={file} fallbackPath="file.txt" fallbackChangeType="modified" group="unstaged" mode="inline" cwd="/project" defaultOpen onMutated={vi.fn()} />)
  fireEvent.click(screen.getByTitle('暂存此 hunk'))
  expect(await screen.findByRole('alert')).toHaveTextContent('IPC disconnected')
})
