from fastapi import FastAPI, Depends, HTTPException, Request, Query
import os
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from datetime import datetime, timedelta
import math
import calendar
from sqlalchemy import text, func
from database import engine, Base, get_db
import models
import schemas

# --- IMPORTACIONES PARA CLERK ---
import jwt
import requests
from cachetools import TTLCache

# Crear tablas en la base de datos
Base.metadata.create_all(bind=engine)

# Migración ligera: agrega columnas/restricciones nuevas a tablas ya existentes
# (Base.metadata.create_all no altera tablas que ya existen)
with engine.connect() as conn:
    conn.execute(text("ALTER TABLE pagos ADD COLUMN IF NOT EXISTS interes_pagado FLOAT DEFAULT 0"))
    conn.execute(text("ALTER TABLE pagos ADD COLUMN IF NOT EXISTS capital_pagado FLOAT DEFAULT 0"))

    # cedula/email/nombre de método de pago quedaron como únicos GLOBALMENTE en versiones
    # viejas del esquema. Deben ser únicos solo por usuario (dos usuarios distintos pueden
    # tener cada uno un cliente con la misma cédula, o un método de pago "Efectivo").
    conn.execute(text('DROP INDEX IF EXISTS ix_clientes_cedula'))
    conn.execute(text('DROP INDEX IF EXISTS ix_clientes_email'))
    conn.execute(text('DROP INDEX IF EXISTS ix_metodos_pago_nombre'))
    conn.execute(text('CREATE INDEX IF NOT EXISTS ix_clientes_cedula ON clientes (cedula)'))
    conn.execute(text('CREATE INDEX IF NOT EXISTS ix_clientes_email ON clientes (email)'))
    conn.execute(text('CREATE INDEX IF NOT EXISTS ix_metodos_pago_nombre ON metodos_pago (nombre)'))

    for constraint_sql in [
        "ALTER TABLE clientes ADD CONSTRAINT uq_clientes_user_cedula UNIQUE (user_id, cedula)",
        "ALTER TABLE clientes ADD CONSTRAINT uq_clientes_user_email UNIQUE (user_id, email)",
        "ALTER TABLE metodos_pago ADD CONSTRAINT uq_metodos_pago_user_nombre UNIQUE (user_id, nombre)",
    ]:
        constraint_name = constraint_sql.split("ADD CONSTRAINT ")[1].split(" ")[0]
        conn.execute(text(f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '{constraint_name}') THEN
                    {constraint_sql};
                END IF;
            END $$;
        """))
    conn.commit()

# Mensajes amigables para violaciones de las restricciones únicas de arriba,
# en vez de dejar que el 500 crudo llegue al cliente.
_UNIQUE_ERROR_MESSAGES = {
    "uq_clientes_user_cedula": "Ya tenés un cliente registrado con esa cédula.",
    "uq_clientes_user_email": "Ya tenés un cliente registrado con ese email.",
    "uq_metodos_pago_user_nombre": "Ya tenés un método de pago con ese nombre.",
}

def _raise_amigable_integrity_error(db: Session, error: IntegrityError):
    db.rollback()
    constraint = getattr(getattr(error.orig, "diag", None), "constraint_name", None)
    mensaje = _UNIQUE_ERROR_MESSAGES.get(constraint, "Ya existe un registro con esos datos.")
    raise HTTPException(status_code=400, detail=mensaje)

app = FastAPI()

# =======================================================
# CONFIGURACIÓN CORS SEGURA
# =======================================================
origins = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =======================================================
# CONFIGURACIÓN RATE LIMITING
# =======================================================
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

limiter = Limiter(key_func=get_remote_address, default_limits=["100 per minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# =======================================================
# AUTENTICACIÓN CON CLERK
# =======================================================
import logging

logger = logging.getLogger("uvicorn.error")

CLERK_ISSUER = os.getenv("CLERK_ISSUER")
jwks_cache = TTLCache(maxsize=1, ttl=3600)

# Mensaje genérico hacia el cliente: no exponemos detalle interno (tipo de excepción,
# causa exacta) en la respuesta HTTP. El detalle real queda solo en el log del servidor.
_AUTH_ERROR = "No autorizado: token inválido o expirado"

def get_public_key(token: str):
    try:
        unverified_header = jwt.get_unverified_header(token)
        kid = unverified_header.get("kid")
        if not kid:
            return None

        if "jwks" in jwks_cache:
            jwks = jwks_cache["jwks"]
        else:
            if not CLERK_ISSUER:
                logger.error("CLERK_ISSUER no configurado en .env")
                raise HTTPException(status_code=500, detail="Error de configuración del servidor")
            resp = requests.get(f"{CLERK_ISSUER}/.well-known/jwks.json", timeout=5)
            resp.raise_for_status()
            jwks = resp.json()
            jwks_cache["jwks"] = jwks

        for key in jwks["keys"]:
            if key["kid"] == kid:
                return jwt.algorithms.RSAAlgorithm.from_jwk(key)
        return None
    except HTTPException:
        raise
    except Exception:
        logger.warning("Fallo al verificar token", exc_info=True)
        raise HTTPException(status_code=401, detail=_AUTH_ERROR)

def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No autorizado: falta el token")

    token = auth_header.split(" ")[1]
    public_key = get_public_key(token)

    if not public_key:
        raise HTTPException(status_code=401, detail=_AUTH_ERROR)

    try:
        payload = jwt.decode(
            token,
            key=public_key,
            algorithms=["RS256"],
            issuer=CLERK_ISSUER,
            options={"verify_aud": False, "verify_iss": bool(CLERK_ISSUER)}
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail=_AUTH_ERROR)
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError:
        logger.warning("Token inválido recibido", exc_info=True)
        raise HTTPException(status_code=401, detail=_AUTH_ERROR)

# =======================================================
# FUNCIONES DE FECHAS E INTERESES
# =======================================================
def add_calendar_months(dt, months_to_add):
    month = dt.month - 1 + months_to_add
    year = dt.year + month // 12
    month = month % 12 + 1
    day = min(dt.day, calendar.monthrange(year, month)[1])
    return dt.replace(year=year, month=month, day=day)

def get_fecha_limite(fecha_inicio_str, ultimo_pago_fecha_str):
    fecha_inicio = datetime.strptime(fecha_inicio_str, "%Y-%m-%d")
    ultimo_pago = datetime.strptime(ultimo_pago_fecha_str, "%Y-%m-%d")
    current_milestone = add_calendar_months(fecha_inicio, 1)
    while current_milestone <= ultimo_pago:
        current_milestone = add_calendar_months(current_milestone, 1)
    return current_milestone.strftime("%Y-%m-%d")

def calcular_intereses(capital_actual, tasa, fecha_inicio_str, ultimo_pago_fecha_str):
    hoy = datetime.now()
    fecha_base = datetime.strptime(ultimo_pago_fecha_str, "%Y-%m-%d")
    dias_transcurridos = (hoy - fecha_base).days
    interes_mensual = capital_actual * (tasa / 100)
    interes_diario = interes_mensual / 30
    
    if dias_transcurridos < 0:
        estado_interes = "al_dia"
    elif dias_transcurridos == 0:
        estado_interes = "pendiente_mes"
    else:
        ciclos_adeudados = math.ceil(dias_transcurridos / 30)
        estado_interes = "atrasado" if ciclos_adeudados >= 2 else "pendiente_mes"

    fecha_limite_dt = add_calendar_months(fecha_base, 1)
    fecha_limite = fecha_limite_dt.strftime("%Y-%m-%d")

    if dias_transcurridos <= 0:
        return {
            "dias_transcurridos": 0, "ciclos_adeudados": 0, "interes_tabla": round(interes_mensual, 2),
            "interes_proporcional": 0.0, "interes_mensual": round(interes_mensual, 2),
            "interes_diario": round(interes_diario, 4), "fecha_limite": fecha_limite, "estado_interes": estado_interes
        }

    ciclos_adeudados = max(1, math.ceil(dias_transcurridos / 30))
    interes_tabla = ciclos_adeudados * interes_mensual
    interes_proporcional = dias_transcurridos * interes_diario
    return {
        "dias_transcurridos": dias_transcurridos, "ciclos_adeudados": ciclos_adeudados,
        "interes_tabla": round(interes_tabla, 2), "interes_proporcional": round(interes_proporcional, 2),
        "interes_mensual": round(interes_mensual, 2), "interes_diario": round(interes_diario, 4),
        "fecha_limite": fecha_limite, "estado_interes": estado_interes
    }

def registrar_actividad(db: Session, user_id: str, categoria: str, accion: str, descripcion: str, monto: float = None, cliente_id: int = None):
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    nueva_actividad = models.Actividad(
        user_id=user_id, fecha_hora=now, categoria=categoria, accion=accion,
        descripcion=descripcion, monto_referencia=monto, cliente_id=cliente_id
    )
    db.add(nueva_actividad)

# =======================================================
# RUTAS RAÍZ
# =======================================================
@app.get("/")
def read_root():
    return {"message": "Backend de Préstamos funcionando!"}

# --- RUTAS DE METODOS DE PAGO ---
@app.post("/metodos-pago/", response_model=schemas.MetodoPagoResponse)
def crear_metodo_pago(metodo: schemas.MetodoPagoCreate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    db_metodo = models.MetodoPago(**metodo.dict(), user_id=user_id)
    db.add(db_metodo)
    registrar_actividad(db, user_id, "Sistema", "CREACIÓN", f"Nuevo método de pago creado: {metodo.nombre}")
    try:
        db.commit()
    except IntegrityError as e:
        _raise_amigable_integrity_error(db, e)
    db.refresh(db_metodo)
    return db_metodo

@app.get("/metodos-pago/", response_model=list[schemas.MetodoPagoResponse])
def obtener_metodos_pago(skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200), db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    metodos = db.query(models.MetodoPago).filter(models.MetodoPago.user_id == user_id).offset(skip).limit(limit).all()
    return metodos

# --- RUTAS DE CLIENTES ---
@app.post("/clientes/", response_model=schemas.ClienteResponse)
def crear_cliente(cliente: schemas.ClienteCreate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    db_cliente = models.Cliente(**cliente.dict(), user_id=user_id)
    db.add(db_cliente)
    registrar_actividad(db, user_id, "Clientes", "CREACIÓN", f"Cliente creado: {cliente.nombre}", cliente_id=db_cliente.id)
    try:
        db.commit()
    except IntegrityError as e:
        _raise_amigable_integrity_error(db, e)
    db.refresh(db_cliente)
    return db_cliente

@app.get("/clientes/", response_model=list[schemas.ClienteResponse])
def obtener_clientes(show_hidden: bool = False, skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200), db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    query = db.query(models.Cliente).filter(models.Cliente.user_id == user_id)
    if not show_hidden:
        query = query.filter(models.Cliente.activo == True)
    clientes = query.offset(skip).limit(limit).all()
    return clientes

@app.get("/clientes/{cliente_id}", response_model=schemas.ClienteResponse)
def obtener_cliente(cliente_id: int, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    cliente = db.query(models.Cliente).filter(models.Cliente.id == cliente_id, models.Cliente.user_id == user_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    return cliente

@app.put("/clientes/{cliente_id}", response_model=schemas.ClienteResponse)
def editar_cliente(cliente_id: int, cliente_update: schemas.ClienteUpdate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    cliente = db.query(models.Cliente).filter(models.Cliente.id == cliente_id, models.Cliente.user_id == user_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    
    cambios = []
    if cliente_update.cedula is not None and cliente_update.cedula != cliente.cedula:
        cambios.append(f"Cédula: {cliente.cedula} -> {cliente_update.cedula}")
        cliente.cedula = cliente_update.cedula
    if cliente_update.nombre is not None and cliente_update.nombre != cliente.nombre:
        cambios.append(f"Nombre: {cliente.nombre} -> {cliente_update.nombre}")
        cliente.nombre = cliente_update.nombre
    if cliente_update.telefono is not None and cliente_update.telefono != cliente.telefono:
        cambios.append(f"Teléfono: {cliente.telefono} -> {cliente_update.telefono}")
        cliente.telefono = cliente_update.telefono
    if cliente_update.email is not None and cliente_update.email != cliente.email:
        cambios.append(f"Email: {cliente.email} -> {cliente_update.email}")
        cliente.email = cliente_update.email
        
    if cambios:
        descripcion = f"Cliente editado: {', '.join(cambios)}"
        registrar_actividad(db, user_id, "Clientes", "ACTUALIZACIÓN", descripcion, cliente_id=cliente.id)

    try:
        db.commit()
    except IntegrityError as e:
        _raise_amigable_integrity_error(db, e)
    db.refresh(cliente)
    return cliente

@app.post("/clientes/{cliente_id}/ocultar/", response_model=schemas.ClienteResponse)
def ocultar_cliente(cliente_id: int, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    cliente = db.query(models.Cliente).filter(models.Cliente.id == cliente_id, models.Cliente.user_id == user_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
        
    prestamos_activos = db.query(models.Prestamo).filter(
        models.Prestamo.cliente_id == cliente_id, models.Prestamo.estado == "Activo", models.Prestamo.user_id == user_id
    ).first()
    if prestamos_activos:
        raise HTTPException(status_code=400, detail="No se puede ocultar: el cliente tiene préstamos activos.")
        
    cliente.activo = False
    registrar_actividad(db, user_id, "Clientes", "OCULTACIÓN", f"Cliente ocultado: {cliente.nombre}", cliente_id=cliente.id)
    db.commit()
    db.refresh(cliente)
    return cliente

@app.post("/clientes/{cliente_id}/restaurar/", response_model=schemas.ClienteResponse)
def restaurar_cliente(cliente_id: int, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    cliente = db.query(models.Cliente).filter(models.Cliente.id == cliente_id, models.Cliente.user_id == user_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
        
    cliente.activo = True
    registrar_actividad(db, user_id, "Clientes", "RESTAURACIÓN", f"Cliente restaurado: {cliente.nombre}", cliente_id=cliente.id)
    db.commit()
    db.refresh(cliente)
    return cliente

# --- RUTAS DE PRÉSTAMOS ---
@app.post("/prestamos/", response_model=schemas.PrestamoResponse)
def crear_prestamo(prestamo: schemas.PrestamoCreate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    # Verificamos que el cliente y el método de pago existan y pertenezcan a este usuario
    # ANTES de crear nada (evita asociar el préstamo a datos de otro usuario)
    cliente = db.query(models.Cliente).filter(models.Cliente.id == prestamo.cliente_id, models.Cliente.user_id == user_id).first()
    if not cliente:
        raise HTTPException(status_code=404, detail="Cliente no encontrado")
    metodo = db.query(models.MetodoPago).filter(models.MetodoPago.id == prestamo.metodo_pago_id, models.MetodoPago.user_id == user_id).first()
    if not metodo:
        raise HTTPException(status_code=404, detail="Método de pago no encontrado")

    db_prestamo = models.Prestamo(
        **prestamo.dict(), user_id=user_id, capital_actual=prestamo.monto, ultimo_pago_fecha=prestamo.fecha_inicio
    )
    db.add(db_prestamo)
    descripcion = f"Préstamo creado: ${prestamo.monto} a {cliente.nombre} (Tasa: {prestamo.tasa_interes}%, Método: {metodo.nombre})"

    registrar_actividad(db, user_id, "Préstamos", "CREACIÓN", descripcion, monto=prestamo.monto, cliente_id=prestamo.cliente_id)
    db.commit()
    db.refresh(db_prestamo)
    return db_prestamo

@app.get("/prestamos/", response_model=list[schemas.PrestamoDetalleResponse])
def obtener_todos_prestamos(skip: int = Query(0, ge=0), limit: int = Query(100, ge=1, le=200), cliente_id: int = None, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    query = db.query(models.Prestamo).filter(models.Prestamo.user_id == user_id)
    if cliente_id:
        query = query.filter(models.Prestamo.cliente_id == cliente_id)

    prestamos = query.offset(skip).limit(limit).all()

    # Traemos clientes y métodos de pago involucrados en una sola query cada uno (evita N+1)
    cliente_ids = {p.cliente_id for p in prestamos}
    metodo_ids = {p.metodo_pago_id for p in prestamos}
    clientes_map = {c.id: c for c in db.query(models.Cliente).filter(
        models.Cliente.id.in_(cliente_ids), models.Cliente.user_id == user_id
    ).all()} if cliente_ids else {}
    metodos_map = {m.id: m for m in db.query(models.MetodoPago).filter(
        models.MetodoPago.id.in_(metodo_ids), models.MetodoPago.user_id == user_id
    ).all()} if metodo_ids else {}

    resultados = []
    for prestamo in prestamos:
        cliente = clientes_map.get(prestamo.cliente_id)
        metodo = metodos_map.get(prestamo.metodo_pago_id)
        calc = calcular_intereses(prestamo.capital_actual, prestamo.tasa_interes, prestamo.fecha_inicio, prestamo.ultimo_pago_fecha)

        prestamo_dict = {
            "id": prestamo.id, "cliente_id": prestamo.cliente_id, "monto": prestamo.monto,
            "capital_actual": prestamo.capital_actual, "tasa_interes": prestamo.tasa_interes,
            "fecha_inicio": prestamo.fecha_inicio, "ultimo_pago_fecha": prestamo.ultimo_pago_fecha,
            "pago_proporcional": prestamo.pago_proporcional, "metodo_pago_id": prestamo.metodo_pago_id,
            "estado": prestamo.estado, "cliente_nombre": cliente.nombre if cliente else "Desconocido",
            "intereses_pendientes": calc["interes_tabla"], "total_a_pagar_hoy": prestamo.capital_actual + calc["interes_tabla"],
            "dias_transcurridos": calc["dias_transcurridos"], "fecha_limite": calc["fecha_limite"],
            "estado_interes": calc["estado_interes"], "metodo_pago_nombre": metodo.nombre if metodo else "N/A"
        }
        resultados.append(prestamo_dict)
    return resultados

@app.get("/prestamos/{prestamo_id}/saldo/")
def calcular_saldo(prestamo_id: int, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    prestamo = db.query(models.Prestamo).filter(models.Prestamo.id == prestamo_id, models.Prestamo.user_id == user_id).first()
    if not prestamo:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    
    calc = calcular_intereses(prestamo.capital_actual, prestamo.tasa_interes, prestamo.fecha_inicio, prestamo.ultimo_pago_fecha)
    return {
        "prestamo_id": prestamo.id, "capital_actual": prestamo.capital_actual,
        "tasa_interes": f"{prestamo.tasa_interes}%", "interes_mes_completo": calc["interes_tabla"],
        "interes_proporcional": calc["interes_proporcional"], "pago_minimo": calc["interes_mensual"],
        "dias_transcurridos": calc["dias_transcurridos"], "fecha_limite": calc["fecha_limite"],
        "pago_proporcional": prestamo.pago_proporcional, "estado": prestamo.estado
    }

# --- RUTAS DE PAGOS ---
@app.post("/pagos/", response_model=schemas.PagoResponse)
def crear_pago(pago: schemas.PagoCreate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    prestamo = db.query(models.Prestamo).filter(models.Prestamo.id == pago.prestamo_id, models.Prestamo.user_id == user_id).first()
    if not prestamo or prestamo.estado == "Pagado":
        raise HTTPException(status_code=400, detail="Préstamo no encontrado o ya pagado")

    # Verificamos que el método de pago pertenezca a este usuario antes de registrar nada
    metodo = db.query(models.MetodoPago).filter(models.MetodoPago.id == pago.metodo_pago_id, models.MetodoPago.user_id == user_id).first()
    if not metodo:
        raise HTTPException(status_code=404, detail="Método de pago no encontrado")

    calc = calcular_intereses(prestamo.capital_actual, prestamo.tasa_interes, prestamo.fecha_inicio, prestamo.ultimo_pago_fecha)
    hoy = datetime.now()
    fecha_base_dt = datetime.strptime(prestamo.ultimo_pago_fecha, "%Y-%m-%d")
    estamos_en_periodo_prepagado = fecha_base_dt > hoy
    
    # El interés siempre tiene prioridad: hasta no cubrirlo, nada del pago toca el capital
    interes_pagado = 0.0
    capital_pagado = 0.0

    if estamos_en_periodo_prepagado:
        minimo_a_pagar = 1.00
        if pago.monto < minimo_a_pagar:
            raise HTTPException(status_code=400, detail="El monto mínimo es $1.00")
        nuevo_capital = prestamo.capital_actual - pago.monto
        nueva_fecha_base_dt = fecha_base_dt
        capital_pagado = pago.monto
    else:
        # Evaluamos el check que viene desde el frontend
        if pago.pago_proporcional:
            minimo_a_pagar = calc["interes_proporcional"] if calc["dias_transcurridos"] > 0 else calc["interes_diario"]
            minimo_a_pagar = round(minimo_a_pagar, 2)
            if pago.monto < minimo_a_pagar:
                raise HTTPException(status_code=400, detail=f"El monto no cubre el mínimo proporcional (${round(minimo_a_pagar, 2)}).")

            dias_pagados = pago.monto / calc["interes_diario"]
            if calc["dias_transcurridos"] == 0 and pago.monto <= calc["interes_diario"]:
                nuevo_capital = prestamo.capital_actual
                nueva_fecha_base_dt = fecha_base_dt + timedelta(days=1)
                interes_pagado = pago.monto
            elif dias_pagados <= calc["dias_transcurridos"]:
                nuevo_capital = prestamo.capital_actual
                nueva_fecha_base_dt = fecha_base_dt + timedelta(days=round(dias_pagados))
                interes_pagado = pago.monto
            else:
                excedente = pago.monto - calc["interes_proporcional"]
                nuevo_capital = prestamo.capital_actual - excedente
                nueva_fecha_base_dt = datetime.strptime(pago.fecha, "%Y-%m-%d") + timedelta(days=round(dias_pagados))
                interes_pagado = calc["interes_proporcional"]
                capital_pagado = excedente
        else:
            minimo_a_pagar = round(calc["interes_mensual"], 2)
            if pago.monto < minimo_a_pagar:
                raise HTTPException(status_code=400, detail=f"El monto no cubre el mínimo requerido (${round(minimo_a_pagar, 2)}).")
            dias_pagados = pago.monto / calc["interes_diario"]
            if pago.monto <= calc["interes_tabla"]:
                nuevo_capital = prestamo.capital_actual
                nueva_fecha_base_dt = datetime.strptime(pago.fecha, "%Y-%m-%d") + timedelta(days=round(dias_pagados))
                interes_pagado = pago.monto
            else:
                excedente = pago.monto - calc["interes_tabla"]
                nuevo_capital = prestamo.capital_actual - excedente
                nueva_fecha_base_dt = datetime.strptime(pago.fecha, "%Y-%m-%d") + timedelta(days=round(dias_pagados))
                interes_pagado = calc["interes_tabla"]
                capital_pagado = excedente

    prestamo.capital_actual = round(nuevo_capital, 2)
    prestamo.ultimo_pago_fecha = nueva_fecha_base_dt.strftime("%Y-%m-%d")

    if nuevo_capital <= 0:
        prestamo.capital_actual = 0
        prestamo.estado = "Pagado"

    interes_pagado = round(interes_pagado, 2)
    capital_pagado = round(capital_pagado, 2)

    pago_data_dict = pago.dict(exclude={'pago_proporcional'})
    db_pago = models.Pago(
        **pago_data_dict, user_id=user_id,
        interes_pagado=interes_pagado, capital_pagado=capital_pagado
    )
    db.add(db_pago)

    cliente = db.query(models.Cliente).filter(models.Cliente.id == prestamo.cliente_id, models.Cliente.user_id == user_id).first()
    descripcion = (
        f"Pago registrado: ${pago.monto} de {cliente.nombre if cliente else 'Desconocido'} "
        f"(Interés: ${interes_pagado:.2f} | Capital: ${capital_pagado:.2f}) "
        f"(Método: {metodo.nombre})"
    )
    
    registrar_actividad(db, user_id, "Pagos", "PAGO_REGISTRADO", descripcion, monto=pago.monto, cliente_id=prestamo.cliente_id)
    db.commit()
    db.refresh(prestamo)
    db.refresh(db_pago)
    return db_pago

# --- DASHBOARD ---
@app.get("/dashboard/")
def get_dashboard_stats(db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    total_clientes = db.query(models.Cliente).filter(models.Cliente.activo == True, models.Cliente.user_id == user_id).count()
    prestamos_activos = db.query(models.Prestamo).filter(models.Prestamo.estado == "Activo", models.Prestamo.user_id == user_id).all()
    
    monto_prestado = sum(p.monto for p in prestamos_activos)
    capital_vivo = sum(p.capital_actual for p in prestamos_activos)
    ganancias_intereses = sum(p.capital_actual * (p.tasa_interes / 100) for p in prestamos_activos)
    
    pagos = db.query(models.Pago).filter(models.Pago.user_id == user_id).all()
    monto_cobrado = sum(p.monto for p in pagos)
    
    return {
        "total_clientes": total_clientes, "prestamos_activos": len(prestamos_activos),
        "monto_prestado": monto_prestado, "monto_cobrado": monto_cobrado,
        "ganancias_intereses": ganancias_intereses, "capital_vivo": capital_vivo
    }

@app.get("/dashboard/resumen/", response_model=list[schemas.ResumenPrestamoResponse])
def get_resumen_financiero(db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    prestamos = db.query(models.Prestamo).filter(models.Prestamo.user_id == user_id).all()

    # Agregamos los pagos por préstamo en una sola pasada (evita N+1 queries)
    agregados = db.query(
        models.Pago.prestamo_id,
        func.sum(models.Pago.monto).label("total_pagado"),
        func.sum(models.Pago.interes_pagado).label("total_interes"),
        func.sum(models.Pago.capital_pagado).label("total_capital"),
    ).filter(models.Pago.user_id == user_id).group_by(models.Pago.prestamo_id).all()
    agregados_por_prestamo = {a.prestamo_id: a for a in agregados}

    cliente_ids = {p.cliente_id for p in prestamos}
    clientes_map = {c.id: c for c in db.query(models.Cliente).filter(
        models.Cliente.id.in_(cliente_ids), models.Cliente.user_id == user_id
    ).all()} if cliente_ids else {}

    resultados = []
    for prestamo in prestamos:
        cliente = clientes_map.get(prestamo.cliente_id)
        agg = agregados_por_prestamo.get(prestamo.id)
        resultados.append({
            "id": prestamo.id,
            "cliente_nombre": cliente.nombre if cliente else "Desconocido",
            "monto": prestamo.monto,
            "tasa_interes": prestamo.tasa_interes,
            "ganancia_minima": round(prestamo.monto * (prestamo.tasa_interes / 100), 2),
            "capital_actual": prestamo.capital_actual,
            "total_pagado": round(agg.total_pagado, 2) if agg else 0.0,
            "total_interes_cobrado": round(agg.total_interes, 2) if agg else 0.0,
            "total_capital_cobrado": round(agg.total_capital, 2) if agg else 0.0,
            "estado": prestamo.estado,
        })
    return resultados

@app.get("/dashboard/reporte-mensual/")
def get_reporte_mensual(anio: int, cliente: str = None, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    anio_str = f"{anio:04d}"

    # Préstamos otorgados por mes (según fecha_inicio)
    q_prestamos = db.query(
        func.substr(models.Prestamo.fecha_inicio, 6, 2).label("mes"),
        func.count(models.Prestamo.id).label("cantidad"),
        func.sum(models.Prestamo.monto).label("monto_prestado"),
    ).join(models.Cliente, models.Cliente.id == models.Prestamo.cliente_id).filter(
        models.Prestamo.user_id == user_id, models.Prestamo.fecha_inicio.like(f"{anio_str}-%")
    )
    if cliente:
        q_prestamos = q_prestamos.filter(models.Cliente.nombre.ilike(f"%{cliente}%"))
    prestamos_por_mes = {int(r.mes): r for r in q_prestamos.group_by("mes").all()}

    # Pagos recibidos por mes (según fecha del pago)
    q_pagos = db.query(
        func.substr(models.Pago.fecha, 6, 2).label("mes"),
        func.count(models.Pago.id).label("cantidad"),
        func.sum(models.Pago.monto).label("total_cobrado"),
        func.sum(models.Pago.interes_pagado).label("interes_cobrado"),
        func.sum(models.Pago.capital_pagado).label("capital_cobrado"),
    ).join(models.Prestamo, models.Prestamo.id == models.Pago.prestamo_id).join(
        models.Cliente, models.Cliente.id == models.Prestamo.cliente_id
    ).filter(models.Pago.user_id == user_id, models.Pago.fecha.like(f"{anio_str}-%"))
    if cliente:
        q_pagos = q_pagos.filter(models.Cliente.nombre.ilike(f"%{cliente}%"))
    pagos_por_mes = {int(r.mes): r for r in q_pagos.group_by("mes").all()}

    resultados = []
    for mes in range(1, 13):
        p = prestamos_por_mes.get(mes)
        pg = pagos_por_mes.get(mes)
        resultados.append({
            "mes": mes,
            "prestamos_nuevos": p.cantidad if p else 0,
            "monto_prestado": round(p.monto_prestado, 2) if p and p.monto_prestado else 0.0,
            "pagos_recibidos": pg.cantidad if pg else 0,
            "total_cobrado": round(pg.total_cobrado, 2) if pg and pg.total_cobrado else 0.0,
            "interes_cobrado": round(pg.interes_cobrado, 2) if pg and pg.interes_cobrado else 0.0,
            "capital_cobrado": round(pg.capital_cobrado, 2) if pg and pg.capital_cobrado else 0.0,
        })
    return resultados

@app.get("/dashboard/detalle-mes/")
def get_detalle_mes(anio: int, mes: int, cliente: str = None, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    prefijo = f"{anio:04d}-{mes:02d}"

    q_prestamos = db.query(models.Prestamo).join(
        models.Cliente, models.Cliente.id == models.Prestamo.cliente_id
    ).filter(models.Prestamo.user_id == user_id, models.Prestamo.fecha_inicio.like(f"{prefijo}%"))
    if cliente:
        q_prestamos = q_prestamos.filter(models.Cliente.nombre.ilike(f"%{cliente}%"))

    prestamos_del_mes = q_prestamos.order_by(models.Prestamo.fecha_inicio).all()
    cliente_ids = {p.cliente_id for p in prestamos_del_mes}
    clientes_map = {c.id: c for c in db.query(models.Cliente).filter(
        models.Cliente.id.in_(cliente_ids), models.Cliente.user_id == user_id
    ).all()} if cliente_ids else {}

    prestamos_out = [{
        "id": p.id, "fecha": p.fecha_inicio, "cliente_nombre": clientes_map.get(p.cliente_id).nombre if clientes_map.get(p.cliente_id) else "Desconocido",
        "monto": p.monto, "tasa_interes": p.tasa_interes,
        "ganancia_minima": round(p.monto * (p.tasa_interes / 100), 2),
    } for p in prestamos_del_mes]

    q_pagos = db.query(models.Pago).join(
        models.Prestamo, models.Prestamo.id == models.Pago.prestamo_id
    ).join(models.Cliente, models.Cliente.id == models.Prestamo.cliente_id).filter(
        models.Pago.user_id == user_id, models.Pago.fecha.like(f"{prefijo}%")
    )
    if cliente:
        q_pagos = q_pagos.filter(models.Cliente.nombre.ilike(f"%{cliente}%"))

    pagos_del_mes = q_pagos.order_by(models.Pago.fecha).all()
    prestamo_ids = {pg.prestamo_id for pg in pagos_del_mes}
    prestamos_map = {p.id: p for p in db.query(models.Prestamo).filter(
        models.Prestamo.id.in_(prestamo_ids), models.Prestamo.user_id == user_id
    ).all()} if prestamo_ids else {}
    cliente_ids_pagos = {p.cliente_id for p in prestamos_map.values()}
    clientes_map_pagos = {c.id: c for c in db.query(models.Cliente).filter(
        models.Cliente.id.in_(cliente_ids_pagos), models.Cliente.user_id == user_id
    ).all()} if cliente_ids_pagos else {}

    pagos_out = []
    for pg in pagos_del_mes:
        prestamo = prestamos_map.get(pg.prestamo_id)
        cli = clientes_map_pagos.get(prestamo.cliente_id) if prestamo else None
        pagos_out.append({
            "id": pg.id, "fecha": pg.fecha, "prestamo_id": pg.prestamo_id,
            "cliente_nombre": cli.nombre if cli else "Desconocido",
            "monto": pg.monto, "interes_pagado": pg.interes_pagado, "capital_pagado": pg.capital_pagado,
        })

    return {"prestamos": prestamos_out, "pagos": pagos_out}

# --- RUTA DE ACTIVIDAD / AUDITORÍA ---
@app.get("/actividades/", response_model=list[schemas.ActividadResponse])
def obtener_actividades(skip: int = Query(0, ge=0), limit: int = Query(50, ge=1, le=200), categoria: str = None, accion: str = None, cliente_id: int = None, fecha_desde: str = None, fecha_hasta: str = None, search: str = None, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    query = db.query(models.Actividad).filter(models.Actividad.user_id == user_id)
    
    if categoria: query = query.filter(models.Actividad.categoria == categoria)
    if accion: query = query.filter(models.Actividad.accion == accion)
    if cliente_id: query = query.filter(models.Actividad.cliente_id == cliente_id)
    if fecha_desde: query = query.filter(models.Actividad.fecha_hora >= f"{fecha_desde} 00:00:00")
    if fecha_hasta: query = query.filter(models.Actividad.fecha_hora <= f"{fecha_hasta} 23:59:59")
    if search: query = query.filter(models.Actividad.descripcion.contains(search))
        
    actividades = query.order_by(models.Actividad.fecha_hora.desc()).offset(skip).limit(limit).all()
    return actividades