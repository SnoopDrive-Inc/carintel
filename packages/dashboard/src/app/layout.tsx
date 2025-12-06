import type { Metadata } from "next";
import "./globals.css";

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
        <div className="flex min-h-screen">
          {/* Sidebar */}
          <aside className="w-64 border-r border-gray-800 p-4">
            <div className="mb-8">
              <h1 className="text-xl font-bold">Car Intel</h1>
              <p className="text-sm text-gray-400">Dashboard</p>
            </div>
            <nav className="space-y-2">
              <a
                href="/"
                className="block px-4 py-2 rounded-lg hover:bg-gray-800 transition"
              >
                Overview
              </a>
              <a
                href="/keys"
                className="block px-4 py-2 rounded-lg hover:bg-gray-800 transition"
              >
                API Keys
              </a>
              <a
                href="/usage"
                className="block px-4 py-2 rounded-lg hover:bg-gray-800 transition"
              >
                Usage
              </a>
              <a
                href="/settings"
                className="block px-4 py-2 rounded-lg hover:bg-gray-800 transition"
              >
                Settings
              </a>
            </nav>
            <div className="absolute bottom-4 left-4 right-4">
              <a
                href="https://docs.carintel.io"
                target="_blank"
                rel="noopener noreferrer"
                className="block text-sm text-gray-400 hover:text-white transition"
              >
                API Documentation
              </a>
            </div>
          </aside>

          {/* Main content */}
          <main className="flex-1 p-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
