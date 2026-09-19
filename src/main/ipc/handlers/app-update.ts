import { z } from 'zod'
import { appUpdateController, openAppReleasePage } from '../../app-updater'
import { registerHandlerWithSchema } from '../registry'

const emptyRequest = z.object({}).strict().default({})

export function registerAppUpdateHandlers(): void {
  registerHandlerWithSchema('ipc:app.update.state', emptyRequest, async () => appUpdateController().state)
  registerHandlerWithSchema('ipc:app.update.check', emptyRequest, async () => appUpdateController().check(true))
  registerHandlerWithSchema('ipc:app.update.download', emptyRequest, async () => appUpdateController().download())
  registerHandlerWithSchema('ipc:app.update.install', emptyRequest, async () => appUpdateController().install())
  registerHandlerWithSchema('ipc:app.update.ignore', emptyRequest, async () => appUpdateController().ignore())
  registerHandlerWithSchema('ipc:app.update.autoCheck', z.object({ enabled: z.boolean() }).strict(), async ({ enabled }) => appUpdateController().setAutoCheck(enabled))
  registerHandlerWithSchema('ipc:app.update.openRelease', emptyRequest, async () => openAppReleasePage())
}
