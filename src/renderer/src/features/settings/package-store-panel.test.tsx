import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import i18n from '@renderer/lib/i18n'
import { PackageStorePanel } from './package-store-panel'

const mock = vi.hoisted(() => ({ invoke: vi.fn().mockResolvedValue({}) }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mock.invoke } }))
const state = { busy: false, writable: true, installed: [], operation: null, log: [], error: null, needsRestart: false }
const catalog = { packages: [{ name: 'pi-mcp-adapter', description: 'Author description', author: 'author', types: ['extension'], downloads: 100, version: '1.0.0' }], total: 51, page: 1, hasNext: true }
beforeEach(async () => {
  await i18n.changeLanguage('zh')
  mock.invoke.mockReset().mockImplementation(async (method: string) => method === 'packages.browse' ? catalog : state)
})
afterEach(cleanup)
it('confirms batch updates, supports cancellation and displays partial results', async () => {
  const installedState = { ...state, installed: [{ name: 'pi-mcp-adapter', version: '1.0.0', source: 'npm:pi-mcp-adapter', pinned: false }] }
  let updated = false
  mock.invoke.mockImplementation(async (method: string) => {
    if (method === 'packages.browse') return catalog
    if (method === 'packages.updateAll') updated = true
    return updated ? { ...installedState, batch: { total: 2, completed: 2, results: [{ name: 'first', status: 'updated' }, { name: 'broken', status: 'failed' }] } } : installedState
  })
  render(<PackageStorePanel />)
  fireEvent.click(screen.getByRole('button', { name: '已安装' }))
  const button = await screen.findByRole('button', { name: '一键更新已安装插件' })
  await waitFor(() => expect(button).toBeEnabled())
  fireEvent.click(button)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
  expect(mock.invoke).not.toHaveBeenCalledWith('packages.updateAll', {})
  fireEvent.click(button)
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '一键更新已安装插件' }))
  expect(await screen.findByText('批量更新结束：成功 1 个，失败或跳过 1 个。')).toBeInTheDocument()
  expect(screen.getByText(/broken.*更新失败/)).toBeInTheDocument()
})
it('shows installed and latest versions and preserves the version constraint notice', async () => {
  mock.invoke.mockImplementation(async (method: string) => method === 'packages.browse' ? catalog : {
    ...state, installed: [{ name: 'pi-mcp-adapter', source: 'npm:pi-mcp-adapter@1.0.0', version: '1.0.0', pinned: true, latestVersion: '2.0.0' }],
  })
  render(<PackageStorePanel />)
  fireEvent.click(screen.getByRole('button', { name: '已安装' }))
  expect(await screen.findByText('npm 最新版本：2.0.0')).toBeInTheDocument()
  expect(screen.getByText(/已安装 1.0.0/)).toHaveTextContent('版本约束')
  expect(mock.invoke).toHaveBeenCalledWith('packages.state', { latest: true })
})
it('shows the Chinese summary and author original, and cancels without installing', async () => {
  render(<PackageStorePanel />)
  await screen.findByText('pi-mcp-adapter')
  expect(screen.getByText(/为 Pi 接入 MCP/)).toBeInTheDocument()
  expect(screen.getByText('Author description')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: '安装' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取消' }))
  expect(mock.invoke).not.toHaveBeenCalledWith('packages.mutate', expect.anything())
})
it('confirms install and keeps operation errors visible after refresh', async () => {
  mock.invoke.mockImplementation(async (method: string) => {
    if (method === 'packages.mutate') throw new Error('PACKAGE_AGENT_BUSY')
    return method === 'packages.browse' ? catalog : state
  })
  render(<PackageStorePanel />)
  fireEvent.click(await screen.findByRole('button', { name: '安装' }))
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '安装' }))
  await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('packages.mutate', { name: 'pi-mcp-adapter', action: 'install' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('有任务正在运行')
})
it('sends search, filtering and paging to the official catalog query', async () => {
  render(<PackageStorePanel />)
  await screen.findByText('pi-mcp-adapter')
  fireEvent.change(screen.getByRole('searchbox', { name: /搜索/ }), { target: { value: 'memory' } })
  fireEvent.click(screen.getByRole('button', { name: '搜索' }))
  await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('packages.browse', expect.objectContaining({ search: 'memory', page: 1 })))
  fireEvent.change(screen.getByRole('combobox', { name: '插件类型' }), { target: { value: 'skill' } })
  await waitFor(() => expect(mock.invoke).toHaveBeenCalledWith('packages.browse', expect.objectContaining({ type: 'skill', page: 1 })))
})
