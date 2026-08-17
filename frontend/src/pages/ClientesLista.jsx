import { useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react" // <-- NUEVO IMPORT
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Search, X, Eye } from "lucide-react"
import { API_URL } from "@/lib/api"

export default function ClientesLista() {
  const { getToken } = useAuth(); // <-- NUEVO HOOK DE CLERK
  const [clientes, setClientes] = useState([])
  const [searchTerm, setSearchTerm] = useState("")
  const [showHidden, setShowHidden] = useState(false)

  useEffect(() => {
    // <-- CREAMOS UNA FUNCIÓN ASYNC DENTRO DEL USE EFFECT
    const fetchClientes = async () => {
      const token = await getToken(); // <-- OBTENEMOS EL TOKEN
      
      fetch(`${API_URL}/clientes/?show_hidden=${showHidden}`, {
        headers: { Authorization: `Bearer ${token}` } // <-- CABECERA NUEVA
      })
        .then((res) => res.json())
        .then((data) => setClientes(data))
        .catch((err) => console.error(err))
    }

    fetchClientes();
  }, [showHidden, getToken]) // <-- AÑADIMOS getToken POR BUENAS PRÁCTICAS

  // Lógica de filtrado
  const clientesFiltrados = clientes.filter((cliente) => {
    const term = searchTerm.toLowerCase()
    return (
      cliente.nombre.toLowerCase().includes(term) ||
      cliente.cedula.toLowerCase().includes(term) ||
      cliente.telefono.toLowerCase().includes(term) ||
      (cliente.email || "").toLowerCase().includes(term)
    )
  })

  return (
    <Card className="shadow-sm border-slate-200">
      <CardHeader>
        <CardTitle className="text-slate-800">Clientes Registrados</CardTitle>
      </CardHeader>
      <CardContent>
        
        {/* SECCIÓN DE BÚSQUEDA Y FILTRO OCULTOS */}
        <div className="flex items-center justify-between mb-6 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <div className="relative flex-1 mr-4">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input 
              placeholder="Buscar por nombre, cédula, teléfono o email..." 
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 bg-white"
            />
          </div>
          
          <Button 
            variant={showHidden ? "default" : "outline"} 
            onClick={() => setShowHidden(!showHidden)}
            className="flex-shrink-0"
          >
            <Eye className="mr-2 h-4 w-4" />
            {showHidden ? "Ver Activos" : "Ver Ocultos"}
          </Button>

          {searchTerm && (
            <Button variant="outline" size="icon" onClick={() => setSearchTerm("")} className="ml-2">
              <X className="h-4 w-4" />
            </Button>
          )}
        </div>

        {/* TABLA */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[50px]">ID</TableHead>
              <TableHead>Cédula</TableHead>
              <TableHead>Nombre</TableHead>
              <TableHead>Teléfono</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Estado</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {clientesFiltrados.length > 0 ? (
              clientesFiltrados.map((cliente) => (
                <TableRow key={cliente.id}>
                  <TableCell className="font-medium">{cliente.id}</TableCell>
                  <TableCell>{cliente.cedula}</TableCell>
                  <TableCell>
                    <Link to={`/clientes/${cliente.id}`} className="text-blue-600 hover:underline font-medium">
                      {cliente.nombre}
                    </Link>
                  </TableCell>
                  <TableCell>{cliente.telefono}</TableCell>
                  <TableCell>{cliente.email}</TableCell>
                  <TableCell>
                    {cliente.activo ? 
                      <span className="text-xs text-green-600">Activo</span> : 
                      <span className="text-xs text-red-500">Oculto</span>
                    }
                  </TableCell>
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-slate-500 py-8">
                  {searchTerm 
                    ? "No se encontraron clientes con esa búsqueda." 
                    : "No hay clientes para mostrar."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}