import { useState } from 'react'
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { SandboxContextMenuPortal } from './sandbox-context-menu'

const mocks = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({}), changed: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke } }))
function Harness() {
  const [open, setOpen] = useState(true)
  return <SandboxContextMenuPortal menu={open ? { x: 0, y: 0, path: 'C:/fixture', label: '你好' } : null} onClose={() => setOpen(false)} onListChange={mocks.changed} />
}
beforeEach(async () => { mocks.invoke.mockReset().mockResolvedValue({ ok: true }); await i18n.changeLanguage('zh') })
afterEach(cleanup)
it('opens a themed dialog and cancelling never deletes the sandbox', () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  const dialog = screen.getByRole('dialog')
  expect(dialog).toHaveTextContent('目录与 pi 会话将一并移除')
  expect(dialog).toHaveClass('bg-popover')
  expect(within(dialog).getByRole('button', { name: '取消' })).toHaveFocus()
  fireEvent.keyDown(document, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(mocks.invoke).not.toHaveBeenCalledWith('workspace.sandbox.delete', expect.anything())
})
it('deletes the original target only after explicit confirmation', async () => {
  render(<Harness />)
  fireEvent.click(screen.getByRole('button', { name: '删除' }))
  expect(mocks.invoke).not.toHaveBeenCalledWith('workspace.sandbox.delete', expect.anything())
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '删除' }))
  await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('workspace.sandbox.delete', { path: 'C:/fixture' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})
