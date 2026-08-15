import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Users, Wallet, DollarSign, TrendingUp, CircleDollarSign, HandCoins, PiggyBank, ArrowLeft } from "lucide-react"
import { API_URL } from "@/lib/api"

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
]

export default function Dashboard() {
  const { getToken } = useAuth();
  const [stats, setStats] = useState(null)
  const [resumen, setResumen] = useState([])
  const [error, setError] = useState(null) // <-- Nuevo estado para errores

  // --- Filtros del reporte por período ---
  const currentYear = new Date().getFullYear()
  const [anio, setAnio] = useState(currentYear)
  const [mesFiltro, setMesFiltro] = useState("Todos")
  const [clienteFiltro, setClienteFiltro] = useState("")
  const [reporteMensual, setReporteMensual] = useState([])
  const [detalleMes, setDetalleMes] = useState(null)
  const [cargandoReporte, setCargandoReporte] = useState(false)

  const aniosDisponibles = Array.from({ length: 7 }, (_, i) => currentYear - 5 + i)

  useEffect(() => {
    const fetchDashboard = async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_URL}/dashboard/`, {
          headers: { Authorization: `Bearer ${token}` }
        });

        if (!res.ok) {
          // Si el backend responde con un error (ej. 401), lo leemos
          const errData = await res.json();
          throw new Error(errData.detail || "Error al cargar los datos");
        }

        const data = await res.json();
        setStats(data);

        const resResumen = await fetch(`${API_URL}/dashboard/resumen/`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (resResumen.ok) {
          setResumen(await resResumen.json());
        }
      } catch (err) {
        console.error("Error del backend:", err);
        setError(err.message);
      }
    }

    fetchDashboard();
  }, [getToken])

  // Reporte mensual del año elegido (se recalcula si cambia año o cliente, con debounce en el texto)
  useEffect(() => {
    const timeoutId = setTimeout(async () => {
      setCargandoReporte(true)
      try {
        const token = await getToken();
        const params = new URLSearchParams({ anio: anio.toString() })
        if (clienteFiltro.trim()) params.set("cliente", clienteFiltro.trim())

        const res = await fetch(`${API_URL}/dashboard/reporte-mensual/?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) setReporteMensual(await res.json());
      } catch (err) {
        console.error("Error al cargar reporte mensual:", err)
      } finally {
        setCargandoReporte(false)
      }
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [anio, clienteFiltro, getToken])

  // Detalle del mes elegido (drill-down)
  useEffect(() => {
    if (mesFiltro === "Todos") return
    const timeoutId = setTimeout(async () => {
      try {
        const token = await getToken();
        const params = new URLSearchParams({ anio: anio.toString(), mes: mesFiltro })
        if (clienteFiltro.trim()) params.set("cliente", clienteFiltro.trim())

        const res = await fetch(`${API_URL}/dashboard/detalle-mes/?${params}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.ok) setDetalleMes(await res.json());
      } catch (err) {
        console.error("Error al cargar detalle del mes:", err)
      }
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [mesFiltro, anio, clienteFiltro, getToken])

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

  // --- KPIs del período elegido (suman los 12 meses o toman el mes puntual) ---
  const filaMes = mesFiltro !== "Todos" ? reporteMensual.find(r => r.mes === parseInt(mesFiltro)) : null
  const kpiPeriodo = mesFiltro === "Todos"
    ? reporteMensual.reduce((acc, r) => ({
        prestamos_nuevos: acc.prestamos_nuevos + r.prestamos_nuevos,
        monto_prestado: acc.monto_prestado + r.monto_prestado,
        pagos_recibidos: acc.pagos_recibidos + r.pagos_recibidos,
        total_cobrado: acc.total_cobrado + r.total_cobrado,
        interes_cobrado: acc.interes_cobrado + r.interes_cobrado,
        capital_cobrado: acc.capital_cobrado + r.capital_cobrado,
      }), { prestamos_nuevos: 0, monto_prestado: 0, pagos_recibidos: 0, total_cobrado: 0, interes_cobrado: 0, capital_cobrado: 0 })
    : (filaMes || { prestamos_nuevos: 0, monto_prestado: 0, pagos_recibidos: 0, total_cobrado: 0, interes_cobrado: 0, capital_cobrado: 0 })

  const limpiarFiltrosPeriodo = () => {
    setAnio(currentYear)
    setMesFiltro("Todos")
    setClienteFiltro("")
  }

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

      {/* ======================= REPORTE POR PERÍODO ======================= */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800">Reporte por Período</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Filtros */}
          <div className="flex flex-col md:flex-row gap-4 mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex-1">
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Buscar Cliente</label>
              <Input
                placeholder="Escribe un nombre..."
                value={clienteFiltro}
                onChange={(e) => setClienteFiltro(e.target.value)}
              />
            </div>

            <div className="w-full md:w-40">
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Año</label>
              <Select value={anio.toString()} onValueChange={(v) => setAnio(parseInt(v))}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {aniosDisponibles.map((a) => (
                    <SelectItem key={a} value={a.toString()}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="w-full md:w-48">
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Mes</label>
              <Select value={mesFiltro} onValueChange={setMesFiltro}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Todos">Todos los meses</SelectItem>
                  {MESES.map((nombre, idx) => (
                    <SelectItem key={idx + 1} value={(idx + 1).toString()}>{nombre}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex items-end">
              <Button variant="outline" onClick={limpiarFiltrosPeriodo} className="mb-0.5">
                Limpiar
              </Button>
            </div>
          </div>

          {/* KPIs del período elegido */}
          <div className="grid gap-4 grid-cols-2 lg:grid-cols-4 mb-6">
            <div className="p-4 rounded-lg border border-amber-100 bg-amber-50">
              <div className="flex items-center gap-2 text-amber-700 text-xs font-semibold mb-1">
                <HandCoins className="h-4 w-4" /> Prestado en el período
              </div>
              <p className="text-xl font-bold text-amber-700">${kpiPeriodo.monto_prestado.toFixed(2)}</p>
              <p className="text-xs text-slate-500">{kpiPeriodo.prestamos_nuevos} préstamo(s) nuevo(s)</p>
            </div>
            <div className="p-4 rounded-lg border border-emerald-100 bg-emerald-50">
              <div className="flex items-center gap-2 text-emerald-700 text-xs font-semibold mb-1">
                <PiggyBank className="h-4 w-4" /> Ingresado en el período
              </div>
              <p className="text-xl font-bold text-emerald-700">${kpiPeriodo.total_cobrado.toFixed(2)}</p>
              <p className="text-xs text-slate-500">{kpiPeriodo.pagos_recibidos} pago(s) recibido(s)</p>
            </div>
            <div className="p-4 rounded-lg border border-blue-100 bg-blue-50">
              <div className="flex items-center gap-2 text-blue-700 text-xs font-semibold mb-1">
                <TrendingUp className="h-4 w-4" /> Interés Cobrado
              </div>
              <p className="text-xl font-bold text-blue-700">${kpiPeriodo.interes_cobrado.toFixed(2)}</p>
            </div>
            <div className="p-4 rounded-lg border border-indigo-100 bg-indigo-50">
              <div className="flex items-center gap-2 text-indigo-700 text-xs font-semibold mb-1">
                <Wallet className="h-4 w-4" /> Capital Cobrado
              </div>
              <p className="text-xl font-bold text-indigo-700">${kpiPeriodo.capital_cobrado.toFixed(2)}</p>
            </div>
          </div>

          {cargandoReporte && <p className="text-sm text-slate-400 mb-2">Actualizando...</p>}

          {mesFiltro === "Todos" ? (
            // --- Vista de los 12 meses del año ---
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mes</TableHead>
                  <TableHead>Préstamos Nuevos</TableHead>
                  <TableHead>Monto Prestado</TableHead>
                  <TableHead>Pagos Recibidos</TableHead>
                  <TableHead>Total Ingresado</TableHead>
                  <TableHead>Interés Cobrado</TableHead>
                  <TableHead>Capital Cobrado</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reporteMensual.map((r) => (
                  <TableRow
                    key={r.mes}
                    className="cursor-pointer hover:bg-slate-50"
                    onClick={() => setMesFiltro(r.mes.toString())}
                    title="Ver detalle del mes"
                  >
                    <TableCell className="font-medium">{MESES[r.mes - 1]}</TableCell>
                    <TableCell>{r.prestamos_nuevos}</TableCell>
                    <TableCell className="text-amber-700 font-semibold">${r.monto_prestado.toFixed(2)}</TableCell>
                    <TableCell>{r.pagos_recibidos}</TableCell>
                    <TableCell className="text-emerald-700 font-semibold">${r.total_cobrado.toFixed(2)}</TableCell>
                    <TableCell className="text-blue-700">${r.interes_cobrado.toFixed(2)}</TableCell>
                    <TableCell className="text-indigo-700">${r.capital_cobrado.toFixed(2)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            // --- Vista de detalle de un mes puntual ---
            <div className="space-y-6">
              <Button variant="outline" size="sm" onClick={() => setMesFiltro("Todos")}>
                <ArrowLeft className="mr-2 h-4 w-4" /> Volver a todos los meses
              </Button>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">
                  Préstamos otorgados en {MESES[parseInt(mesFiltro) - 1]} {anio}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Monto</TableHead>
                      <TableHead>Tasa</TableHead>
                      <TableHead>Ganancia Mínima</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detalleMes?.prestamos?.length > 0 ? (
                      detalleMes.prestamos.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell>{p.fecha}</TableCell>
                          <TableCell>{p.cliente_nombre}</TableCell>
                          <TableCell className="font-semibold">${p.monto.toFixed(2)}</TableCell>
                          <TableCell>{p.tasa_interes}%</TableCell>
                          <TableCell className="text-emerald-600 font-semibold">${p.ganancia_minima.toFixed(2)}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-slate-500 py-6">
                          No hay préstamos otorgados en este mes.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">
                  Pagos recibidos en {MESES[parseInt(mesFiltro) - 1]} {anio}
                </h3>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Fecha</TableHead>
                      <TableHead>Cliente</TableHead>
                      <TableHead>Préstamo</TableHead>
                      <TableHead>Monto Pagado</TableHead>
                      <TableHead>Interés</TableHead>
                      <TableHead>Capital</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {detalleMes?.pagos?.length > 0 ? (
                      detalleMes.pagos.map((pg) => (
                        <TableRow key={pg.id}>
                          <TableCell>{pg.fecha}</TableCell>
                          <TableCell>{pg.cliente_nombre}</TableCell>
                          <TableCell>#{pg.prestamo_id}</TableCell>
                          <TableCell className="font-semibold">${pg.monto.toFixed(2)}</TableCell>
                          <TableCell className="text-blue-600">${pg.interes_pagado.toFixed(2)}</TableCell>
                          <TableCell className="text-indigo-600">${pg.capital_pagado.toFixed(2)}</TableCell>
                        </TableRow>
                      ))
                    ) : (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-slate-500 py-6">
                          No hay pagos recibidos en este mes.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ======================= TABLA GLOBAL POR PRÉSTAMO ======================= */}
      <Card className="shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800">Préstamos e Ingresos (Totales Acumulados)</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>ID</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Monto Prestado</TableHead>
                <TableHead>Tasa</TableHead>
                <TableHead>Ganancia Mínima</TableHead>
                <TableHead>Capital Actual</TableHead>
                <TableHead>Total Pagado</TableHead>
                <TableHead>Interés Cobrado</TableHead>
                <TableHead>Capital Cobrado</TableHead>
                <TableHead>Estado</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {resumen.length > 0 ? (
                resumen.map((r) => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{r.id}</TableCell>
                    <TableCell>{r.cliente_nombre}</TableCell>
                    <TableCell>${r.monto?.toFixed(2)}</TableCell>
                    <TableCell>{r.tasa_interes}%</TableCell>
                    <TableCell className="text-emerald-600 font-semibold">${r.ganancia_minima?.toFixed(2)}</TableCell>
                    <TableCell className="text-red-600 font-bold">${r.capital_actual?.toFixed(2)}</TableCell>
                    <TableCell className="font-semibold">${r.total_pagado?.toFixed(2)}</TableCell>
                    <TableCell className="text-amber-600">${r.total_interes_cobrado?.toFixed(2)}</TableCell>
                    <TableCell className="text-blue-600">${r.total_capital_cobrado?.toFixed(2)}</TableCell>
                    <TableCell>
                      <Badge variant={r.estado === "Activo" ? "default" : "secondary"}>
                        {r.estado}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={10} className="text-center text-slate-500 py-8">
                    No hay préstamos registrados todavía.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}
