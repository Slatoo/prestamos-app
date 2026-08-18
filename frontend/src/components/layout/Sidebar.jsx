import { Link, useLocation } from "react-router-dom"
import { UserButton } from "@clerk/clerk-react"
import { LayoutDashboard, Users, UserPlus, Wallet, HandCoins, CreditCard, History, Menu, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Users, label: "Ver Clientes", path: "/clientes" },
  { icon: UserPlus, label: "Crear Cliente", path: "/clientes/crear" },
  { icon: Wallet, label: "Ver Préstamos", path: "/prestamos" },
  { icon: HandCoins, label: "Crear Préstamo", path: "/prestamos/crear" },
  { icon: CreditCard, label: "Métodos de Pago", path: "/metodos-pago" },
  { icon: History, label: "Historial", path: "/historial" },
]

export default function Sidebar({ isCollapsed, toggleSidebar, isMobileOpen, closeMobile }) {
  const location = useLocation()

  // En mobile el drawer siempre muestra las etiquetas completas (solo importa
  // "isCollapsed" -modo íconos- en escritorio). En mobile lo que manda es
  // si el drawer está abierto o cerrado (fuera de pantalla).
  const showLabels = isMobileOpen || !isCollapsed

  return (
    <>
      {/* Fondo oscuro detrás del drawer en mobile */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          onClick={closeMobile}
          aria-hidden="true"
        />
      )}

      <aside className={cn(
        "fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-white border-r border-slate-200 shadow-sm transition-transform duration-300",
        "md:static md:z-auto md:h-screen md:shadow-sm md:transition-[width]",
        isMobileOpen ? "translate-x-0" : "-translate-x-full",
        "md:translate-x-0",
        isCollapsed ? "md:w-20" : "md:w-64"
      )}>
        <div className="p-4 border-b border-slate-200 flex items-center justify-between">
          {showLabels && <h1 className="text-xl font-bold text-blue-600">Kredi</h1>}

          {/* Colapsar/expandir: solo tiene sentido en escritorio */}
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleSidebar}
            className="text-slate-600 hidden md:inline-flex"
          >
            <Menu className="h-5 w-5" />
          </Button>

          {/* Cerrar el drawer: solo en mobile */}
          <Button
            variant="ghost"
            size="icon"
            onClick={closeMobile}
            className="text-slate-600 md:hidden"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto">
          {menuItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={closeMobile}
              className={cn(
                "flex items-center p-3 rounded-lg transition-colors",
                location.pathname === item.path
                  ? "bg-blue-50 text-blue-600 font-medium"
                  : "text-slate-600 hover:bg-slate-50"
              )}
            >
              <item.icon className="h-5 w-5 flex-shrink-0" />
              {showLabels && <span className="ml-3">{item.label}</span>}
            </Link>
          ))}
        </nav>

        <div className={cn(
          "p-4 border-t border-slate-200 flex items-center",
          showLabels ? "justify-start gap-3" : "justify-center"
        )}>
          <UserButton afterSignOutUrl="/" />
          {showLabels && <span className="text-sm text-slate-600">Mi cuenta</span>}
        </div>
      </aside>
    </>
  )
}
