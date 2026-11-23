/* Compartir Meridiano. La dirección publicada vive aquí y en ningún otro lugar. */

/** Dirección pública de Meridiano (Vercel). */
export const SITE_URL = "https://meridiano-beige.vercel.app/";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** Dirección para compartir: la del sitio donde se está; en el computador de pruebas, la publicada. */
export function shareUrl(origin: string): string {
  try {
    const url = new URL(origin);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || LOCAL_HOSTS.has(url.hostname)) return SITE_URL;
    return `${url.origin}/`;
  } catch {
    return SITE_URL;
  }
}

/** Enlace de WhatsApp con el mensaje y la dirección. */
export function whatsAppHref(url: string): string {
  return `https://wa.me/?text=${encodeURIComponent(`Meridiano. Ábrelo aquí: ${url}`)}`;
}

/** Abre WhatsApp con la dirección de Meridiano. */
export function openWhatsAppShare(): void {
  window.location.href = whatsAppHref(shareUrl(window.location.origin));
}
