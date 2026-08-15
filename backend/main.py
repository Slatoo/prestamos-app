from fastapi import FastAPI, Depends, HTTPException, Request
import os
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
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

# Migración ligera: agrega columnas nuevas a tablas ya existentes
# (Base.metadata.create_all no altera tablas que ya existen)
with engine.connect() as conn:
    conn.execute(text("ALTER TABLE pagos ADD COLUMN IF NOT EXISTS interes_pagado FLOAT DEFAULT 0"))
    conn.execute(text("ALTER TABLE pagos ADD COLUMN IF NOT EXISTS capital_pagado FLOAT DEFAULT 0"))
    conn.commit()

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
CLERK_ISSUER = os.getenv("CLERK_ISSUER")
jwks_cache = TTLCache(maxsize=1, ttl=3600)

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
                raise HTTPException(status_code=500, detail="CLERK_ISSUER no configurado en .env")
            resp = requests.get(f"{CLERK_ISSUER}/.well-known/jwks.json")
            resp.raise_for_status()
            jwks = resp.json()
            jwks_cache["jwks"] = jwks

        for key in jwks["keys"]:
            if key["kid"] == kid:
                return jwt.algorithms.RSAAlgorithm.from_jwk(key)
        return None
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Error verificando token: {str(e)}")

def get_current_user(request: Request):
    auth_header = request.headers.get("Authorization")
    if not auth_header or not auth_header.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="No autorizado: Falta el token")

    token = auth_header.split(" ")[1]
    public_key = get_public_key(token)

    if not public_key:
        raise HTTPException(status_code=401, detail="No autorizado: Llave pública no encontrada")

    try:
        payload = jwt.decode(
            token,
            key=public_key,
            algorithms=["RS256"],
            options={"verify_aud": False, "verify_iss": False}
        )
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="No autorizado: Usuario no encontrado en token")
        return user_id
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expirado")
    except jwt.InvalidTokenError as e:
        raise HTTPException(status_code=401, detail=f"Token inválido: {str(e)}")

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
    db.commit()
    db.refresh(db_metodo)
    return db_metodo

@app.get("/metodos-pago/", response_model=list[schemas.MetodoPagoResponse])
def obtener_metodos_pago(skip: int = 0, limit: int = 100, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    metodos = db.query(models.MetodoPago).filter(models.MetodoPago.user_id == user_id).offset(skip).limit(limit).all()
    return metodos

# --- RUTAS DE CLIENTES ---
@app.post("/clientes/", response_model=schemas.ClienteResponse)
def crear_cliente(cliente: schemas.ClienteCreate, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    db_cliente = models.Cliente(**cliente.dict(), user_id=user_id)
    db.add(db_cliente)
    registrar_actividad(db, user_id, "Clientes", "CREACIÓN", f"Cliente creado: {cliente.nombre}", cliente_id=db_cliente.id)
    db.commit()
    db.refresh(db_cliente)
    return db_cliente

@app.get("/clientes/", response_model=list[schemas.ClienteResponse])
def obtener_clientes(show_hidden: bool = False, skip: int = 0, limit: int = 100, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
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

    db.commit()
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
    db_prestamo = models.Prestamo(
        **prestamo.dict(), user_id=user_id, capital_actual=prestamo.monto, ultimo_pago_fecha=prestamo.fecha_inicio
    )
    db.add(db_prestamo)
    cliente = db.query(models.Cliente).filter(models.Cliente.id == prestamo.cliente_id, models.Cliente.user_id == user_id).first()
    metodo = db.query(models.MetodoPago).filter(models.MetodoPago.id == prestamo.metodo_pago_id, models.MetodoPago.user_id == user_id).first()
    descripcion = f"Préstamo creado: ${prestamo.monto} a {cliente.nombre if cliente else 'Desconocido'} (Tasa: {prestamo.tasa_interes}%, Método: {metodo.nombre if metodo else 'N/A'})"

    registrar_actividad(db, user_id, "Préstamos", "CREACIÓN", descripcion, monto=prestamo.monto, cliente_id=prestamo.cliente_id)
    db.commit()
    db.refresh(db_prestamo)
    return db_prestamo

@app.get("/prestamos/", response_model=list[schemas.PrestamoDetalleResponse])
def obtener_todos_prestamos(skip: int = 0, limit: int = 100, cliente_id: int = None, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    query = db.query(models.Prestamo).filter(models.Prestamo.user_id == user_id)
    if cliente_id:
        query = query.filter(models.Prestamo.cliente_id == cliente_id)

    prestamos = query.offset(skip).limit(limit).all()
    resultados = []
    for prestamo in prestamos:
        cliente = db.query(models.Cliente).filter(models.Cliente.id == prestamo.cliente_id).first()
        metodo = db.query(models.MetodoPago).filter(models.MetodoPago.id == prestamo.metodo_pago_id).first()
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

    cliente = db.query(models.Cliente).filter(models.Cliente.id == prestamo.cliente_id).first()
    metodo = db.query(models.MetodoPago).filter(models.MetodoPago.id == pago.metodo_pago_id).first()
    descripcion = (
        f"Pago registrado: ${pago.monto} de {cliente.nombre if cliente else 'Desconocido'} "
        f"(Interés: ${interes_pagado:.2f} | Capital: ${capital_pagado:.2f}) "
        f"(Método: {metodo.nombre if metodo else 'N/A'})"
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

    resultados = []
    for prestamo in prestamos:
        cliente = db.query(models.Cliente).filter(models.Cliente.id == prestamo.cliente_id).first()
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

    prestamos_out = []
    for p in q_prestamos.order_by(models.Prestamo.fecha_inicio).all():
        cli = db.query(models.Cliente).filter(models.Cliente.id == p.cliente_id).first()
        prestamos_out.append({
            "id": p.id, "fecha": p.fecha_inicio, "cliente_nombre": cli.nombre if cli else "Desconocido",
            "monto": p.monto, "tasa_interes": p.tasa_interes,
            "ganancia_minima": round(p.monto * (p.tasa_interes / 100), 2),
        })

    q_pagos = db.query(models.Pago).join(
        models.Prestamo, models.Prestamo.id == models.Pago.prestamo_id
    ).join(models.Cliente, models.Cliente.id == models.Prestamo.cliente_id).filter(
        models.Pago.user_id == user_id, models.Pago.fecha.like(f"{prefijo}%")
    )
    if cliente:
        q_pagos = q_pagos.filter(models.Cliente.nombre.ilike(f"%{cliente}%"))

    pagos_out = []
    for pg in q_pagos.order_by(models.Pago.fecha).all():
        prestamo = db.query(models.Prestamo).filter(models.Prestamo.id == pg.prestamo_id).first()
        cli = db.query(models.Cliente).filter(models.Cliente.id == prestamo.cliente_id).first() if prestamo else None
        pagos_out.append({
            "id": pg.id, "fecha": pg.fecha, "prestamo_id": pg.prestamo_id,
            "cliente_nombre": cli.nombre if cli else "Desconocido",
            "monto": pg.monto, "interes_pagado": pg.interes_pagado, "capital_pagado": pg.capital_pagado,
        })

    return {"prestamos": prestamos_out, "pagos": pagos_out}

# --- RUTA DE ACTIVIDAD / AUDITORÍA ---
@app.get("/actividades/", response_model=list[schemas.ActividadResponse])
def obtener_actividades(skip: int = 0, limit: int = 50, categoria: str = None, accion: str = None, cliente_id: int = None, fecha_desde: str = None, fecha_hasta: str = None, search: str = None, db: Session = Depends(get_db), user_id: str = Depends(get_current_user)):
    query = db.query(models.Actividad).filter(models.Actividad.user_id == user_id)

    if categoria: query = query.filter(models.Actividad.categoria == categoria)
    if accion: query = query.filter(models.Actividad.accion == accion)
    if cliente_id: query = query.filter(models.Actividad.cliente_id == cliente_id)
    if fecha_desde: query = query.filter(models.Actividad.fecha_hora >= f"{fecha_desde} 00:00:00")
    if fecha_hasta: query = query.filter(models.Actividad.fecha_hora <= f"{fecha_hasta} 23:59:59")
    if search: query = query.filter(models.Actividad.descripcion.contains(search))

    actividades = query.order_by(models.Actividad.fecha_hora.desc()).offset(skip).limit(limit).all()
    return actividades
