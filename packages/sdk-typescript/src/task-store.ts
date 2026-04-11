// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from 'node:crypto'
import type { TaskRecord } from './types.js'

export class TaskStore {
  private tasks = new Map<string, TaskRecord>()

  constructor(private retentionMs: number) {}

  create(): TaskRecord {
    const task: TaskRecord = {
      taskId: randomUUID(),
      status: 'pending',
      createdAt: Date.now(),
    }
    this.tasks.set(task.taskId, task)
    return task
  }

  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId)
  }

  setRunning(taskId: string, progress = 0): void {
    const task = this.tasks.get(taskId)
    if (task) { task.status = 'running'; task.progress = progress }
  }

  setDone(taskId: string, result: Record<string, unknown>): void {
    const task = this.tasks.get(taskId)
    if (task) { task.status = 'done'; task.result = result; task.completedAt = Date.now() }
    this.scheduleEviction(taskId)
  }

  setFailed(taskId: string, error: { code: string; message: string }): void {
    const task = this.tasks.get(taskId)
    if (task) { task.status = 'failed'; task.error = error; task.completedAt = Date.now() }
    this.scheduleEviction(taskId)
  }

  private scheduleEviction(taskId: string): void {
    const handle = setTimeout(() => this.tasks.delete(taskId), this.retentionMs)
    // Prevent the eviction timer from keeping the Node event loop alive
    if (typeof handle.unref === 'function') handle.unref()
  }
}
