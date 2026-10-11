export function isGrokEmbedderOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:" && url.protocol !== "http:") return false;
    const host = url.hostname.toLowerCase();
    if (host === "grok.com" || host.endsWith(".grok.com")) return true;
    if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return true;
    return false;
  } catch {
    return false;
  }
}

const PUBLIC_URL_KEY = "meridiano-public-url";

function normalizePublicUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || !host.endsWith(".grok.me") || isSandboxPreviewGuestHost(host)) return null;
    return `${url.origin}/`;
  } catch {
    return null;
  }
}

export function publicShareUrl(): string | null {
  const live = shareableAppUrl("/");
  if (live) return live.endsWith("/") ? live : `${live}/`;
  if (typeof window === "undefined") return null;
  try {
    return normalizePublicUrl(window.localStorage.getItem(PUBLIC_URL_KEY) ?? "");
  } catch {
    return null;
  }
}

export function openWhatsAppShare(): void {
  let url = publicShareUrl();
  if (!url) {
    const pasted = window.prompt(
      "Pega la dirección publicada de Meridiano, la que termina en grok.me. Esa queda en el mensaje y se puede abrir en otro equipo.",
    );
    if (!pasted) return;
    url = normalizePublicUrl(pasted);
    if (!url) {
      window.alert("Tiene que terminar en grok.me. grok-sandbox.com no abre en otro equipo.");
      return;
    }
    try {
      window.localStorage.setItem(PUBLIC_URL_KEY, url);
    } catch {
      /* el enlace igual sale en este mensaje */
    }
  }
  const href = `https://wa.me/?text=${encodeURIComponent(`Meridiano. Ábrelo aquí: ${url}`)}`;
  const target = window.top && window.top !== window ? window.top : window;
  target.location.href = href;
}
export function shareableAppUrl(path = "/"): string | null {
  if (typeof window === "undefined") return null;
  const host = window.location.hostname.toLowerCase();
  if (isSandboxPreviewGuestHost(host) || host === "localhost" || host === "127.0.0.1") return null;
  const base = window.location.origin.replace(/\/$/, "");
  const suffix = path.startsWith("/") ? path : `/${path}`;
  return `${base}${suffix}`;
}
export function isSandboxPreviewGuestHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "grok-sandbox.com" || host.endsWith(".grok-sandbox.com");
}

function isRemintPreviewPair(guestHost: string, parentHost: string): boolean {
  const guest = guestHost.toLowerCase();
  const parent = parentHost.toLowerCase();
  const sep = ".preview.";
  const i = guest.indexOf(sep);
  if (i <= 0) return false;
  const label = guest.slice(0, i);
  const rest = guest.slice(i + sep.length);
  if (label.includes(".") || !rest.includes(".")) return false;
  return parent === rest || parent === `grok.${rest}`;
}

export function resolveParentEmbedderOrigin(
  parentIsSelf: boolean,
  referrer: string,
  ancestorOrigin?: string | null,
  guestHostname: string = "",
): string | null {
  if (parentIsSelf) return null;
  for (const candidate of [referrer, ancestorOrigin ?? ""].filter(Boolean)) {
    try {
      const url = new URL(
        candidate.includes("://") ? candidate : `https://${candidate}`,
      );
      if (url.protocol !== "https:" && url.protocol !== "http:") continue;
      if (isGrokEmbedderOrigin(url.origin)) return url.origin;
      if (
        isSandboxPreviewGuestHost(guestHostname) ||
        isRemintPreviewPair(guestHostname, url.hostname)
      ) {
        return url.origin;
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}
