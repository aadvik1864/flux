/** Small-team, single-process barrier shared by WebSocket and history operations. */
export class RoomGate {
  private tails = new Map<string, Promise<void>>();

  async acquire(room: string): Promise<() => void> {
    const previous = this.tails.get(room) ?? Promise.resolve();
    let unlock!: () => void;
    const current = new Promise<void>(resolve => { unlock = resolve; });
    this.tails.set(room, current);
    await previous;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      unlock();
      if (this.tails.get(room) === current) this.tails.delete(room);
    };
  }

  async run<T>(room: string, operation: () => Promise<T>): Promise<T> {
    const release = await this.acquire(room);
    try { return await operation(); }
    finally { release(); }
  }
}
