import { useState } from "react"
import { Outlet } from "react-router-dom"
import { Toaster } from "sonner"
import { Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import Sidebar from "./Sidebar"

export default function MainLayout() {
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false)

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Barra superior solo en mobile: hamburguesa + marca */}
      <div className="fixed top-0 inset-x-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white px-4 md:hidden">
        <Button variant="ghost" size="icon" onClick={() => setIsMobileMenuOpen(true)} className="text-slate-600">
          <Menu className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold text-blue-600">Kredi</h1>
      </div>

      <Sidebar
        isCollapsed={isCollapsed}
        toggleSidebar={() => setIsCollapsed(!isCollapsed)}
        isMobileOpen={isMobileMenuOpen}
        closeMobile={() => setIsMobileMenuOpen(false)}
      />

      <main className="flex-1 overflow-y-auto p-4 pt-20 md:p-8">
        <Outlet /> {/* Aquí se renderizarán las páginas */}
      </main>
      <Toaster richColors position="top-right" closeButton />
    </div>
  )
}
