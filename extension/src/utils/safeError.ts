/** Extract a safe string from any thrown value — never JSON.stringify(raw Error/network objects. */
export function safeErrorMessage(err: unknown): string {
    if (err instanceof Error) {
        return err.message || err.name || 'Unknown error';
    }
    if (typeof err === 'string') {
        return err;
    }
    if (err === null || err === undefined) {
        return 'Unknown error';
    }
    if (typeof err === 'object') {
        const o = err as Record<string, unknown>;
        if (typeof o.message === 'string') { return o.message; }
        if (typeof o.detail === 'string') { return o.detail; }
    }
    try {
        return String(err);
    } catch {
        return 'Unknown error';
    }
}

/** Clone for postMessage — drops non-serializable values instead of crashing. */
export function toSerializable<T>(value: T): T {
    try {
        return JSON.parse(JSON.stringify(value)) as T;
    } catch {
        return value;
    }
}
