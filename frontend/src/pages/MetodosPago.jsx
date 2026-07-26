import { useEffect, useState } from "react"
import { useAuth } from "@clerk/clerk-react" // <-- NUEVO IMPORT
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"

export default function MetodosPago() {
  const { getToken } = useAuth(); // <-- NUEVO HOOK DE CLERK
  const [metodos, setMetodos] = useState([])
  const [nombre, setNombre] = useState("")

  const fetchMetodos = async () => { // <-- AHORA ES ASYNC
    const token = await getToken(); // <-- OBTENEMOS EL TOKEN
    fetch("http://127.0.0.1:8000/metodos-pago/", {
      headers: { Authorization: `Bearer ${token}` } // <-- CABECERA NUEVA
    })
      .then((res) => res.json())
      .then(setMetodos)
      .catch(console.error)
  }

  useEffect(() => { fetchMetodos() }, [])

  const handleSubmit = async (e) => { // <-- AHORA ES ASYNC
    e.preventDefault()
    const token = await getToken(); // <-- OBTENEMOS EL TOKEN
    fetch("http://127.0.0.1:8000/metodos-pago/", {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}` // <-- CABECERA NUEVA
      },
      body: JSON.stringify({ nombre })
    })
      .then(() => {
        setNombre("")
        fetchMetodos()
      })
      .catch(console.error)
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
              onChange={(e) => setNombre(e.target.value)} 
              required 
            />
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