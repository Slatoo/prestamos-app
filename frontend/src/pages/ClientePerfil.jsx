import { useEffect, useState } from "react"
import { useParams, Link } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react" // <-- NUEVO IMPORT
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ArrowLeft, User, Wallet, History, Edit, EyeOff, Eye, FileDown } from "lucide-react"
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LabelList } from "recharts"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import jsPDF from "jspdf"
import autoTable from "jspdf-autotable"
import { Label } from "@/components/ui/label"
import { API_URL, fetchConReintento } from "@/lib/api"
import { toast } from "sonner"
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus"

export default function ClientePerfil() {
  const { id } = useParams()
  const { getToken } = useAuth(); // <-- NUEVO HOOK DE CLERK
  const [cliente, setCliente] = useState(null)
  const [prestamos, setPrestamos] = useState([])
  const [actividades, setActividades] = useState([])

  // Estados para Editar
  const [isEditModalOpen, setIsEditModalOpen] = useState(false)
  const [editFormData, setEditFormData] = useState({ cedula: "", nombre: "", telefono: "", email: "" })

  // Se incrementa al volver a esta pestaña tras tenerla en segundo plano
  const [refreshKey, setRefreshKey] = useState(0)
  useRefetchOnFocus(() => setRefreshKey((k) => k + 1))

  const fetchClienteData = async () => { // <-- AHORA ES ASYNC
    const token = await getToken(); // <-- OBTENEMOS EL TOKEN

    fetchConReintento(`${API_URL}/clientes/${id}`, {
      headers: { Authorization: `Bearer ${token}` } // <-- CABECERA NUEVA
    })
      .then((res) => res.json())
      .then(data => {
        setCliente(data)
        setEditFormData({ cedula: data.cedula, nombre: data.nombre, telefono: data.telefono, email: data.email || "" })
      })
      .catch(console.error)

    fetchConReintento(`${API_URL}/prestamos/?cliente_id=${id}`, {
      headers: { Authorization: `Bearer ${token}` } // <-- CABECERA NUEVA
    })
      .then((res) => res.json())
      .then(setPrestamos)
      .catch(console.error)

    fetchConReintento(`${API_URL}/actividades/?cliente_id=${id}&limit=100`, {
      headers: { Authorization: `Bearer ${token}` } // <-- CABECERA NUEVA
    })
      .then((res) => res.json())
      .then(setActividades)
      .catch(console.error)
  }

  useEffect(() => {
    fetchClienteData()
  }, [id, refreshKey])

  if (!cliente) return <div className="p-8">Cargando perfil...</div>

  // --- CÁLCULOS FINANCIEROS ---
  const activeLoans = prestamos.filter(p => p.estado === "Activo")
  const capitalPendiente = activeLoans.reduce((sum, p) => sum + p.capital_actual, 0)
  const interesesPendientes = activeLoans.reduce((sum, p) => sum + p.intereses_pendientes, 0)
  const totalDeuda = capitalPendiente + interesesPendientes
  const totalPrestado = prestamos.reduce((sum, p) => sum + p.monto, 0)
  const totalPagado = actividades.filter(a => a.accion === "PAGO_REGISTRADO").reduce((sum, a) => sum + (a.monto_referencia || 0), 0)
  const capitalPagado = totalPrestado - capitalPendiente
  const interesesGanados = Math.max(0, totalPagado - capitalPagado)

  // Datos Gráfico de Dona
  const donaData = [ { name: "Capital", value: capitalPendiente }, { name: "Intereses", value: interesesPendientes } ]
  const COLORES_DONA = ["#3b82f6", "#f59e0b"]

  // Datos Gráfico de Barras
  const barraData = [ { name: "Prestado", monto: totalPrestado }, { name: "Capital Pagado", monto: capitalPagado }, { name: "Intereses Ganado", monto: interesesGanados }, { name: "Pendiente", monto: totalDeuda } ]
  const COLORES_BARRA = ["#3b82f6", "#10b981", "#f97316", "#ef4444"]

  // Funciones de Acción
  const handleEditSubmit = async (e) => { // <-- AHORA ES ASYNC
    e.preventDefault()
    const token = await getToken(); // <-- OBTENEMOS EL TOKEN
    fetchConReintento(`${API_URL}/clientes/${id}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}` // <-- CABECERA NUEVA
      },
      body: JSON.stringify(editFormData)
    })
      .then(res => { if(!res.ok) return res.json().then(err => { throw new Error(err.detail || "Error al editar") }) })
      .then(() => {
        setIsEditModalOpen(false)
        toast.success("Cliente actualizado correctamente")
        fetchClienteData()
      })
      .catch(err => toast.error(err.message))
  }

  const handleOcultar = async () => { // <-- AHORA ES ASYNC
    if (!confirm("¿Estás seguro de ocultar este cliente? Ya no aparecerá en las listas principales.")) return
    const token = await getToken(); // <-- OBTENEMOS EL TOKEN
    fetchConReintento(`${API_URL}/clientes/${id}/ocultar/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` } // <-- CABECERA NUEVA
    })
      .then(res => { if(!res.ok) return res.json().then(err => { throw new Error(err.detail) }) })
      .then(() => {
        toast.success("Cliente ocultado")
        fetchClienteData()
      })
      .catch(err => toast.error(err.message))
  }

  const handleRestaurar = async () => { // <-- AHORA ES ASYNC
    const token = await getToken(); // <-- OBTENEMOS EL TOKEN
    fetchConReintento(`${API_URL}/clientes/${id}/restaurar/`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` } // <-- CABECERA NUEVA
    })
      .then(res => { if(!res.ok) throw new Error("Error al restaurar") })
      .then(() => {
        toast.success("Cliente restaurado")
        fetchClienteData()
      })
      .catch(err => toast.error(err.message === 'Failed to fetch' ? "Error de conexión con el servidor." : "Error al restaurar el cliente."))
  }
  
  // ... AQUÍ CONTINÚA EL RESTO DE TU CÓDIGO JSX (EL RETURN) ...

  // Función para exportar a PDF
  const exportToPDF = () => {
    const doc = new jsPDF()
    doc.setFontSize(20)
    doc.setTextColor(59, 130, 246)
    doc.text("PrestamosApp", 14, 22)
    doc.setFontSize(14)
    doc.setTextColor(100, 116, 139)
    doc.text("Estado de Cuenta", 14, 30)
    doc.setDrawColor(203, 213, 225)
    doc.line(14, 33, 196, 33)
    doc.setFontSize(11)
    doc.setTextColor(15, 23, 42)
    doc.text(`Cliente: ${cliente.nombre}`, 14, 42)
    doc.text(`Cédula: ${cliente.cedula}`, 14, 49)
    doc.text(`Fecha de Emisión: ${new Date().toLocaleDateString()}`, 14, 56)

    const tableColumn = ["N°", "Capital", "Intereses", "Total a Pagar", "Estado"]
    const tableRows = prestamos.map((p, index) => [
      index + 1, `$${p.capital_actual.toFixed(2)}`, `$${p.intereses_pendientes.toFixed(2)}`, `$${p.total_a_pagar_hoy.toFixed(2)}`, p.estado
    ])
    autoTable(doc, { head: [tableColumn], body: tableRows, startY: 65, theme: "grid", headStyles: { fillColor: [59, 130, 246] }, styles: { fontSize: 9 } })

    const finalY = doc.lastAutoTable.finalY + 10
    doc.setFontSize(14)
    doc.setTextColor(239, 68, 68)
    doc.text(`Deuda Total Pendiente: $${totalDeuda.toFixed(2)}`, 14, finalY)
    doc.save(`Estado_Cuenta_${cliente.nombre.replace(/\s+/g, '_')}.pdf`)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4 min-w-0">
          <Link to="/clientes">
            <Button variant="outline" size="icon"><ArrowLeft className="h-4 w-4" /></Button>
          </Link>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-800 truncate">
            {cliente.nombre} {!cliente.activo && <Badge variant="destructive" className="ml-2">Oculto</Badge>}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setIsEditModalOpen(true)}>
            <Edit className="mr-2 h-4 w-4" /> Editar
          </Button>
          {cliente.activo ? (
            <Button variant="destructive" onClick={handleOcultar}>
              <EyeOff className="mr-2 h-4 w-4" /> Ocultar
            </Button>
          ) : (
            <Button variant="outline" onClick={handleRestaurar}>
              <Eye className="mr-2 h-4 w-4" /> Restaurar
            </Button>
          )}
          <Button onClick={exportToPDF} disabled={prestamos.length === 0}>
            <FileDown className="mr-2 h-4 w-4" /> PDF
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        
        {/* Columna 1: Info y Gráficos */}
        <div className="space-y-6">
          <Card className="shadow-sm border-slate-200">
            <CardHeader className="pb-2">
              <CardTitle className="text-lg flex items-center gap-2"><User className="h-5 w-5 text-blue-600" /> Información</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              <p><span className="font-semibold text-slate-500">Cédula:</span> {cliente.cedula}</p>
              <p><span className="font-semibold text-slate-500">Teléfono:</span> {cliente.telefono}</p>
              <p><span className="font-semibold text-slate-500">Email:</span> {cliente.email}</p>
            </CardContent>
          </Card>

          <Card className="shadow-sm border-slate-200">
            <CardHeader><CardTitle className="text-sm font-medium text-slate-500">Desglose de Deuda Actual</CardTitle></CardHeader>
            <CardContent className="flex items-center justify-center">
              <div className="w-full h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={donaData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} paddingAngle={5} dataKey="value">
                      {donaData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORES_DONA[index % COLORES_DONA.length]} />))}
                    </Pie>
                    <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
            <div className="px-6 pb-4 text-center">
              <p className="text-2xl font-bold text-slate-900">${totalDeuda.toFixed(2)}</p>
              <div className="flex justify-center gap-4 mt-2 text-xs">
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-blue-500"></div>Capital</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-amber-500"></div>Intereses</div>
              </div>
            </div>
          </Card>

          <Card className="shadow-sm border-slate-200">
            <CardHeader><CardTitle className="text-sm font-medium text-slate-500">Resumen General</CardTitle></CardHeader>
            <CardContent>
              <div className="w-full h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={barraData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip formatter={(value) => `$${value.toFixed(2)}`} />
                    <Bar dataKey="monto" radius={[4, 4, 0, 0]}>
                      <LabelList dataKey="monto" position="top" formatter={(value) => `$${value.toFixed(0)}`} />
                      {barraData.map((entry, index) => (<Cell key={`cell-${index}`} fill={COLORES_BARRA[index % COLORES_BARRA.length]} />))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-4 text-xs">
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-blue-500"></div>Prestado</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-emerald-500"></div>Capital Pagado</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-orange-500"></div>Ganancia (Intereses)</div>
                <div className="flex items-center gap-1"><div className="w-3 h-3 rounded-full bg-red-500"></div>Pendiente</div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Columna 2 y 3: Préstamos y Actividad */}
        <div className="md:col-span-2 space-y-6">
          <Card className="shadow-sm border-slate-200">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><Wallet className="h-5 w-5 text-purple-600" /> Préstamos</CardTitle></CardHeader>
            <CardContent>
              {prestamos.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>ID</TableHead><TableHead>Capital</TableHead><TableHead>Intereses</TableHead><TableHead>Total a Pagar</TableHead><TableHead>Estado</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prestamos.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>#{p.id}</TableCell>
                        <TableCell>${p.capital_actual.toFixed(2)}</TableCell>
                        <TableCell>${p.intereses_pendientes.toFixed(2)}</TableCell>
                        <TableCell className="font-bold">${p.total_a_pagar_hoy.toFixed(2)}</TableCell>
                        <TableCell><Badge variant={p.estado === "Activo" ? "default" : "secondary"}>{p.estado}</Badge></TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (<p className="text-sm text-slate-500">Este cliente no tiene préstamos.</p>)}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-slate-200">
            <CardHeader><CardTitle className="text-lg flex items-center gap-2"><History className="h-5 w-5 text-green-600" /> Últimas Actividades</CardTitle></CardHeader>
            <CardContent>
              {actividades.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow><TableHead>Fecha / Hora</TableHead><TableHead>Acción</TableHead><TableHead>Descripción</TableHead></TableRow>
                  </TableHeader>
                  <TableBody>
                    {actividades.map((act) => (
                      <TableRow key={act.id}>
                        <TableCell className="font-mono text-xs">{act.fecha_hora}</TableCell>
                        <TableCell><Badge variant="outline">{act.accion}</Badge></TableCell>
                        <TableCell className="text-sm">{act.descripcion}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (<p className="text-sm text-slate-500">Sin actividad reciente.</p>)}
            </CardContent>
          </Card>
        </div>
      </div>

            {/* MODAL DE EDICIÓN */}
      <Dialog open={isEditModalOpen} onOpenChange={setIsEditModalOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Editar Cliente</DialogTitle>
            <DialogDescription>Haz cambios en la información del cliente. Haz clic en guardar cuando termines.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditSubmit} className="grid gap-4 py-4">
            <div className="grid grid-cols-1 sm:grid-cols-4 sm:items-center gap-2 sm:gap-4">
              <Label htmlFor="edit-cedula" className="sm:text-right">Cédula</Label>
              <Input 
                id="edit-cedula" 
                value={editFormData.cedula} 
                onChange={(e) => setEditFormData({...editFormData, cedula: e.target.value})} 
                className="sm:col-span-3" 
                required 
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 sm:items-center gap-2 sm:gap-4">
              <Label htmlFor="edit-nombre" className="sm:text-right">Nombre</Label>
              <Input 
                id="edit-nombre" 
                value={editFormData.nombre} 
                onChange={(e) => setEditFormData({...editFormData, nombre: e.target.value})} 
                className="sm:col-span-3" 
                required 
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 sm:items-center gap-2 sm:gap-4">
              <Label htmlFor="edit-telefono" className="sm:text-right">Teléfono</Label>
              <Input 
                id="edit-telefono" 
                value={editFormData.telefono} 
                onChange={(e) => setEditFormData({...editFormData, telefono: e.target.value})} 
                className="sm:col-span-3" 
                required 
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 sm:items-center gap-2 sm:gap-4">
              <Label htmlFor="edit-email" className="sm:text-right">Email</Label>
              <Input
                id="edit-email"
                type="email"
                placeholder="Opcional"
                value={editFormData.email}
                onChange={(e) => setEditFormData({...editFormData, email: e.target.value})}
                className="sm:col-span-3"
              />
            </div>
            <DialogFooter>
              <Button type="submit" className="sm:col-span-4">Guardar Cambios</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

    </div>
  )
}