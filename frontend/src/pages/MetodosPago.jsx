import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react" // <-- NUEVO IMPORT
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { API_URL, fetchConReintento } from "@/lib/api"
import { toast } from "sonner"
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus"

export default function MetodosPago() {
  const { getToken } = useAuth(); // <-- NUEVO HOOK DE CLERK
  const [metodos, setMetodos] = useState([])
  const [nombre, setNombre] = useState("")
  const [error, setError] = useState("")

  // Se incrementa al volver a esta pestaña tras tenerla en segundo plano
  const [refreshKey, setRefreshKey] = useState(0)
  useRefetchOnFocus(() => setRefreshKey((k) => k + 1))

  const fetchMetodos = async () => { // <-- AHORA ES ASYNC
    const token = await getToken(); // <-- OBTENEMOS EL TOKEN
    fetchConReintento(`${API_URL}/metodos-pago/`, {
      headers: { Authorization: `Bearer ${token}` } // <-- CABECERA NUEVA
    })
      .then((res) => res.json())
      .then(setMetodos)
      .catch(console.error)
  }

  useEffect(() => { fetchMetodos() }, [refreshKey])

  const handleSubmit = async (e) => { // <-- AHORA ES ASYNC
    e.preventDefault()
    setError("")
    const token = await getToken(); // <-- OBTENEMOS EL TOKEN
    try {
      const res = await fetchConReintento(`${API_URL}/metodos-pago/`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}` // <-- CABECERA NUEVA
        },
        body: JSON.stringify({ nombre })
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || "No se pudo guardar el método de pago.")
      }

      setNombre("")
      toast.success("Método de pago creado correctamente")
      fetchMetodos()
    } catch (err) {
      setError(err.message === 'Failed to fetch' ? "Error de conexión con el servidor." : err.message)
    }
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800">Nuevo Método de Pago</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <Input
              placeholder="Ej: Dólar Efectivo, BCV, USDT..."
              value={nombre}
              onChange={(e) => { setNombre(e.target.value); setError("") }}
              required
            />
            {error && (
              <Alert variant="destructive">
                <AlertTitle>No se pudo guardar</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Button type="submit" className="w-full">Guardar Método</Button>
          </form>
        </CardContent>
      </Card>

      <Card className="shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle className="text-slate-800">Métodos Registrados</CardTitle>
        </CardHeader>
        <CardContent>
          {metodos.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Nombre del Método</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {metodos.map((metodo) => (
                  <TableRow key={metodo.id}>
                    <TableCell>{metodo.id}</TableCell>
                    <TableCell className="font-medium">{metodo.nombre}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-sm text-slate-500">No hay métodos registrados aún.</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}