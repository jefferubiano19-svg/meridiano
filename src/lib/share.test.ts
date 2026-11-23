import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SITE_URL, shareUrl, whatsAppHref } from "./share";

describe("compartir Meridiano por WhatsApp", () => {
  it("en el sitio publicado comparte la dirección donde se está", () => {
    assert.equal(shareUrl("https://meridiano-beige.vercel.app"), "https://meridiano-beige.vercel.app/");
    assert.equal(shareUrl("https://otra-version.vercel.app/"), "https://otra-version.vercel.app/");
  });
  it("en el computador de pruebas comparte la dirección publicada (localhost no abre en otro equipo)", () => {
    for (const origin of ["http://localhost:8080", "http://127.0.0.1:8081", "http://[::1]:8080", "", "no es url"]) assert.equal(shareUrl(origin), SITE_URL, origin);
  });
  it("arma el mensaje de WhatsApp con la dirección", () => {
    assert.equal(whatsAppHref("https://meridiano-beige.vercel.app/"), `https://wa.me/?text=${encodeURIComponent("Meridiano. Ábrelo aquí: https://meridiano-beige.vercel.app/")}`);
  });
});
