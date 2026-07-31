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
