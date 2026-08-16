from sqlalchemy import Column, Integer, String, Float, ForeignKey, Boolean, UniqueConstraint
from sqlalchemy.orm import relationship
from database import Base

class MetodoPago(Base):
    __tablename__ = "metodos_pago"
    __table_args__ = (
        # El nombre del método de pago debe ser único por usuario, no globalmente
        # (dos usuarios distintos pueden tener cada uno un método "Efectivo").
        UniqueConstraint("user_id", "nombre", name="uq_metodos_pago_user_nombre"),
    )
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)
    nombre = Column(String, index=True)

class Cliente(Base):
    __tablename__ = "clientes"
    __table_args__ = (
        # Cédula/email deben ser únicos por usuario, no globalmente
        # (dos usuarios distintos pueden tener cada uno un cliente con la misma cédula).
        UniqueConstraint("user_id", "cedula", name="uq_clientes_user_cedula"),
        UniqueConstraint("user_id", "email", name="uq_clientes_user_email"),
    )
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)
    cedula = Column(String, index=True)
    nombre = Column(String, index=True)
    telefono = Column(String)
    email = Column(String, index=True)
    activo = Column(Boolean, default=True)
    prestamos = relationship("Prestamo", back_populates="cliente")

class Prestamo(Base):
    __tablename__ = "prestamos"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"))
    monto = Column(Float)
    capital_actual = Column(Float)
    tasa_interes = Column(Float)
    fecha_inicio = Column(String)
    ultimo_pago_fecha = Column(String)
    pago_proporcional = Column(Boolean, default=True) # Por defecto en BD también
    metodo_pago_id = Column(Integer, ForeignKey("metodos_pago.id"))
    estado = Column(String, default="Activo")
    
    cliente = relationship("Cliente", back_populates="prestamos")
    pagos = relationship("Pago", back_populates="prestamo")
    metodo_pago = relationship("MetodoPago")

class Pago(Base):
    __tablename__ = "pagos"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)
    prestamo_id = Column(Integer, ForeignKey("prestamos.id"))
    monto = Column(Float)
    fecha = Column(String)
    metodo_pago_id = Column(Integer, ForeignKey("metodos_pago.id"))
    # Desglose del pago: interés siempre tiene prioridad sobre capital
    interes_pagado = Column(Float, default=0.0)
    capital_pagado = Column(Float, default=0.0)
    
    prestamo = relationship("Prestamo", back_populates="pagos")
    metodo_pago = relationship("MetodoPago")

class Actividad(Base):
    __tablename__ = "actividades"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)
    fecha_hora = Column(String)
    categoria = Column(String)
    accion = Column(String)
    descripcion = Column(String)
    monto_referencia = Column(Float, nullable=True)
    cliente_id = Column(Integer, ForeignKey("clientes.id"), nullable=True)