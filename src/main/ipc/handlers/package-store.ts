import { shell } from 'electron'
import { z } from 'zod'
import { registerHandlerWithSchema } from '../registry'
import { browsePackages } from '../../package-store-catalog'
import { checkPackageUpdates, mutateStorePackage, packageStoreState, updateAllStorePackages } from '../../package-store'
import { PACKAGE_NAME_PATTERN } from '@shared/package-store'

const name = z.string().max(214).regex(PACKAGE_NAME_PATTERN)
export function registerPackageStoreHandlers(): void {
  registerHandlerWithSchema('ipc:packages.browse', z.object({
    search: z.string().max(200).optional(), type: z.enum(['', 'extension', 'skill', 'prompt', 'theme']).optional(),
    sort: z.enum(['downloads', 'recent', 'name']).optional(), page: z.number().int().min(1).max(10000).optional(),
  }), browsePackages)
  registerHandlerWithSchema('ipc:packages.state', z.object({ latest: z.boolean().optional(), refresh: z.boolean().optional() }), packageStoreState)
  registerHandlerWithSchema('ipc:packages.checkUpdates', z.object({}), checkPackageUpdates)
  registerHandlerWithSchema('ipc:packages.updateAll', z.object({}), updateAllStorePackages)
  registerHandlerWithSchema('ipc:packages.mutate', z.object({ action: z.enum(['install', 'update', 'remove']), name }),
    (request) => mutateStorePackage(request.action, request.name))
  registerHandlerWithSchema('ipc:packages.open', z.object({ name: name.optional() }), async (request) => {
    await shell.openExternal(request.name ? `https://pi.dev/packages/${request.name}` : 'https://pi.dev/packages')
    return { ok: true }
  })
}
