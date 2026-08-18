import { useState } from "react"
import { Outlet } from "react-router-dom"
import { Toaster } from "sonner"
import Sidebar from "./Sidebar"

export default function MainLayout() {
  const [isCollapsed, setIsCollapsed] = useState(false)

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar isCollapsed={isCollapsed} toggleSidebar={() => setIsCollapsed(!isCollapsed)} />
      <main className="flex-1 p-8 overflow-y-auto">
        <Outlet /> {/* Aquí se renderizarán las páginas */}
      </main>
      <Toaster richColors position="top-right" closeButton />
    </div>
  )
}