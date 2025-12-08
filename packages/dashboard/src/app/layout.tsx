import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";
import { AdminProvider } from "@/components/AdminProvider";
import { Sidebar } from "@/components/Sidebar";

export const metadata: Metadata = {
  title: "Car Intel Dashboard",
  description: "Manage your API keys and view usage",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased min-h-screen">
        <AuthProvider>
          <AdminProvider>
            <div className="flex min-h-screen">
              <Sidebar />
              <main className="flex-1 p-8">{children}</main>
            </div>
          </AdminProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
