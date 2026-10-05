/** Stable names for the app's independent IndexedDB databases. */
export const APP_DATABASE_NAMES = {
  chats: 'open-pencil-chats',
  agentTasks: 'open-pencil-agent-tasks',
  credentials: 'open-pencil-credentials',
  libraries: 'open-pencil-libraries',
  localCanvas: 'open-pencil-cloud-local',
  outbox: 'open-pencil-cloud-outbox',
  recovery: 'open-pencil-recovery',
  diagnostics: 'open-pencil-diagnostics'
} as const
