// ==============================================================================
// Script de inicialización para MongoDB Atlas Local (Medly - Módulo C)
// Se ejecuta automáticamente al iniciar el contenedor por primera vez.
// Versionado en GitHub para que cualquier desarrollador tenga la BD lista.
// ==============================================================================

// Cambiar a la base de datos de auditoría
db = db.getSiblingDB('medly_audit');

// Limpiar colección si existe (para idempotencia en recreación)
db.eventos_auditoria.drop();

// 1. Crear colección con validador de esquema básico
db.createCollection('eventos_auditoria');

// 2. Crear índices para optimizar las consultas de auditoría
db.eventos_auditoria.createIndex({ "citaId": 1 }, { name: "idx_cita_id" });
db.eventos_auditoria.createIndex({ "tipoOperacion": 1 }, { name: "idx_tipo_operacion" });
db.eventos_auditoria.createIndex({ "timestamp": -1 }, { name: "idx_timestamp_desc" });
db.eventos_auditoria.createIndex({ "citaId": 1, "tipoOperacion": 1 }, { name: "idx_cita_tipo" });
db.eventos_auditoria.createIndex({ "hashOperacion": 1 }, { unique: true, name: "idx_hash_unique" });

// 3. Semilla de datos iniciales: Traza histórica de ejemplo
// Refleja el ciclo de vida de citas médicas sincronizadas con Módulo B
db.eventos_auditoria.insertMany([
  {
    "citaId": "cita_98a7b6c5",
    "tipoOperacion": "CREACION",
    "estadoCita": "PENDIENTE",
    "estadoAnterior": null,
    "timestamp": new Date("2026-10-14T16:00:00Z"),
    "ipOrigen": "192.168.1.100",
    "hashOperacion": "a1b2c3d4e5f67890123456789abcdef0123456789abcdef0123456789abcdef0",
    "servicioOrigen": "MODULO_A",
    "resultado": "SUCCESS",
    "detalleOperacion": {
      "paciente_id": "PAC-4412",
      "medico_id": "MED-008",
      "fecha_hora": "2026-10-20T10:30:00Z",
      "motivo": "Control general de salud"
    }
  },
  {
    "citaId": "cita_98a7b6c5",
    "tipoOperacion": "ACTUALIZACION_ESTADO",
    "estadoCita": "CONFIRMADA",
    "estadoAnterior": "PENDIENTE",
    "timestamp": new Date("2026-10-14T16:15:00Z"),
    "ipOrigen": "192.168.1.100",
    "hashOperacion": "b2c3d4e5f6a17890123456789abcdef0123456789abcdef0123456789abcdef1",
    "servicioOrigen": "MODULO_A",
    "resultado": "SUCCESS",
    "detalleOperacion": {
      "nuevo_estado": "CONFIRMADA",
      "observacion": "Paciente confirmó asistencia vía telefónica"
    }
  },
  {
    "citaId": "cita_11b2c3d4",
    "tipoOperacion": "CREACION",
    "estadoCita": "PENDIENTE",
    "estadoAnterior": null,
    "timestamp": new Date("2026-10-22T20:00:00Z"),
    "ipOrigen": "192.168.1.150",
    "hashOperacion": "c3d4e5f6a1b27890123456789abcdef0123456789abcdef0123456789abcdef2",
    "servicioOrigen": "MODULO_A",
    "resultado": "SUCCESS",
    "detalleOperacion": {
      "paciente_id": "PAC-3310",
      "medico_id": "MED-002",
      "fecha_hora": "2026-10-25T09:00:00Z",
      "motivo": "Consulta dermatología"
    }
  },
  {
    "citaId": "cita_11b2c3d4",
    "tipoOperacion": "ELIMINACION",
    "estadoCita": "ELIMINADA",
    "estadoAnterior": "PENDIENTE",
    "timestamp": new Date("2026-10-22T20:27:00Z"),
    "ipOrigen": "192.168.1.150",
    "hashOperacion": "d4e5f6a1b2c37890123456789abcdef0123456789abcdef0123456789abcdef3",
    "servicioOrigen": "MODULO_A",
    "resultado": "SUCCESS",
    "detalleOperacion": {
      "eliminado_en": "2026-10-22T20:27:00Z",
      "motivo_cancelacion": "Cancelado por el paciente"
    }
  }
]);

print("=== Base de datos medly_audit inicializada con éxito en MongoDB Atlas Local ===");
print("Documentos insertados: " + db.eventos_auditoria.countDocuments());

