import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Optional, List, Any
from contextlib import asynccontextmanager

from fastapi import FastAPI, APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import create_engine, Column, String, Text, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker, Session

import socket

# Configuración de Base de Datos (PostgreSQL / SQLite fallback)
DB_USER = os.getenv("DB_USER", "postgres")
DB_PASSWORD = os.getenv("DB_PASSWORD", "postgres")
DB_HOST = os.getenv("DB_HOST", "db-relacional")
DB_PORT = os.getenv("DB_PORT", "5432")
DB_NAME = os.getenv("DB_NAME", "citas_db")

def is_db_reachable(host: str, port: int, timeout: float = 0.6) -> bool:
    try:
        with socket.create_connection((host, int(port)), timeout=timeout):
            return True
    except OSError:
        return False

# Determinar URL de base de datos
EXPLICIT_DATABASE_URL = os.getenv("DATABASE_URL")

if EXPLICIT_DATABASE_URL:
    DATABASE_URL = EXPLICIT_DATABASE_URL
    if DATABASE_URL.startswith("postgresql://"):
        DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg2://", 1)
else:
    if is_db_reachable(DB_HOST, int(DB_PORT)):
        DATABASE_URL = f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@{DB_HOST}:{DB_PORT}/{DB_NAME}"
        print(f"[Modulo B] Conectando a PostgreSQL en {DB_HOST}:{DB_PORT}")
    elif is_db_reachable("localhost", int(DB_PORT)):
        DATABASE_URL = f"postgresql+psycopg2://{DB_USER}:{DB_PASSWORD}@localhost:{DB_PORT}/{DB_NAME}"
        print(f"[Modulo B] Conectando a PostgreSQL local en localhost:{DB_PORT}")
    else:
        DATABASE_URL = "sqlite:///./citas_local.db"
        print("[Modulo B] PostgreSQL no detectado. Utilizando SQLite local (citas_local.db) para desarrollo.")

engine_kwargs = {}
if DATABASE_URL.startswith("sqlite"):
    engine_kwargs["connect_args"] = {"check_same_thread": False}
else:
    engine_kwargs["pool_pre_ping"] = True

engine = create_engine(DATABASE_URL, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


# Modelo Entidad Relacional (SQLAlchemy)
class CitaModel(Base):
    __tablename__ = "citas"

    cita_id = Column(String(50), primary_key=True, index=True)
    paciente_id = Column(String(50), nullable=False, index=True)
    medico_id = Column(String(50), nullable=False, index=True)
    fecha_hora = Column(String(50), nullable=False)
    motivo = Column(Text, nullable=False)
    estado = Column(String(50), nullable=False, default="PENDIENTE")
    observacion = Column(Text, nullable=True)
    creado_en = Column(String(50), nullable=False)
    actualizado_en = Column(String(50), nullable=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db(retries: int = 5, delay: int = 2):
    """Inicializa las tablas con reintentos para soportar el arranque de contenedores Docker."""
    for attempt in range(1, retries + 1):
        try:
            Base.metadata.create_all(bind=engine)
            print(f"[Modulo B] Conexión a la base de datos exitosa (intento {attempt}/{retries}).")
            return
        except Exception as e:
            print(f"[Modulo B] Esperando base de datos ({attempt}/{retries}): {e}")
            if attempt < retries:
                time.sleep(delay)
            else:
                print("[Modulo B] Advertencia: No se pudo conectar a PostgreSQL en el arranque inicial.")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


# FastAPI App y Manejadores de Excepciones Personalizados
app = FastAPI(
    title="Módulo B - Servicio de Dominio y Lógica de Negocio",
    description="Microservicio en Python + FastAPI para la gestión de citas médicas sobre PostgreSQL",
    version="1.0.0",
    lifespan=lifespan,
)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    detalles = []
    for error in exc.errors():
        # Obtener el nombre del campo del loc
        campo = str(error.get("loc", ["campo"])[-1])
        mensaje = error.get("msg", "Error de validación")
        # Limpieza de mensaje si viene con prefijo Value error
        if mensaje.startswith("Value error, "):
            mensaje = mensaje.replace("Value error, ", "")
        detalles.append({
            "campo": campo,
            "mensaje": mensaje
        })

    return JSONResponse(
        status_code=status.HTTP_400_BAD_REQUEST,
        content={
            "status": "ERROR",
            "codigo": 400,
            "mensaje": "Error de validación en los datos de la solicitud",
            "detalles": detalles
        }
    )


# Esquemas Pydantic
def format_utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class CitaCreateRequest(BaseModel):
    paciente_id: str = Field(..., description="Identificador del paciente (ej: PAC-4412)")
    medico_id: str = Field(..., description="Identificador del médico (ej: MED-008)")
    fecha_hora: str = Field(..., description="Fecha y hora de la cita")
    motivo: str = Field(..., description="Motivo de la consulta médica")


class CitaCambioEstadoRequest(BaseModel):
    nuevo_estado: str = Field(..., description="Nuevo estado para la cita médica (ej: CONFIRMADA)")
    observacion: Optional[str] = Field(None, description="Observaciones del cambio de estado")


# Lógica de Negocio y Endpoints
router = APIRouter()



# Endpoint 1: Crear una Cita Médica (POST /citas o /api/citas)
@router.post("", status_code=status.HTTP_201_CREATED)
def crear_cita(payload: CitaCreateRequest, db: Session = Depends(get_db)):
    # Generar identificador de cita con formato cita_<8_hex>
    cita_id = f"cita_{uuid.uuid4().hex[:8]}"
    ahora_iso = format_utc_now()
    estado_inicial = "PENDIENTE"

    nueva_cita = CitaModel(
        cita_id=cita_id,
        paciente_id=payload.paciente_id,
        medico_id=payload.medico_id,
        fecha_hora=payload.fecha_hora,
        motivo=payload.motivo,
        estado=estado_inicial,
        observacion=None,
        creado_en=ahora_iso,
        actualizado_en=ahora_iso,
    )

    db.add(nueva_cita)
    db.commit()
    db.refresh(nueva_cita)

    return {
        "status": "SUCCESS",
        "codigo": 201,
        "mensaje": "Cita médica creada exitosamente",
        "data": {
            "cita_id": nueva_cita.cita_id,
            "estado": nueva_cita.estado,
            "creado_en": nueva_cita.creado_en
        }
    }


# ----------------------------------------------------------
# Endpoint 2: Cambiar el Estado de una Cita (PATCH /citas/{id}/estado)
# ----------------------------------------------------------
@router.patch("/{id}/estado", status_code=status.HTTP_200_OK)
def cambiar_estado_cita(id: str, payload: CitaCambioEstadoRequest, db: Session = Depends(get_db)):
    cita = db.query(CitaModel).filter(CitaModel.cita_id == id).first()

    if not cita:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "status": "ERROR",
                "codigo": 404,
                "mensaje": "Cita médica no encontrada",
                "detalles": [
                    {
                        "campo": "id",
                        "mensaje": "No existe una cita médica registrada con el identificador proporcionado."
                    }
                ]
            }
        )

    estado_anterior = cita.estado
    estado_actual = payload.nuevo_estado
    ahora_iso = format_utc_now()

    cita.estado = estado_actual
    cita.actualizado_en = ahora_iso
    if payload.observacion is not None:
        cita.observacion = payload.observacion

    db.commit()
    db.refresh(cita)

    return {
        "status": "SUCCESS",
        "codigo": 200,
        "mensaje": "Estado de la cita médica actualizado correctamente",
        "data": {
            "cita_id": cita.cita_id,
            "estado_anterior": estado_anterior,
            "estado_actual": estado_actual,
            "actualizado_en": ahora_iso
        }
    }


# ----------------------------------------------------------
# Endpoint 3: Eliminar una Cita Médica (DELETE /citas/{id})

@router.delete("/{id}", status_code=status.HTTP_200_OK)
def eliminar_cita(id: str, db: Session = Depends(get_db)):
    cita = db.query(CitaModel).filter(CitaModel.cita_id == id).first()

    if not cita:
        return JSONResponse(
            status_code=status.HTTP_404_NOT_FOUND,
            content={
                "status": "ERROR",
                "codigo": 404,
                "mensaje": "Cita médica no encontrada",
                "detalles": [
                    {
                        "campo": "id",
                        "mensaje": "No existe una cita médica registrada con el identificador proporcionado."
                    }
                ]
            }
        )

    # Regla de Negocio: No se puede eliminar una cita en estado 'COMPLETADA' o 'EN_CURSO'
    if cita.estado.upper() in ["COMPLETADA", "EN_CURSO"]:
        return JSONResponse(
            status_code=status.HTTP_409_CONFLICT,
            content={
                "status": "ERROR",
                "codigo": 409,
                "mensaje": "No se puede eliminar la cita",
                "detalles": [
                    {
                        "campo": "estado",
                        "mensaje": "No es posible eliminar una cita que ya se encuentra en estado 'COMPLETADA' o 'EN_CURSO'."
                    }
                ]
            }
        )

    ahora_iso = format_utc_now()
    cita_id_eliminada = cita.cita_id

    db.delete(cita)
    db.commit()

    return {
        "status": "SUCCESS",
        "codigo": 200,
        "mensaje": "Cita médica eliminada exitosamente",
        "data": {
            "cita_id": cita_id_eliminada,
            "eliminado_en": ahora_iso
        }
    }

# Registro de Rutas
# Se registran tanto en /api/citas como en /citas para máxima compatibilidad
# con el Módulo A (Gateway) y llamadas directas.
app.include_router(router, prefix="/api/citas", tags=["Citas (API)"])
app.include_router(router, prefix="/citas", tags=["Citas"])


@app.get("/health", tags=["Health"])
def health_check():
    return {"status": "UP", "service": "modulo-b-dominio"}


if __name__ == "__main__":
    import uvicorn
    # Puerto 5000 requerido para el Módulo B según especificación de red Docker
    uvicorn.run("app:app", host="0.0.0.0", port=5000, reload=True)
