export type Listener = (...args: any[]) => void;

type StoredListener = Listener & { listener?: Listener };

/**
 * Minimal, dependency-free event emitter.
 */
export class EventEmitter {
    #events = new Map<string | symbol, StoredListener[]>();

    on(event: string | symbol, listener: Listener): this {
        const list = this.#events.get(event);
        if (list) list.push(listener);
        else this.#events.set(event, [listener]);
        return this;
    }

    addListener(event: string | symbol, listener: Listener): this {
        return this.on(event, listener);
    }

    once(event: string | symbol, listener: Listener): this {
        const wrapper: StoredListener = (...args: any[]) => {
            this.off(event, wrapper);
            listener.apply(this, args);
        };
        wrapper.listener = listener;
        return this.on(event, wrapper);
    }

    off(event: string | symbol, listener: Listener): this {
        const list = this.#events.get(event);
        if (!list) return this;

        // Remove the most recently added match, same as Node.
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i] === listener || list[i].listener === listener) {
                list.splice(i, 1);
                break;
            }
        }
        if (list.length === 0) this.#events.delete(event);
        return this;
    }

    removeListener(event: string | symbol, listener: Listener): this {
        return this.off(event, listener);
    }

    removeAllListeners(event?: string | symbol): this {
        if (event === undefined) this.#events.clear();
        else this.#events.delete(event);
        return this;
    }

    emit(event: string | symbol, ...args: any[]): boolean {
        const list = this.#events.get(event);

        if (!list || list.length === 0) {
            if (event === "error") {
                const err = args[0];
                throw err instanceof Error ? err : new Error(`Unhandled error. (${String(err)})`);
            }
            return false;
        }

        for (const listener of [...list]) {
            listener.apply(this, args);
        }
        return true;
    }

    listenerCount(event: string | symbol): number {
        return this.#events.get(event)?.length ?? 0;
    }

    listeners(event: string | symbol): Listener[] {
        return (this.#events.get(event) ?? []).map((l) => l.listener ?? l);
    }

    eventNames(): (string | symbol)[] {
        return [...this.#events.keys()];
    }
}

export default EventEmitter;
