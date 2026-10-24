type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: Partial<CSSStyleDeclaration> | string };

/** Tiny hyperscript helper: h('button.primary', { onclick }, 'Play'). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K | `${K}.${string}`, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const [name, ...classes] = tag.split('.');
  const el = document.createElement(name as K);
  if (classes.length) el.className = classes.join(' ');
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = [el.className, String(v)].filter(Boolean).join(' ');
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v as EventListener);
      else if (k in el && k !== 'list') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, String(v));
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el: Element) {
  while (el.firstChild) el.firstChild.remove();
}

export function show(el: HTMLElement, visible: boolean) {
  el.style.display = visible ? '' : 'none';
}

export function hex(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
