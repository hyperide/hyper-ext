/** Stable membership view for the runtime fallback; compiler access stays independent. */
export function liveTable(idType, read, keys) {
  const toId = (key) => {
    if (typeof key !== 'string') return undefined;
    if (idType === 'string') return key;
    const id = Number(key);
    return Number.isSafeInteger(id) && String(id) === key ? id : undefined;
  };
  const reject = () => {
    throw new TypeError('Use put/remove for table membership; assign fields on entity views');
  };
  return new Proxy(Object.create(null), {
    get(_target, key) {
      const id = toId(key);
      return id === undefined ? undefined : read(id);
    },
    has(_target, key) {
      const id = toId(key);
      return id !== undefined && read(id) !== undefined;
    },
    ownKeys() {
      return keys();
    },
    getOwnPropertyDescriptor(_target, key) {
      const id = toId(key);
      if (id === undefined || read(id) === undefined) return undefined;
      return { configurable: true, enumerable: true, get: () => read(id) };
    },
    set: reject,
    deleteProperty: reject,
    defineProperty: reject,
    setPrototypeOf: reject,
    preventExtensions: reject,
  });
}

/** Native object ordering, computed only for a changed membership inventory. */
export function orderedTableKeys(ids) {
  const keys = Object.create(null);
  for (const id of ids) keys[String(id)] = true;
  return Object.keys(keys);
}
