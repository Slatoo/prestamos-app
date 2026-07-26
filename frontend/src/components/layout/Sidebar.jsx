import { Link, useLocation } from "react-router-dom"
import { LayoutDashboard, Users, UserPlus, Wallet, HandCoins, CreditCard, History, Menu } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"


export default function Sidebar({ isCollapsed, toggleSidebar }) {
  const location = useLocation()

const menuItems = [
  { icon: LayoutDashboard, label: "Dashboard", path: "/" },
  { icon: Users, label: "Ver Clientes", path: "/clientes" },
  { icon: UserPlus, label: "Crear Cliente", path: "/clientes/crear" },
  { icon: Wallet, label: "Ver Préstamos", path: "/prestamos" },
  { icon: HandCoins, label: "Crear Préstamo", path: "/prestamos/crear" },
  { icon: CreditCard, label: "Métodos de Pago", path: "/metodos-pago" },
  { icon: History, label: "Historial", path: "/historial" },
]

  return (
    <aside className={cn(
      "h-screen bg-white border-r border-slate-200 flex flex-col transition-all duration-300 shadow-sm",
      isCollapsed ? "w-20" : "w-64"
    )}>
      <div className="p-4 border-b border-slate-200 flex items-center justify-between">
        {!isCollapsed && <h1 className="text-xl font-bold text-blue-600">PrestamosApp</h1>}
        <Button variant="ghost" size="icon" onClick={toggleSidebar} className="text-slate-600">
          <Menu className="h-5 w-5" />
        </Button>
      </div>

      <nav className="flex-1 p-4 space-y-2">
        {menuItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center p-3 rounded-lg transition-colors",
              location.pathname === item.path
                ? "bg-blue-50 text-blue-600 font-medium"
                : "text-slate-600 hover:bg-slate-50"
            )}
          >
            <item.icon className="h-5 w-5 flex-shrink-0" />
            {!isCollapsed && <span className="ml-3">{item.label}</span>}
          </Link>
        ))}
      </nav>
    </aside>
  )
}