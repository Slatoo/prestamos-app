import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Users, Wallet, DollarSign, TrendingUp, CircleDollarSign } from "lucide-react"

export default function Dashboard() {
  const { getToken } = useAuth();
  const [stats, setStats] = useState(null)
  const [error, setError] = useState(null) // <-- Nuevo estado para errores

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const token = await getToken();
        const res = await fetch("http://127.0.0.1:8000/dashboard/", {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) {
          // Si el backend responde con un error (ej. 401), lo leemos
          const errData = await res.json();
          throw new Error(errData.detail || "Error al cargar los datos");
        }

        const data = await res.json();
        setStats(data);
      } catch (err) {
        console.error("Error del backend:", err);
        setError(err.message);
      }
    }

    fetchDashboard();
  }, [getToken])

  // Si hubo un error, lo mostramos en pantalla en lugar de colapsar
  if (error) return <div className="p-8 text-red-500 font-semibold">Error: {error}</div>
  
  // Si stats es null (todavía no cargó), mostramos esto
  if (!stats) return <div className="p-8 text-slate-500">Cargando métricas...</div>

  const cards = [
    {
      title: "Clientes Totales",
      value: stats.total_clientes,
      icon: Users,
      color: "text-blue-600",
      bg: "bg-blue-50"
    },
    {
      title: "Préstamos Activos",
      value: stats.prestamos_activos,
      icon: Wallet,
      color: "text-indigo-600",
      bg: "bg-indigo-50"
    },
    {
      title: "Monto Prestado",
      value: `$${stats.monto_prestado?.toFixed(2) ?? '0.00'}`, // <-- Protección extra
      icon: DollarSign,
      color: "text-amber-600",
      bg: "bg-amber-50"
    },
    {
      title: "Capital Vivo (Deuda)",
      value: `$${stats.capital_vivo?.toFixed(2) ?? '0.00'}`,
      icon: CircleDollarSign,
      color: "text-red-600",
      bg: "bg-red-50"
    },
    {
      title: "Ganancias (Intereses)",
      value: `$${stats.ganancias_intereses?.toFixed(2) ?? '0.00'}`,
      icon: TrendingUp,
      color: "text-emerald-600",
      bg: "bg-emerald-50"
    }
  ]

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-slate-800">Dashboard</h1>
      
      <div className="grid gap-6 md:grid-cols-3 lg:grid-cols-5">
        {cards.map((card, index) => (
          <Card key={index} className="shadow-sm border-slate-200">
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium text-slate-500">
                {card.title}
              </CardTitle>
              <div className={`p-2 rounded-lg ${card.bg}`}>
                <card.icon className={`h-5 w-5 ${card.color}`} />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${card.color}`}>{card.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800">Resumen de Cobros</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center border-b pb-2">
              <span className="text-slate-600">Total Cobrado a la fecha:</span>
              <span className="text-xl font-bold text-green-600">${stats.monto_cobrado?.toFixed(2) ?? '0.00'}</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-slate-600">Capital Pendiente por cobrar:</span>
              <span className="text-xl font-bold text-red-600">${stats.capital_vivo?.toFixed(2) ?? '0.00'}</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}