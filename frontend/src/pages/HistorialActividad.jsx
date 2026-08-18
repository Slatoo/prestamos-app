import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react" // <-- NUEVO IMPORT
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { History } from "lucide-react"
import { API_URL, fetchConReintento } from "@/lib/api"
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus"

export default function HistorialActividad() {
  const { getToken } = useAuth(); // <-- NUEVO HOOK DE CLERK
  const [actividades, setActividades] = useState([])
  const [page, setPage] = useState(1)
  const limit = 50

  // Estados de filtros
  const [search, setSearch] = useState("")
  const [categoria, setCategoria] = useState("Todos")
  const [accion, setAccion] = useState("Todos")
  const [fechaDesde, setFechaDesde] = useState("")
  const [fechaHasta, setFechaHasta] = useState("")

  // Se incrementa al volver a esta pestaña tras tenerla en segundo plano
  const [refreshKey, setRefreshKey] = useState(0)
  useRefetchOnFocus(() => setRefreshKey((k) => k + 1))

  const fetchActividades = async () => { // <-- AHORA ES ASYNC
    const token = await getToken(); // <-- OBTENEMOS EL TOKEN
    const skip = (page - 1) * limit
    let url = `${API_URL}/actividades/?skip=${skip}&limit=${limit}`

    if (search) url += `&search=${search}`
    if (categoria !== "Todos") url += `&categoria=${categoria}`
    if (accion !== "Todos") url += `&accion=${accion}`
    if (fechaDesde) url += `&fecha_desde=${fechaDesde}`
    if (fechaHasta) url += `&fecha_hasta=${fechaHasta}`

    fetchConReintento(url, {
      headers: { Authorization: `Bearer ${token}` } // <-- CABECERA NUEVA
    })
      .then((res) => res.json())
      .then(setActividades)
      .catch(console.error)
  }

  useEffect(() => {
    fetchActividades()
  }, [page, refreshKey]) // Se ejecuta cada vez que cambia la página

  const handleFiltrar = (e) => {
    e.preventDefault()
    setPage(1) // Resetear a página 1 al filtrar
    fetchActividades()
  }

  const limpiarFiltros = async () => { // <-- AHORA ES ASYNC
    const token = await getToken(); // <-- OBTENEMOS EL TOKEN
    setSearch("")
    setCategoria("Todos")
    setAccion("Todos")
    setFechaDesde("")
    setFechaHasta("")
    setPage(1)
    // Forzamos la recarga sin filtros
    setTimeout(() =>
      fetchConReintento(`${API_URL}/actividades/?skip=0&limit=${limit}`, {
        headers: { Authorization: `Bearer ${token}` } // <-- CABECERA NUEVA
      })
        .then(r=>r.json())
        .then(setActividades), 100)
  }

  // Colores para las categorías
  const getCategoriaColor = (cat) => {
    if (cat === "Clientes") return "bg-blue-100 text-blue-800"
    if (cat === "Préstamos") return "bg-purple-100 text-purple-800"
    if (cat === "Pagos") return "bg-green-100 text-green-800"
    return "bg-slate-100 text-slate-800" // Sistema
  }

  return (
    <Card className="shadow-sm border-slate-200">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-slate-800">
          <History className="h-6 w-6" /> Historial de Actividad
        </CardTitle>
      </CardHeader>
      <CardContent>
        
        {/* FILTROS */}
        <form onSubmit={handleFiltrar} className="flex flex-col md:flex-row gap-4 mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <div className="flex-1">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Buscar (Texto)</label>
            <Input placeholder="Ej: Jose, Préstamo #1..." value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>

          <div className="w-full md:w-40">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Categoría</label>
            <Select value={categoria} onValueChange={setCategoria}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Todos">Todas</SelectItem>
                <SelectItem value="Clientes">Clientes</SelectItem>
                <SelectItem value="Préstamos">Préstamos</SelectItem>
                <SelectItem value="Pagos">Pagos</SelectItem>
                <SelectItem value="Sistema">Sistema</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-full md:w-44">
            <label className="text-xs font-semibold text-slate-500 mb-1 block">Acción</label>
            <Select value={accion} onValueChange={setAccion}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="Todos">Todas</SelectItem>
                <SelectItem value="CREACIÓN">Creación</SelectItem>
                <SelectItem value="PAGO_REGISTRADO">Pago Registrado</SelectItem>
                <SelectItem value="ACTUALIZACIÓN">Actualización</SelectItem>
                <SelectItem value="ELIMINACIÓN">Eliminación</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex gap-2 items-end">
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Desde</label>
              <Input type="date" value={fechaDesde} onChange={(e) => setFechaDesde(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Hasta</label>
              <Input type="date" value={fechaHasta} onChange={(e) => setFechaHasta(e.target.value)} />
            </div>
            <Button type="submit">Filtrar</Button>
            <Button type="button" variant="outline" onClick={limpiarFiltros}>Limpiar</Button>
          </div>
        </form>

        {/* TABLA */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Fecha / Hora</TableHead>
              <TableHead>Categoría</TableHead>
              <TableHead>Acción</TableHead>
              <TableHead>Descripción</TableHead>
              <TableHead>Monto</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {actividades.length > 0 ? (
              actividades.map((act) => (
                <TableRow key={act.id}>
                  <TableCell className="font-mono text-xs text-slate-600">{act.fecha_hora}</TableCell>
                  <TableCell>
                    <Badge className={`${getCategoriaColor(act.categoria)} border-0`}>
                      {act.categoria}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{act.accion.replace("_", " ")}</TableCell>
                  <TableCell className="text-sm">{act.descripcion}</TableCell>
                  <TableCell className="text-right font-bold">
                    {act.monto_referencia ? `$${act.monto_referencia.toFixed(2)}` : "-"}
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-slate-500 py-8">
                  No se encontraron registros con los filtros aplicados.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>

        {/* PAGINACIÓN */}
        <div className="flex justify-between items-center mt-4">
          <p className="text-sm text-slate-500">
            Página {page} · Mostrando {actividades.length} de {limit} registros
          </p>
          <div className="flex gap-2">
            <Button 
              variant="outline" 
              size="sm" 
              disabled={page === 1} 
              onClick={() => setPage(prev => Math.max(prev - 1, 1))}
            >
              Anterior
            </Button>
            <Button 
              variant="outline" 
              size="sm" 
              disabled={actividades.length < limit} 
              onClick={() => setPage(prev => prev + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>

      </CardContent>
    </Card>
  )
}