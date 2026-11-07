import { Hash } from 'node:crypto';

/** Count real hash updates matching a canonical payload, preserving the native hashing operation. */
export function hashCalls(action: () => void, selected: (text: string) => boolean): number {
  const original = Hash.prototype.update; let calls = 0;
  Hash.prototype.update = new Proxy(original, {
    /** Observe only the synchronous pure-kernel invocation under test. */
    apply(target, receiver: unknown, args: unknown[]): Hash {
      if (typeof args[0] === 'string' && selected(args[0])) calls++;
      return Reflect.apply(target, receiver, args) as Hash;
    },
  });
  try { action(); } finally { Hash.prototype.update = original; }
  return calls;
}
