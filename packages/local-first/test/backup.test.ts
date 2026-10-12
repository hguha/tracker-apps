import { describe, expect, it } from 'vitest'
import { BackupParseError, backupRows, importBackupRows, parseBackupObject } from '../src/backup'

describe('parseBackupObject', () => {
  it('rejects text that is not JSON', () => {
    expect(() => parseBackupObject('{', 'nope')).toThrow(BackupParseError)
  })

  it('rejects JSON that is not an object', () => {
    expect(() => parseBackupObject('[1]', 'Not ours.')).toThrow('Not ours.')
  })
})

describe('backupRows', () => {
  it('keeps only rows with a string id', () => {
    expect(backupRows([{ id: 'a' }, { id: '' }, { id: 3 }, null, 'x', {}])).toEqual([{ id: 'a' }])
  })

  it('treats a missing table as empty', () => {
    expect(backupRows(undefined)).toEqual([])
  })
})

describe('importBackupRows', () => {
  it('writes inside the transaction and queues only synced tables', async () => {
    const order: string[] = []
    const store = (name: string) => ({
      bulkPut: async (rows: unknown[]) => void order.push(`put ${name} ${rows.length}`),
    })
    await importBackupRows({
      tables: [
        { table: 'workouts', store: store('workouts'), rows: [{ id: 'w1' }] },
        { table: 'records', store: store('records'), rows: [{ id: 'r1' }], isSynced: false },
        { table: 'sets', store: store('sets'), rows: [] },
      ],
      inTransaction: async (work) => {
        order.push('begin')
        await work()
        order.push('commit')
      },
      enqueue: async (table, id) => void order.push(`queue ${table} ${id}`),
    })
    expect(order).toEqual([
      'begin',
      'put workouts 1',
      'queue workouts w1',
      'put records 1',
      'commit',
    ])
  })
})
