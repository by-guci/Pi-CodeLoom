import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppUpdateState } from '@shared/app-update'
import i18n from '@renderer/lib/i18n'
import { useAppUpdateStore, connectAppUpdates } from '@renderer/lib/app-update-store'
import { registerSettingsDirtySlice } from './settings-dirty-registry'
import { AppUpdatePanel } from './app-update-panel'

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn() }))
vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: mocks.invoke }, onAppEvent: mocks.listen }))
const state: AppUpdateState = {
  revision: 1, currentVersion: '1.0.7', version: '1.0.8', phase: 'available', mode: 'automatic',
  notes: 'New themes', percent: null, transferred: null, total: null, error: null, notify: true,
  autoCheck: true, lastCheckedAt: null,
}

beforeEach(async () => {
  mocks.invoke.mockReset().mockResolvedValue(state)
  useAppUpdateStore.setState({ state, open: false, actionError: null })
  await i18n.changeLanguage('zh')
})
afterEach(cleanup)

describe('app update controls', () => {
  it('requires separate download and restart actions and displays live progress', async () => {
    render(<AppUpdatePanel />)
    fireEvent.click(screen.getByRole('button', { name: '下载更新' }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('app.update.download', {}))
    expect(mocks.invoke).not.toHaveBeenCalledWith('app.update.install', expect.anything())
    act(() => useAppUpdateStore.setState({ state: { ...state, phase: 'downloading', percent: 43 } }))
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '43')
    expect(screen.getByRole('button', { name: '检查更新' })).toBeDisabled()
    act(() => useAppUpdateStore.setState({ state: { ...state, phase: 'downloaded' } }))
    fireEvent.click(screen.getByRole('button', { name: '重启并安装' }))
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('app.update.install', {}))
  })

  it('keeps unknown progress indeterminate and shows a failed download with retry', () => {
    useAppUpdateStore.setState({ state: { ...state, phase: 'downloading' } })
    render(<AppUpdatePanel />)
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value')
    act(() => useAppUpdateStore.setState({ state: { ...state, error: 'download-failed' } }))
    expect(screen.getByRole('alert')).toHaveTextContent('下载失败')
    expect(screen.getByRole('button', { name: '下载更新' })).toBeEnabled()
  })

  it('does not restart while there are unsaved settings', () => {
    const unregister = registerSettingsDirtySlice({ id: 'update-test', isDirty: () => true, commit: async () => {}, discard: () => {} })
    try {
      useAppUpdateStore.setState({ state: { ...state, phase: 'downloaded' } })
      render(<AppUpdatePanel />)
      fireEvent.click(screen.getByRole('button', { name: '重启并安装' }))
      expect(screen.getByRole('alert')).toHaveTextContent('未保存的设置')
      expect(mocks.invoke).not.toHaveBeenCalled()
    } finally { unregister() }
  })

  it('uses the fixed release action for portable builds and blocks active release content', () => {
    useAppUpdateStore.setState({ state: { ...state, mode: 'manual', notes: '<img src=x onerror=alert(1)>' } })
    const { container } = render(<AppUpdatePanel />)
    expect(screen.queryByRole('button', { name: '下载更新' })).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '前往发布页' }))
    expect(mocks.invoke).toHaveBeenCalledWith('app.update.openRelease', {})
  })

  it('renders GitHub HTML release notes as headings and lists instead of source', () => {
    useAppUpdateStore.setState({ state: { ...state, notes: '<h2>Pi-CodeLoom v1.0.8</h2><p>优化 Thinking（思考等级）选择。</p><h3>✨ 新增</h3><ul><li>按模型显示 <strong>Thinking</strong> 等级</li><li>仅支持开关的模型显示 ON／OFF</li></ul>' } })
    const { container } = render(<AppUpdatePanel />)
    expect(screen.getByRole('heading', { level: 2, name: 'Pi-CodeLoom v1.0.8' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('strong')).toHaveTextContent('Thinking')
    expect(container.textContent).not.toContain('<h2>')
  })

  it('formats Markdown metadata and preserves escaped code examples', () => {
    useAppUpdateStore.setState({ state: { ...state, notes: '## 更新说明\n\n- **模型菜单**支持动态档位\n- 修复状态显示\n\n```html\n<h2>示例</h2>\n```' } })
    const { container } = render(<AppUpdatePanel />)
    expect(screen.getByRole('heading', { level: 2, name: '更新说明' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(container.querySelector('code')).toHaveTextContent('<h2>示例</h2>')
  })

  it('sanitizes remote HTML without dropping readable notes or enabling navigation', () => {
    useAppUpdateStore.setState({ state: { ...state, notes: '<h2 id="app" style="position:fixed" onclick="alert(1)">安全更新</h2><script>alert(1)</script><iframe src="https://example.com"></iframe><img src="https://example.com/pixel" onerror="alert(1)"><svg onload="alert(1)"></svg><p>修复 A &amp; B</p><a href="javascript:alert(1)">危险链接</a><a href="file:///C:/Windows">本地链接</a><a href="https://github.com/by-guci/Pi-CodeLoom">项目地址</a><form><input autofocus onfocus="alert(1)"></form>' } })
    const { container } = render(<AppUpdatePanel />)
    expect(screen.getByRole('heading', { name: '安全更新' })).toBeInTheDocument()
    expect(screen.getByText('修复 A & B')).toBeInTheDocument()
    expect(container.querySelector('script, iframe, img, svg, input, form, a, [onclick], [onerror], [onload]')).toBeNull()
    expect(container.querySelector('h2')).not.toHaveAttribute('style')
    expect(container.querySelector('h2')).not.toHaveAttribute('id')
    expect(container.textContent).toContain('项目地址')
  })

  it('keeps plain text line breaks and does not load Markdown images or links', () => {
    useAppUpdateStore.setState({ state: { ...state, notes: '第一行\n第二行\n\n[项目地址](https://github.com/by-guci/Pi-CodeLoom)\n\n![追踪图片](https://example.com/pixel)' } })
    const { container } = render(<AppUpdatePanel />)
    expect(container.querySelector('br')).toBeInTheDocument()
    expect(container.querySelector('a, img')).toBeNull()
    expect(container.textContent).toContain('项目地址')
  })

  it('does not overwrite a newer progress event with an older initial snapshot', async () => {
    let resolve!: (value: AppUpdateState) => void
    mocks.invoke.mockReturnValueOnce(new Promise((done) => { resolve = done }))
    const dispose = vi.fn()
    mocks.listen.mockReturnValue(dispose)
    const stop = connectAppUpdates()
    mocks.listen.mock.calls.at(-1)![0]({ type: 'app-update', state: { ...state, revision: 4, phase: 'downloading', percent: 52 } })
    resolve({ ...state, revision: 2 })
    await Promise.resolve()
    expect(useAppUpdateStore.getState().state).toMatchObject({ revision: 4, phase: 'downloading', percent: 52 })
    stop()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
