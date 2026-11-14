export type MaestroEventType =
  | "run.started" | "job.stage.completed" | "job.checkpoint.reused"
  | "job.finished" | "run.completed" | "run.failed";

export interface MaestroEvent {
  sequence: number;
  timestamp: string;
  type: MaestroEventType;
  jobId?: string;
  stage?: string;
  completed?: number;
  total?: number;
  status?: string;
}

/** Bounded, in-memory event journal. No source payloads or external writes. */
export class MaestroEventJournal {
  private sequence = 0;
  private readonly entries: MaestroEvent[] = [];
  constructor(private readonly capacity = 1000) {
    if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 10000) throw new Error("Invalid event capacity");
  }
  append(event: Omit<MaestroEvent, "sequence" | "timestamp">): MaestroEvent {
    if (event.jobId !== undefined && !/^[A-Za-z0-9_-]{1,80}$/.test(event.jobId)) throw new Error("Invalid event job");
    const record: MaestroEvent = Object.freeze({ ...event, sequence: ++this.sequence, timestamp: new Date().toISOString() });
    this.entries.push(record);
    if (this.entries.length > this.capacity) this.entries.shift();
    return record;
  }
  list(after = 0): MaestroEvent[] {
    if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid event cursor");
    return this.entries.filter(event => event.sequence > after).map(event => ({ ...event }));
  }
}
