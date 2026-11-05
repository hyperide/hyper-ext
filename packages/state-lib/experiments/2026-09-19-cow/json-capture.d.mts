/** Does not promote unowned or shallow-frozen objects into the ownership registry. */
export function captureJsonSnapshot<T>(value: T): T;
