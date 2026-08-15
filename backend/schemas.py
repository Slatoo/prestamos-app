from datetime import datetime
from pydantic import BaseModel, EmailStr, Field, field_validator

def _validar_fecha(value: str) -> str:
    try:
        datetime.strptime(value, "%Y-%m-%d")
    except (ValueError, TypeError):
        raise ValueError("La fecha debe tener el formato YYYY-MM-DD")
    return value

# --- METODOS DE PAGO ---
class MetodoPagoCreate(BaseModel):
    nombre: str = Field(min_length=1, max_length=100)

class MetodoPagoResponse(MetodoPagoCreate):
    id: int
    class Config:
        from_attributes = True

# --- CLIENTES ---
class ClienteCreate(BaseModel):
    cedula: str = Field(min_length=1, max_length=30)
    nombre: str = Field(min_length=1, max_length=150)
    telefono: str = Field(min_length=1, max_length=30)
    email: EmailStr

class ClienteResponse(BaseModel):
    id: int
    cedula: str
    nombre: str
    telefono: str
    email: str
    activo: bool = True
    class Config:
        from_attributes = True

class ClienteUpdate(BaseModel):
    cedula: str | None = Field(default=None, min_length=1, max_length=30)
    nombre: str | None = Field(default=None, min_length=1, max_length=150)
    telefono: str | None = Field(default=None, min_length=1, max_length=30)
    email: EmailStr | None = None

# --- PRESTAMOS ---
class PrestamoCreate(BaseModel):
    cliente_id: int
    monto: float = Field(gt=0)
    tasa_interes: float = Field(gt=0)
    fecha_inicio: str
    metodo_pago_id: int
    # Por defecto es True, no hace falta enviarlo desde el frontend
    pago_proporcional: bool = True

    _validar_fecha_inicio = field_validator("fecha_inicio")(_validar_fecha)

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
    monto: float = Field(gt=0)
    fecha: str
    # El frontend enviará True o False dependiendo del check en el modal de pago
    pago_proporcional: bool = False
    metodo_pago_id: int

    _validar_fecha_pago = field_validator("fecha")(_validar_fecha)

class PagoResponse(PagoCreate):
    id: int
    interes_pagado: float = 0.0
    capital_pagado: float = 0.0
    class Config:
        from_attributes = True

# --- RESUMEN FINANCIERO (DASHBOARD) ---
class ResumenPrestamoResponse(BaseModel):
    id: int
    cliente_nombre: str
    monto: float
    tasa_interes: float
    ganancia_minima: float
    capital_actual: float
    total_pagado: float
    total_interes_cobrado: float
    total_capital_cobrado: float
    estado: str
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
