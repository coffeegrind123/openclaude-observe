// app/server/src/storage/index.ts

import { SqliteAdapter } from './sqlite-adapter'
import type { EventStore } from './types'
import { config } from '../config'

export function createStore(): EventStore {
  switch (config.storageAdapter) {
    case 'sqlite':
      return new SqliteAdapter(config.dbPath)
    default:
      throw new Error(`Unknown storage adapter: ${config.storageAdapter}`)
  }
}

export type { EventStore } from './types'
export type { InsertEventParams, EventFilters, StoredEvent } from './types'
