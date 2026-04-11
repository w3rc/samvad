import { describe, it, expect, beforeEach } from 'vitest'
import { TaskStore } from '../src/task-store.js'

describe('TaskStore', () => {
  let store: TaskStore

  beforeEach(() => { store = new TaskStore(60 * 60 * 1000) }) // 1 hour retention

  it('creates a task in pending state', () => {
    const task = store.create()
    expect(task.taskId).toBeTruthy()
    expect(task.status).toBe('pending')
  })

  it('transitions task to running', () => {
    const { taskId } = store.create()
    store.setRunning(taskId, 0.1)
    expect(store.get(taskId)?.status).toBe('running')
    expect(store.get(taskId)?.progress).toBe(0.1)
  })

  it('transitions task to done with result', () => {
    const { taskId } = store.create()
    store.setDone(taskId, { answer: 42 })
    const task = store.get(taskId)
    expect(task?.status).toBe('done')
    expect(task?.result).toEqual({ answer: 42 })
    expect(task?.completedAt).toBeTruthy()
  })

  it('transitions task to failed with error', () => {
    const { taskId } = store.create()
    store.setFailed(taskId, { code: 'AGENT_UNAVAILABLE', message: 'crashed' })
    const task = store.get(taskId)
    expect(task?.status).toBe('failed')
    expect(task?.error?.code).toBe('AGENT_UNAVAILABLE')
  })

  it('returns undefined for unknown taskId', () => {
    expect(store.get('does-not-exist')).toBeUndefined()
  })
})
