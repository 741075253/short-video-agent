import { Injectable, MessageEvent } from '@nestjs/common'
import { Observable, Subject } from 'rxjs'

export type RunEvent = {
  type: string
  runId: string
  data?: Record<string, unknown>
  occurredAt: string
}

@Injectable()
export class RunEventsService {
  private readonly streams = new Map<string, Subject<MessageEvent>>()

  stream(runId: string): Observable<MessageEvent> {
    return this.subject(runId).asObservable()
  }

  emit(runId: string, type: string, data?: Record<string, unknown>): void {
    const event: RunEvent = { type, runId, data, occurredAt: new Date().toISOString() }
    this.subject(runId).next({ type, data: event })
  }

  close(runId: string): void {
    const stream = this.streams.get(runId)
    stream?.complete()
    this.streams.delete(runId)
  }

  private subject(runId: string): Subject<MessageEvent> {
    let stream = this.streams.get(runId)
    if (!stream) {
      stream = new Subject<MessageEvent>()
      this.streams.set(runId, stream)
    }
    return stream
  }
}
