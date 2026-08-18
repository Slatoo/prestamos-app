import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { CheckCircle, AlertCircle, XCircle, Download } from "lucide-react"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SearchSelect } from "@/components/SearchSelect"
import { API_URL, fetchConReintento } from "@/lib/api"
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus"

export default function PrestamosLista() {
  const { getToken } = useAuth();
  const [prestamos, setPrestamos] = useState([])
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [saldoInfo, setSaldoInfo] = useState(null)
  const [pagoData, setPagoData] = useState({ monto: "", fecha: "" })
  const [errorPago, setErrorPago] = useState("")
  const [pagoProporcional, setPagoProporcional] = useState(false)
  const [metodos, setMetodos] = useState([])

  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("Todos")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")

  // Se incrementa al volver a esta pestaña tras tenerla en segundo plano
  const [refreshKey, setRefreshKey] = useState(0)
  useRefetchOnFocus(() => setRefreshKey((k) => k + 1))

  const fetchPrestamos = async () => {
    try {
      const token = await getToken();
      const res = await fetchConReintento(`${API_URL}/prestamos/`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Error al cargar préstamos");
      }
      const data = await res.json();
      setPrestamos(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error("Error del backend:", err);
      setPrestamos([]);
    }
  }

  useEffect(() => { fetchPrestamos() }, [getToken, refreshKey])

  useEffect(() => {
    const fetchMetodos = async () => {
      const token = await getToken();
      fetchConReintento(`${API_URL}/metodos-pago/`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((res) => res.json())
        .then(setMetodos)
        .catch(console.error)
    }
    fetchMetodos();
  }, [getToken, refreshKey])

  const handleOpenPago = async (prestamoId) => {
    setErrorPago("")
    setPagoProporcional(false)
    const today = new Date().toISOString().split('T')[0]
    const token = await getToken();

    fetchConReintento(`${API_URL}/prestamos/${prestamoId}/saldo/`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then((res) => res.json())
      .then((data) => {
        setSaldoInfo(data)
        setPagoData({ monto: "", fecha: today, metodo_pago_id: "" })
        setIsModalOpen(true)
      })
      .catch(console.error)
  }

    const handleRegistrarPago = async () => {
    setErrorPago("")

    // 1. Validar Monto (Solo números y punto para decimales)
    const montoRegex = /^\d+(\.\d{1,2})?$/
    if (!montoRegex.test(pagoData.monto)) {
      setErrorPago("El monto debe ser un número válido. Usa un punto para los decimales (ej. 50.00).")
      return
    }

    const montoNum = parseFloat(pagoData.monto)
    if (montoNum <= 0) {
      setErrorPago("El monto debe ser mayor a 0.")
      return
    }

    // 2. Validar Fecha (Que sea lógica)
    if (!pagoData.fecha) {
      setErrorPago("Debes seleccionar una fecha.")
      return
    }
    const parsedDate = new Date(pagoData.fecha + "T12:00:00")
    const year = parsedDate.getFullYear()
    if (isNaN(parsedDate.getTime()) || year < 2000 || year > 2100) {
      setErrorPago("La fecha ingresada no es válida.")
      return
    }

    // 3. Validar Método de Pago
    if (!pagoData.metodo_pago_id) {
      setErrorPago("Debes seleccionar un método de pago.")
      return
    }

    // 4. Enviar petición con manejo de errores amigable
    try {
      const token = await getToken()
      const res = await fetchConReintento(`${API_URL}/pagos/`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({
          prestamo_id: saldoInfo.prestamo_id,
          monto: montoNum,
          fecha: pagoData.fecha,
          pago_proporcional: pagoProporcional,
          metodo_pago_id: parseInt(pagoData.metodo_pago_id)
        })
      })

      if (!res.ok) {
        let errorMsg = "Ocurrió un error inesperado en el servidor."
        try {
          const errData = await res.json()
          errorMsg = errData.detail || errorMsg
        } catch (e) {
          // Si no se puede parsear el error, usamos el genérico
        }
        throw new Error(errorMsg)
      }

      setIsModalOpen(false)
      fetchPrestamos()
    } catch (err) {
      console.error("Error al registrar pago:", err)
      // Si es error de red (Failed to fetch), mostramos un mensaje claro
      if (err.message === 'Failed to fetch') {
        setErrorPago("Error de conexión. Verifica tu internet e inténtalo de nuevo.")
      } else {
        setErrorPago(err.message)
      }
    }
  }

  const prestamosFiltrados = (prestamos || []).filter((prestamo) => {
    const coincideBusqueda = prestamo.cliente_nombre.toLowerCase().includes(searchTerm.toLowerCase())

    let coincideEstado = true
    if (statusFilter === "Activo") coincideEstado = prestamo.estado === "Activo" && prestamo.estado_interes !== "atrasado"
    else if (statusFilter === "Atrasado") coincideEstado = prestamo.estado_interes === "atrasado"
    else if (statusFilter === "Pagado") coincideEstado = prestamo.estado === "Pagado"

    const coincideFechaDesde = dateFrom ? prestamo.fecha_inicio >= dateFrom : true
    const coincideFechaHasta = dateTo ? prestamo.fecha_inicio <= dateTo : true

    return coincideBusqueda && coincideEstado && coincideFechaDesde && coincideFechaHasta
  })

  const limpiarFiltros = () => {
    setSearchTerm("")
    setStatusFilter("Todos")
    setDateFrom("")
    setDateTo("")
  }

  const exportToCSV = () => {
    if (prestamosFiltrados.length === 0) {
      alert("No hay datos para exportar.")
      return
    }

    const headers = [
      "ID", "Cliente", "Capital Actual", "Intereses Pendientes", "Total a Pagar",
      "Fecha Inicial", "Dias Transcurridos", "Fecha Limite", "Estado"
    ]

    const csvRows = prestamosFiltrados.map(p => [
      p.id,
      `"${p.cliente_nombre}"`,
      p.capital_actual?.toFixed(2),
      p.intereses_pendientes?.toFixed(2),
      p.total_a_pagar_hoy?.toFixed(2),
      p.fecha_inicio,
      p.dias_transcurridos,
      p.fecha_limite,
      p.estado
    ])

    const csvContent = [
      headers.join(","),
      ...csvRows.map(row => row.join(","))
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.setAttribute("href", url)

    const today = new Date().toISOString().split('T')[0]
    link.setAttribute("download", `prestamos_${today}.csv`)

    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <>
      <Card className="shadow-sm border-slate-200">
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-slate-800">Préstamos Registrados</CardTitle>
          <Button variant="outline" size="sm" onClick={exportToCSV} disabled={prestamosFiltrados.length === 0}>
            <Download className="mr-2 h-4 w-4" />
            Exportar CSV
          </Button>
        </CardHeader>
        <CardContent>

          <div className="flex flex-col md:flex-row gap-4 mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
            <div className="flex-1">
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Buscar Cliente</label>
              <Input
                placeholder="Escribe un nombre..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>

            <div className="w-full md:w-48">
              <label className="text-xs font-semibold text-slate-500 mb-1 block">Estado</label>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Filtrar estado" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Todos">Todos</SelectItem>
                  <SelectItem value="Activo">Activo (Al día / Pendiente)</SelectItem>
                  <SelectItem value="Atrasado">Atrasado</SelectItem>
                  <SelectItem value="Pagado">Pagado</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2 items-end">
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">Fecha Inicial Desde</label>
                <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
              </div>
              <div>
                <label className="text-xs font-semibold text-slate-500 mb-1 block">Hasta</label>
                <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
              </div>
              <Button variant="outline" onClick={limpiarFiltros} className="mb-0.5">
                Limpiar
              </Button>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">ID</TableHead>
                <TableHead>Cliente</TableHead>
                <TableHead>Capital Actual</TableHead>
                <TableHead>Intereses Pend.</TableHead>
                <TableHead className="text-center">Estado Cuota</TableHead>
                <TableHead>Total a Pagar</TableHead>
                <TableHead>Fecha Inicial</TableHead>
                <TableHead>Días Transcurridos</TableHead>
                <TableHead>Fecha Límite</TableHead>
                <TableHead>Estado</TableHead>
                <TableHead className="text-right">Acciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {prestamosFiltrados.length > 0 ? (
                prestamosFiltrados.map((prestamo) => (
                  <TableRow key={prestamo.id}>
                    <TableCell className="font-medium">{prestamo.id}</TableCell>
                    <TableCell>{prestamo.cliente_nombre}</TableCell>
                    <TableCell className="font-bold">${prestamo.capital_actual?.toFixed(2)}</TableCell>
                    <TableCell className="text-amber-600">${prestamo.intereses_pendientes?.toFixed(2)}</TableCell>
                    <TableCell className="text-center">
                      {prestamo.estado_interes === "al_dia" && (
                        <span title="Al día"><CheckCircle className="h-5 w-5 text-green-500 inline-block" /></span>
                      )}
                      {prestamo.estado_interes === "pendiente_mes" && (
                        <span title="Pendiente mes"><AlertCircle className="h-5 w-5 text-amber-500 inline-block" /></span>
                      )}
                      {prestamo.estado_interes === "atrasado" && (
                        <span title="Atrasado"><XCircle className="h-5 w-5 text-red-600 inline-block" /></span>
                      )}
                    </TableCell>
                    <TableCell className="text-red-600 font-bold">${prestamo.total_a_pagar_hoy?.toFixed(2)}</TableCell>
                    <TableCell>{prestamo.fecha_inicio}</TableCell>
                    <TableCell>{prestamo.dias_transcurridos} días</TableCell>
                    <TableCell className={`font-semibold ${new Date(prestamo.fecha_limite + 'T12:00:00') < new Date(new Date().toISOString().split('T')[0] + 'T12:00:00') ? 'text-red-600' : 'text-green-600'}`}>
                      {prestamo.fecha_limite}
                    </TableCell>
                    <TableCell>
                      <Badge variant={prestamo.estado === "Activo" ? "default" : "secondary"}>
                        {prestamo.estado}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      {prestamo.estado === "Activo" && (
                        <Button size="sm" onClick={() => handleOpenPago(prestamo.id)}>
                          Registrar Pago
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell colSpan={11} className="text-center text-slate-500 py-8">
                    No se encontraron préstamos con los filtros aplicados.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* MODAL PARA REGISTRAR PAGO */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Registrar Pago - Préstamo #{saldoInfo?.prestamo_id}</DialogTitle>
            <DialogDescription>
              Fecha límite de pago actual: <span className="font-bold text-red-500">{saldoInfo?.fecha_limite}</span>
            </DialogDescription>
          </DialogHeader>

          {saldoInfo && (
            <div className="space-y-4 py-4">
              <div className="bg-blue-50 p-4 rounded-lg border border-blue-100 text-blue-800 space-y-1">
                <p className="text-sm">Capital Actual: <span className="font-bold">${saldoInfo.capital_actual?.toFixed(2)}</span></p>

                {!pagoProporcional ? (
                  <>
                    <p className="text-sm">Deuda Total Intereses ({saldoInfo.dias_transcurridos} días): <span className="font-bold">${saldoInfo.interes_mes_completo?.toFixed(2)}</span></p>
                    <div className="border-t border-blue-200 pt-1 mt-1">
                      <p className="text-sm font-semibold">Pago Mínimo (1 cuota mes): <span className="font-extrabold">${saldoInfo.pago_minimo?.toFixed(2)}</span></p>
                    </div>
                  </>
                ) : (
                  <>
                    <p className="text-sm">Interés Proporcional ({saldoInfo.dias_transcurridos} días): <span className="font-bold">${saldoInfo.interes_proporcional?.toFixed(2)}</span></p>
                    <div className="border-t border-blue-200 pt-1 mt-1">
                      <p className="text-sm font-semibold text-indigo-600">Pago Mínimo Proporcional: <span className="font-extrabold">${saldoInfo.interes_proporcional?.toFixed(2) || "0.00"}</span></p>
                    </div>
                  </>
                )}
              </div>

              {/* CHECK RESTAURADO AQUÍ */}
              <div className="flex items-center space-x-3 rounded-lg border border-slate-200 p-3 bg-slate-50">
                <input
                  type="checkbox"
                  id="pago-proporcional"
                  checked={pagoProporcional}
                  onChange={(e) => setPagoProporcional(e.target.checked)}
                  className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <label htmlFor="pago-proporcional" className="text-sm font-medium text-slate-900 cursor-pointer select-none">
                  Pago proporcional (Cobrar solo días transcurridos)
                </label>
              </div>

              <SearchSelect
                options={metodos.map((m) => ({ value: m.id.toString(), label: m.nombre }))}
                value={pagoData.metodo_pago_id}
                onChange={(value) => {
                  setPagoData({ ...pagoData, metodo_pago_id: value })
                  setErrorPago("")
                }}
                placeholder="Seleccionar Método de Pago"
                emptyMessage="No hay métodos creados"
              />

              {errorPago && (
                <Alert variant="destructive">
                  <AlertTitle>Pago Rechazado</AlertTitle>
                  <AlertDescription>{errorPago}</AlertDescription>
                </Alert>
              )}

              <div className="grid gap-4">
                <Input
                  type="number"
                  step="0.01"
                  placeholder="Monto a abonar"
                  value={pagoData.monto}
                  onChange={(e) => { setPagoData({ ...pagoData, monto: e.target.value }); setErrorPago(""); }}
                />
                <Input
                  type="date"
                  value={pagoData.fecha}
                  onChange={(e) => setPagoData({ ...pagoData, fecha: e.target.value })}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsModalOpen(false)}>Cancelar</Button>
            <Button onClick={handleRegistrarPago}>Guardar Pago</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}