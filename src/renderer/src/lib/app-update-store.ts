import { create } from 'zustand'
import type { AppUpdateState } from '@shared/app-update'
import { ipcClient, onAppEvent } from './ipc-client'
import { anySettingsSliceDirty } from '@renderer/features/settings/settings-dirty-registry'

export const useAppUpdateStore = create<{
  state: AppUpdateState | null
  open: boolean
  actionError: 'request-failed' | 'unsaved-settings' | null
}>(() => ({ state: null, open: false, actionError: null }))

function receive(state: AppUpdateState): void {
  if (!state || typeof state.revision !== 'number' || typeof state.currentVersion !== 'string') return
  const current = useAppUpdateStore.getState().state
  if (!current || state.revision >= current.revision) useAppUpdateStore.setState({ state })
}

export function connectAppUpdates(): () => void {
  let active = true
  const stop = onAppEvent((event) => { if (event.type === 'app-update') receive(event.state) })
  void ipcClient.invoke('app.update.state', {}).then((state) => { if (active) receive(state) }).catch(() => {
    if (active) useAppUpdateStore.setState({ actionError: 'request-failed' })
  })
  return () => { active = false; stop() }
}

export async function appUpdateAction(action: 'check' | 'download' | 'install' | 'ignore' | 'autoCheck' | 'openRelease', args = {}): Promise<void> {
  if (action === 'install' && anySettingsSliceDirty()) {
    useAppUpdateStore.setState({ actionError: 'unsaved-settings' })
    return
  }
  useAppUpdateStore.setState({ actionError: null })
  try {
    const result = await ipcClient.invoke(`app.update.${action}`, args)
    if (action !== 'openRelease') receive(result)
  } catch {
    useAppUpdateStore.setState({ actionError: 'request-failed' })
  }
}
