import { useState } from "react"
import { useNavigate } from "react-router-dom"
import { useAuth } from "@clerk/clerk-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { API_URL } from "@/lib/api"

export default function ClienteForm() {
  const navigate = useNavigate();
  const { getToken } = useAuth();
  const [formData, setFormData] = useState({ cedula: "", nombre: "", telefono: "", email: "" })
  const [errors, setErrors] = useState({})

  // Sanitización en tiempo real: evita que el usuario escriiba caracteres no permitidos
  const handleChange = (e) => {
    const { name, value } = e.target
    let sanitizedValue = value

    if (name === "cedula") {
      // Solo números y guiones
      sanitizedValue = value.replace(/[^0-9-]/g, "")
    } else if (name === "nombre") {
      // Solo letras y espacios
      sanitizedValue = value.replace(/[^a-zA-ZáéíóúÁÉÍÓÚñÑ\s]/g, "")
    } else if (name === "telefono") {
      // Solo números, espacios, guiones y signo de suma
      sanitizedValue = value.replace(/[^0-9+\-\s]/g, "")
    }

    setFormData({ ...formData, [name]: sanitizedValue })
    // Limpiar el error de ese campo si el usuario empieza a corregir
    if (errors[name]) {
      setErrors({ ...errors, [name]: null })
    }
  }

  // Validación antes de enviar
  const validateForm = () => {
    let tempErrors = {}
    let isValid = true

    if (formData.cedula.length < 6) {
      tempErrors.cedula = "La cédula debe tener al menos 6 caracteres."
      isValid = false
    }

    if (formData.nombre.trim().length < 3) {
      tempErrors.nombre = "El nombre debe tener al menos 3 letras."
      isValid = false
    }

    // Validar que el teléfono tenga al menos 7 dígitos (ignorando espacios/guiones)
    const telefonoDigitos = formData.telefono.replace(/\D/g, "")
    if (telefonoDigitos.length < 7) {
      tempErrors.telefono = "El teléfono debe tener al menos 7 dígitos."
      isValid = false
    }

    // Email es opcional: solo validamos el formato si el usuario cargó algo
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (formData.email.trim() && !emailRegex.test(formData.email)) {
      tempErrors.email = "Ingresa un correo electrónico válido, o dejalo vacío."
      isValid = false
    }

    setErrors(tempErrors)
    return isValid
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Si la validación falla, detenemos el envío
    if (!validateForm()) return;

    const token = await getToken();

    try {
      const res = await fetch(`${API_URL}/clientes/`, {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(formData),
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.detail || "Error al guardar el cliente");
      }

      setFormData({ cedula: "", nombre: "", telefono: "", email: "" })
      navigate("/clientes")
    } catch (err) {
      console.error(err);
      // Si hay un error de conexión o del backend, lo mostramos en el email como ejemplo
      setErrors({ ...errors, email: err.message === 'Failed to fetch' ? "Error de conexión con el servidor." : err.message });
    }
  }

  return (
    <Card className="max-w-lg shadow-sm border-slate-200">
      <CardHeader>
        <CardTitle className="text-slate-800">Nuevo Cliente</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          
          {/* CÉDULA */}
          <div>
            <Input 
              name="cedula" 
              placeholder="Cédula de Identidad (Ej: 1234567)" 
              value={formData.cedula} 
              onChange={handleChange} 
              required 
            />
            {errors.cedula && <p className="text-red-500 text-xs mt-1">{errors.cedula}</p>}
          </div>

          {/* NOMBRE */}
          <div>
            <Input 
              name="nombre" 
              placeholder="Nombre completo" 
              value={formData.nombre} 
              onChange={handleChange} 
              required 
            />
            {errors.nombre && <p className="text-red-500 text-xs mt-1">{errors.nombre}</p>}
          </div>

          {/* TELÉFONO */}
          <div>
            <Input 
              name="telefono" 
              placeholder="Teléfono (Ej: +58 412-1234567)" 
              value={formData.telefono} 
              onChange={handleChange} 
              required 
            />
            {errors.telefono && <p className="text-red-500 text-xs mt-1">{errors.telefono}</p>}
          </div>

          {/* EMAIL (opcional) */}
          <div>
            <Input
              name="email"
              type="email"
              placeholder="Email (opcional)"
              value={formData.email}
              onChange={handleChange}
            />
            {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
          </div>

          <Button type="submit" className="w-full">Guardar Cliente</Button>
        </form>
      </CardContent>
    </Card>
  )
}