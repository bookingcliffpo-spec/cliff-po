export class EventBus {
  constructor() { this._map = new Map(); }

  on(type, fn) {
    let arr = this._map.get(type);
    if (!arr) { arr = []; this._map.set(type, arr); }
    arr.push(fn);
    return () => this.off(type, fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => { off(); fn(payload); });
    return off;
  }

  off(type, fn) {
    const arr = this._map.get(type);
    if (!arr) return;
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  }

  emit(type, payload) {
    const arr = this._map.get(type);
    if (!arr) return;
    for (let i = 0; i < arr.length; i++) arr[i](payload);
  }

  clear() { this._map.clear(); }
}
