// URL base del backend. En desarrollo cae en localhost si no se define
// VITE_API_URL; en producción SIEMPRE debe venir seteada por el entorno
// (ver frontend/.env.example) apuntando al backend desplegado.
export const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"
