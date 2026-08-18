import { useState, useEffect } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { SearchSelect } from "@/components/SearchSelect"
import { API_URL, fetchConReintento } from "@/lib/api"

export default function PrestamoForm() {
  const navigate = useNavigate()
  const { getToken } = useAuth();
  const [clientes, setClientes] = useState([])
  const [metodos, setMetodos] = useState([])
  const [errors, setErrors] = useState({})
  
  const [formData, setFormData] = useState({ 
    cliente_id: "", 
    monto: "", 
    tasa_interes: "", 
    fecha_inicio: "", 
    pago_proporcional: true, 
    metodo_pago_id: ""
  })

  useEffect(() => {
    const fetchData = async () => {
      const token = await getToken();
      
      fetchConReintento(`${API_URL}/clientes/`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((res) => res.json())
        .then(setClientes)
        .catch(console.error)

      fetchConReintento(`${API_URL}/metodos-pago/`, {
        headers: { Authorization: `Bearer ${token}` }
      })
        .then((res) => res.json())
        .then(setMetodos)
        .catch(console.error)
    }

    fetchData();
  }, [getToken])

   const handleChange = (e) => {
    const { name, value } = e.target
    let sanitizedValue = value

    // Si el campo es monto o tasa, limpiamos todo lo que no sea número o punto
    if (name === "monto" || name === "tasa_interes") {
      // 1. Elimina letras, espacios, comas y caracteres raros
      sanitizedValue = value.replace(/[^0-9.]/g, "")
      
      // 2. Evita que el usuario ponga más de un punto decimal
      const parts = sanitizedValue.split(".")
      if (parts.length > 2) {
        sanitizedValue = parts[0] + "." + parts.slice(1).join("")
      }
    }

    setFormData({ ...formData, [name]: sanitizedValue })
    if (errors[name]) setErrors({ ...errors, [name]: null })
  }

  const handleSelectChange = (name, value) => {
    setFormData({ ...formData, [name]: value })
    if (errors[name]) setErrors({ ...errors, [name]: null })
  }

  const validateForm = () => {
    let tempErrors = {}
    let isValid = true

    if (!formData.cliente_id) {
      tempErrors.cliente_id = "Debes seleccionar un cliente."
      isValid = false
    }

    if (!formData.metodo_pago_id) {
      tempErrors.metodo_pago_id = "Debes seleccionar un método de pago."
      isValid = false
    }

    // Validar Monto (Solo números y punto, mayor a 0)
    const montoRegex = /^\d+(\.\d{1,2})?$/
    if (!montoRegex.test(formData.monto) || parseFloat(formData.monto) <= 0) {
      tempErrors.monto = "Ingresa un monto válido. Usa punto para decimales (ej. 1500.00)."
      isValid = false
    }

    // Validar Tasa (Solo números y punto, mayor a 0)
    const tasaRegex = /^\d+(\.\d{1,2})?$/
    if (!tasaRegex.test(formData.tasa_interes) || parseFloat(formData.tasa_interes) <= 0) {
      tempErrors.tasa_interes = "Ingresa una tasa válida. Usa punto para decimales (ej. 10.5)."
      isValid = false
    }

    // Validar Fecha (Lógica)
    if (!formData.fecha_inicio) {
      tempErrors.fecha_inicio = "Debes seleccionar una fecha."
      isValid = false
    } else {
      const parsedDate = new Date(formData.fecha_inicio + "T12:00:00")
      const year = parsedDate.getFullYear()
      if (isNaN(parsedDate.getTime()) || year < 2000 || year > 2100) {
        tempErrors.fecha_inicio = "La fecha ingresada no es válida."
        isValid = false
      }
    }

    setErrors(tempErrors)
    return isValid
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (!validateForm()) return

    const token = await getToken();
    try {
      const res = await fetchConReintento(`${API_URL}/prestamos/`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ 
          ...formData, 
          cliente_id: parseInt(formData.cliente_id), 
          monto: parseFloat(formData.monto), 
          tasa_interes: parseFloat(formData.tasa_interes),
          metodo_pago_id: parseInt(formData.metodo_pago_id)
        }),
      })

      if (!res.ok) {
        let errorMsg = "Ocurrió un error inesperado en el servidor."
        try {
          const errData = await res.json()
          errorMsg = typeof errData.detail === 'string' ? errData.detail : "Datos inválidos para el préstamo."
        } catch (e) {}
        throw new Error(errorMsg)
      }

      navigate("/prestamos")
    } catch (err) {
      console.error("Error al crear préstamo:", err)
      if (err.message === 'Failed to fetch') {
        setErrors({ general: "Error de conexión. Verifica tu internet e inténtalo de nuevo." })
      } else {
        setErrors({ general: err.message })
      }
    }
  }

  const clienteOptions = clientes.map((c) => ({
    value: c.id.toString(),
    label: `${c.nombre} (${c.cedula})`
  }))

  const metodoOptions = metodos.map((m) => ({
    value: m.id.toString(),
    label: m.nombre
  }))

  return (
    <Card className="max-w-lg shadow-sm border-slate-200">
      <CardHeader>
        <CardTitle className="text-slate-800">Nuevo Préstamo</CardTitle>
        <CardDescription>El interés se cobra por periodos de 30 días sobre el capital actual.</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          
          <div>
            <SearchSelect 
              options={clienteOptions} 
              value={formData.cliente_id} 
              onChange={(value) => handleSelectChange("cliente_id", value)} 
              placeholder="Seleccionar Cliente" 
              emptyMessage="No hay clientes creados" 
            />
            {errors.cliente_id && <p className="text-red-500 text-xs mt-1">{errors.cliente_id}</p>}
          </div>

          <div>
            <SearchSelect 
              options={metodoOptions} 
              value={formData.metodo_pago_id} 
              onChange={(value) => handleSelectChange("metodo_pago_id", value)} 
              placeholder="Seleccionar Método de Pago" 
              emptyMessage="No hay métodos de pago creados" 
            />
            {errors.metodo_pago_id && <p className="text-red-500 text-xs mt-1">{errors.metodo_pago_id}</p>}
          </div>

          <div>
            <Input 
              name="monto" 
              type="text" 
              inputMode="decimal"
              placeholder="Monto del Préstamo ($)" 
              value={formData.monto} 
              onChange={handleChange} 
            />
            {errors.monto && <p className="text-red-500 text-xs mt-1">{errors.monto}</p>}
          </div>

          <div>
            <Input 
              name="tasa_interes" 
              type="text"
              inputMode="decimal"
              placeholder="Tasa de Interés Mensual (%)" 
              value={formData.tasa_interes} 
              onChange={handleChange} 
            />
            {errors.tasa_interes && <p className="text-red-500 text-xs mt-1">{errors.tasa_interes}</p>}
          </div>

          <div>
            <Input 
              name="fecha_inicio" 
              type="date" 
              value={formData.fecha_inicio} 
              onChange={handleChange} 
            />
            {errors.fecha_inicio && <p className="text-red-500 text-xs mt-1">{errors.fecha_inicio}</p>}
          </div>

          {/* Mostrar error general (ej. fallo de conexión) */}
          {errors.general && (
            <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-lg text-sm">
              {errors.general}
            </div>
          )}

          <Button type="submit" className="w-full">Registrar Préstamo</Button>
        </form>
      </CardContent>
    </Card>
  )
}