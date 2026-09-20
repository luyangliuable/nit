import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/theme-provider";
import { StoreProvider } from "@/lib/client/store";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Nit",
  description: "A PR centric coding agent powered by pi",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="h-screen overflow-hidden bg-background text-foreground antialiased">
        <script
          // Tag the document before paint so the desktop (Electron) chrome is
          // applied without a flash. Browsers never match this branch.
          dangerouslySetInnerHTML={{
            __html:
              "(function(){if(navigator.userAgent.indexOf('Electron')!==-1){document.documentElement.dataset.desktop=navigator.userAgent.indexOf('Mac')!==-1?'mac':'other';}})();",
          }}
        />
        <ThemeProvider>
          <StoreProvider>
            {children}
            <Toaster position="bottom-right" toastOptions={{ className: "border border-border" }} />
          </StoreProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
