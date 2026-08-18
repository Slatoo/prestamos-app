// URL base del backend. En desarrollo cae en localhost si no se define
// VITE_API_URL; en producción SIEMPRE debe venir seteada por el entorno
// (ver frontend/.env.example) apuntando al backend desplegado.
export const API_URL = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000"

// Backoff entre reintentos (ms). Cubre el caso típico de un backend en Render
// free tier que estaba dormido y tarda en despertar (~30-50s en el peor caso).
const REINTENTOS_DELAYS_MS = [2000, 4000, 8000, 15000]

const esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * Wrapper de fetch que reintenta automáticamente ante:
 * - fallos de red (backend inalcanzable, típico mientras Render despierta)
 * - 502/503/504 (gateway/servicio no disponible momentáneamente)
 *
 * NO reintenta errores propios de la app (400/401/404/etc.) — esos hay que
 * mostrarlos tal cual, reintentar no los va a arreglar.
 */
export async function fetchConReintento(url, options = {}) {
  let ultimoError

  for (let intento = 0; intento <= REINTENTOS_DELAYS_MS.length; intento++) {
    const esUltimoIntento = intento === REINTENTOS_DELAYS_MS.length
    try {
      const res = await fetch(url, options)
      if (!esUltimoIntento && [502, 503, 504].includes(res.status)) {
        await esperar(REINTENTOS_DELAYS_MS[intento])
        continue
      }
      return res
    } catch (err) {
      ultimoError = err
      if (esUltimoIntento) break
      await esperar(REINTENTOS_DELAYS_MS[intento])
    }
  }

  throw ultimoError
}
