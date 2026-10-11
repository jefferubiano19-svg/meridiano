import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { PreviewHostBridge } from "@/components/preview-host-bridge";
import { AppShell } from "@/components/layout/app-shell";
import { TooltipProvider } from "@/components/ui/tooltip";
import appCss from "../styles.css?url";

const APP_NAME = "Meridiano";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      {
        name: "description",
        content:
          "Análisis predictivo de fútbol: probabilidades, cuota justa, valor esperado y gestión de riesgo. Sin garantías.",
      },
      { name: "theme-color", content: "#0c0d0b" },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "stylesheet", href: appCss },
      { rel: "manifest", href: "/__grok/manifest.webmanifest" },
      { rel: "apple-touch-icon", href: "/__grok/icon-180.png" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <html lang="es" className="antialiased" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){function hide(){document.documentElement.classList.add("meridiano-adult");try{localStorage.setItem("meridiano-age","1")}catch(e){}try{sessionStorage.setItem("meridiano-age","1")}catch(e){}document.cookie="meridiano-age=1; path=/; max-age=31536000; samesite=lax";document.querySelectorAll("[data-age-gate]").forEach(function(node){node.remove()})}function stored(){try{if(localStorage.getItem("meridiano-age")==="1"||sessionStorage.getItem("meridiano-age")==="1")return true}catch(e){}return document.cookie.indexOf("meridiano-age=1")!==-1}if(stored())hide();document.addEventListener("click",function(event){var target=event.target;if(!target||!target.closest||!target.closest("[data-age-accept]"))return;event.preventDefault();hide()},true)})();`,
          }}
        />
      </head>
      <body>
        <PreviewHostBridge />
        <TooltipProvider delayDuration={200}>
          <AppShell>
            <Outlet />
          </AppShell>
        </TooltipProvider>
        <Scripts />
      </body>
    </html>
  );
}
