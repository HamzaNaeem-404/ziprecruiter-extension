export function textOf(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

export function attrOf(el: Element | null | undefined, name: string): string {
  return el?.getAttribute(name)?.trim() ?? '';
}

export function queryFirst(root: ParentNode, selectors: string[]): Element | null {
  for (const selector of selectors) {
    try {
      const el = root.querySelector(selector);
      if (el) return el;
    } catch {
      // Invalid selector — skip
    }
  }
  return null;
}

export function queryAll(root: ParentNode, selectors: string[]): Element[] {
  const seen = new Set<Element>();
  const results: Element[] = [];
  for (const selector of selectors) {
    try {
      root.querySelectorAll(selector).forEach((el) => {
        if (!seen.has(el)) {
          seen.add(el);
          results.push(el);
        }
      });
    } catch {
      // Invalid selector — skip
    }
  }
  return results;
}

export function waitFor(
  predicate: () => boolean,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 10000;
  const intervalMs = options.intervalMs ?? 100;

  return new Promise((resolve) => {
    if (predicate()) {
      resolve(true);
      return;
    }

    const started = Date.now();
    const timer = window.setInterval(() => {
      if (predicate()) {
        window.clearInterval(timer);
        observer?.disconnect();
        resolve(true);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        window.clearInterval(timer);
        observer?.disconnect();
        resolve(false);
      }
    }, intervalMs);

    let observer: MutationObserver | null = null;
    try {
      observer = new MutationObserver(() => {
        if (predicate()) {
          window.clearInterval(timer);
          observer?.disconnect();
          resolve(true);
        }
      });
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
      });
    } catch {
      // MutationObserver unavailable — polling still works
    }
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function absoluteUrl(href: string | null | undefined, base = location.href): string {
  if (!href) return '';
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

export function findByAccessibleName(
  role: string,
  namePattern: RegExp,
  root: ParentNode = document,
): Element | null {
  const candidates = root.querySelectorAll(
    `[role="${role}"], ${role === 'button' ? 'button, a, [tabindex]' : role}`,
  );
  for (const el of Array.from(candidates)) {
    const name =
      el.getAttribute('aria-label') ??
      el.getAttribute('title') ??
      el.textContent ??
      '';
    if (namePattern.test(name.trim())) return el;
  }
  return null;
}
