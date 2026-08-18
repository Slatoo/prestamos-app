import { useEffect, useRef } from "react"

/**
 * Vuelve a ejecutar `callback` cuando la pestaña pasa de oculta a visible
 * (el usuario la dejó en segundo plano un rato y volvió). Sin esto, si el
 * primer fetch falló mientras no mirabas (ej. backend recién despertando),
 * la página se quedaba mostrando datos viejos o vacíos hasta un refresh manual.
 */
export function useRefetchOnFocus(callback) {
  const callbackRef = useRef(callback)
  useEffect(() => {
    callbackRef.current = callback
  })

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        callbackRef.current()
      }
    }
    document.addEventListener("visibilitychange", handleVisibility)
    window.addEventListener("focus", handleVisibility)
    return () => {
      document.removeEventListener("visibilitychange", handleVisibility)
      window.removeEventListener("focus", handleVisibility)
    }
  }, [])
}
