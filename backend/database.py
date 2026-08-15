import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from dotenv import load_dotenv

# 1. Cargar las variables de entorno desde el archivo .env
load_dotenv()

# 2. Obtener la URL de la base de datos desde el .env
SQLALCHEMY_DATABASE_URL = os.getenv("DATABASE_URL")

# Verificar que la URL exista (para evitar errores silenciosos)
if not SQLALCHEMY_DATABASE_URL:
    raise ValueError("DATABASE_URL no encontrada. Revisa tu archivo .env")

# 3. Crear el motor de la base de datos
# (Quitamos connect_args porque solo se usan para SQLite, no para PostgreSQL)
# pool_pre_ping: verifica la conexión antes de usarla (Supabase/pgbouncer cierran
#   conexiones idle del lado del servidor, y sin esto se ven errores intermitentes
#   tipo "server closed the connection unexpectedly").
# pool_recycle: recicla conexiones cada 30 min para evitar que el pooler las mate primero.
engine = create_engine(SQLALCHEMY_DATABASE_URL, pool_pre_ping=True, pool_recycle=1800)

# 4. Crear la sesión y la clase Base
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# 5. Dependency: Nos da una sesión de la BD por cada petición
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()