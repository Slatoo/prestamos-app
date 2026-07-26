from pydantic import BaseModel

# --- METODOS DE PAGO ---
class MetodoPagoCreate(BaseModel):
    nombre: str

class MetodoPagoResponse(MetodoPagoCreate):
    id: int
    class Config:
        from_attributes = True

# --- CLIENTES ---
class ClienteCreate(BaseModel):
    cedula: str
    nombre: str
    telefono: str
    email: str

class ClienteResponse(ClienteCreate):
    id: int
    activo: bool = True
    class Config:
        from_attributes = True

class ClienteUpdate(BaseModel):
    cedula: str | None = None
    nombre: str | None = None
    telefono: str | None = None
    email: str | None = None

# --- PRESTAMOS ---
class PrestamoCreate(BaseModel):
    cliente_id: int
    monto: float
    tasa_interes: float
    fecha_inicio: str
    metodo_pago_id: int
    # Por defecto es True, no hace falta enviarlo desde el frontend
    pago_proporcional: bool = True 

class PrestamoResponse(PrestamoCreate):
    id: int
    capital_actual: float
    ultimo_pago_fecha: str
    estado: str
    class Config:
        from_attributes = True

class PrestamoDetalleResponse(PrestamoResponse):
    cliente_nombre: str
    intereses_pendientes: float 
    total_a_pagar_hoy: float
    dias_transcurridos: int
    fecha_limite: str 
    estado_interes: str
    metodo_pago_nombre: str
    class Config:
        from_attributes = True

# --- PAGOS ---
class PagoCreate(BaseModel):
    prestamo_id: int
    monto: float
    fecha: str
    # El frontend enviará True o False dependiendo del check en el modal de pago
    pago_proporcional: bool = False 
    metodo_pago_id: int

class PagoResponse(PagoCreate):
    id: int
    class Config:
        from_attributes = True

# --- ACTIVIDAD / AUDITORÍA ---
class ActividadResponse(BaseModel):
    id: int
    fecha_hora: str
    categoria: str
    accion: str
    descripcion: str
    monto_referencia: float | None = None
    cliente_id: int | None = None
    
    class Config:
        from_attributes = True