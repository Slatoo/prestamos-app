from sqlalchemy import Column, Integer, String, Float, ForeignKey, Boolean
from sqlalchemy.orm import relationship
from database import Base

class MetodoPago(Base):
    __tablename__ = "metodos_pago"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(String, index=True)
    nombre = Column(String, index=True)

class Cliente(Base):
    __tablename__ = "clientes"
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