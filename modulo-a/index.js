const express = require('express');
const crypto = require('crypto');

const app = express();
app.use(express.json());

// ---------- Configuración (se puede cambiar con variables de entorno) ----------
const PORT = process.env.PORT || 8080;
const MODULO_B_URL = process.env.MODULO_B_URL || 'http://modulo-b:5000';
const MODULO_C_URL = process.env.MODULO_C_URL || 'http://modulo-c:6000';
const TIMEOUT_MS = 5000;

const ESTADOS_VALIDOS = ['PENDIENTE', 'CONFIRMADA', 'EN_CURSO', 'COMPLETADA', 'CANCELADA'];
const ISO_8601 = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

// ---------- Helpers de respuesta ----------
function ok(res, codigo, mensaje, data) {
  return res.status(codigo).json({ status: 'SUCCESS', codigo, mensaje, data });
}

function fail(res, codigo, mensaje, detalles = []) {
  return res.status(codigo).json({ status: 'ERROR', codigo, mensaje, detalles });
}

// ---------- Validaciones ----------
function esTextoNoVacio(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validarCrearCita(body) {
  const detalles = [];
  for (const campo of ['paciente_id', 'medico_id', 'motivo']) {
    if (!esTextoNoVacio(body[campo])) {
      detalles.push({ campo, mensaje: `El campo '${campo}' es obligatorio y debe ser texto.` });
    }
  }
  if (!esTextoNoVacio(body.fecha_hora) || !ISO_8601.test(body.fecha_hora) || isNaN(Date.parse(body.fecha_hora))) {
    detalles.push({
      campo: 'fecha_hora',
      mensaje: 'El formato de fecha y hora debe cumplir con el estándar ISO 8601 (ej. 2026-10-20T10:30:00Z).',
    });
  }
  return detalles;
}

function validarCambioEstado(body) {
  const detalles = [];
  if (!ESTADOS_VALIDOS.includes(body.nuevo_estado)) {
    detalles.push({
      campo: 'nuevo_estado',
      mensaje: `Debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}.`,
    });
  }
  if (body.observacion !== undefined && typeof body.observacion !== 'string') {
    detalles.push({ campo: 'observacion', mensaje: "El campo 'observacion' debe ser texto." });
  }
  return detalles;
}

// ---------- Llamadas a otros módulos ----------
async function llamar(url, method, body) {
  const resp = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  let data = null;
  try {
    data = await resp.json();
  } catch (_) {
    /* respuesta sin JSON */
  }
  return { status: resp.status, ok: resp.ok, data };
}

// Genera un hash único de la operación (para la traza de auditoría)
function hashOperacion(evento, citaId, timestamp) {
  return crypto.createHash('sha256').update(`${evento}|${citaId}|${timestamp}`).digest('hex');
}

// Notifica al Módulo C. Si falla, NO tumba la operación principal: solo se registra en consola.
async function notificarAuditoria(req, evento, citaId, estado) {
  const timestamp = new Date().toISOString();
  const traza = {
    evento,
    cita_id: citaId,
    estado,
    ip_origen: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    timestamp,
    hash: hashOperacion(evento, citaId, timestamp),
  };
  try {
    const r = await llamar(`${MODULO_C_URL}/eventos`, 'POST', traza);
    if (!r.ok) console.error(`[Auditoría] Módulo C respondió ${r.status}`);
    return r.ok;
  } catch (err) {
    console.error('[Auditoría] No se pudo contactar al Módulo C:', err.message);
    return false;
  }
}

// Reenvía un error del Módulo B al cliente con el formato del contrato
function reenviarErrorB(res, r) {
  const d = r.data || {};
  return fail(res, r.status, d.mensaje || 'Error en el servicio de dominio', d.detalles || []);
}

function errorDeRed(res, err) {
  console.error('[Gateway] Error llamando al Módulo B:', err.message);
  return fail(res, 503, 'Servicio no disponible', [
    { campo: 'modulo-b', mensaje: 'No se pudo comunicar con el servicio de citas.' },
  ]);
}

// ---------- Endpoint 1: crear cita ----------
app.post('/api/citas', async (req, res) => {
  const detalles = validarCrearCita(req.body || {});
  if (detalles.length) return fail(res, 400, 'Error de validación en los datos de la solicitud', detalles);

  const { paciente_id, medico_id, fecha_hora, motivo } = req.body;
  try {
    const r = await llamar(`${MODULO_B_URL}/citas`, 'POST', { paciente_id, medico_id, fecha_hora, motivo });
    if (!r.ok) return reenviarErrorB(res, r);

    const { cita_id, estado, creado_en } = r.data.data || {};
    await notificarAuditoria(req, 'CREACION', cita_id, estado);
    return ok(res, 201, 'Cita médica creada exitosamente', { cita_id, estado, creado_en });
  } catch (err) {
    return errorDeRed(res, err);
  }
});

// ---------- Endpoint 2: cambiar estado ----------
app.patch('/api/citas/:id/estado', async (req, res) => {
  const { id } = req.params;
  const detalles = validarCambioEstado(req.body || {});
  if (detalles.length) return fail(res, 400, 'Error de validación en los datos de la solicitud', detalles);

  const { nuevo_estado, observacion } = req.body;
  try {
    const r = await llamar(`${MODULO_B_URL}/citas/${encodeURIComponent(id)}/estado`, 'PATCH', {
      nuevo_estado,
      observacion,
    });
    if (!r.ok) return reenviarErrorB(res, r);

    const { cita_id, estado_anterior, estado_actual, actualizado_en } = r.data.data || {};
    await notificarAuditoria(req, 'ACTUALIZACION_ESTADO', cita_id, estado_actual);
    return ok(res, 200, 'Estado de la cita médica actualizado correctamente', {
      cita_id,
      estado_anterior,
      estado_actual,
      actualizado_en,
    });
  } catch (err) {
    return errorDeRed(res, err);
  }
});

// ---------- Endpoint 3: eliminar cita ----------
app.delete('/api/citas/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const r = await llamar(`${MODULO_B_URL}/citas/${encodeURIComponent(id)}`, 'DELETE');
    if (!r.ok) return reenviarErrorB(res, r); // aquí pasan el 404 y el 409

    const { cita_id, eliminado_en } = r.data.data || {};
    await notificarAuditoria(req, 'ELIMINACION', cita_id, 'ELIMINADA');
    return ok(res, 200, 'Cita médica eliminada exitosamente', { cita_id, eliminado_en });
  } catch (err) {
    return errorDeRed(res, err);
  }
});

// ---------- Errores generales ----------
// JSON mal formado en el body
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return fail(res, 400, 'JSON inválido', [{ campo: 'body', mensaje: 'El cuerpo no es un JSON válido.' }]);
  }
  console.error(err);
  return fail(res, 500, 'Error interno del gateway');
});

// Ruta inexistente
app.use((req, res) => fail(res, 404, 'Ruta no encontrada'));

app.listen(PORT, () => console.log(`Módulo A (API Gateway) escuchando en el puerto ${PORT}`));
