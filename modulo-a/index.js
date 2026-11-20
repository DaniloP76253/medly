const express = require('express');
const crypto = require('crypto');

const app = express();
const NODE_ID = process.env.NODE_ID || process.env.HOSTNAME || 'modulo-a-local';
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader('X-Node-Id', NODE_ID);
  next();
});

// ---------- Configuración (se puede cambiar con variables de entorno) ----------
const PORT = process.env.PORT || 8080;
const MODULO_B_URL = process.env.MODULO_B_URL || 'http://modulo-b:5000';
const MODULO_C_URL = process.env.MODULO_C_URL || 'http://modulo-c:6001/api/auditoria';
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
  return {
    status: resp.status,
    ok: resp.ok,
    data,
    nodeId: resp.headers.get('x-node-id'),
  };
}

// Genera un hash único de la operación (para la traza de auditoría)
function hashOperacion(evento, citaId, timestamp) {
  return crypto.createHash('sha256').update(`${evento}|${citaId}|${timestamp}`).digest('hex');
}

// Notifica al Módulo C. Si falla, NO tumba la operación principal: solo se registra en consola.
async function notificarAuditoria(req, evento, citaId, estado, nodoDominio) {
  const timestamp = new Date().toISOString();
  const traza = {
    citaId: String(citaId),
    tipoOperacion: evento,
    estadoCita: estado,
    resultado: 'SUCCESS',
    ipOrigen: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    servicioOrigen: 'MODULO_A',
    detalleOperacion: {
      nodoGateway: NODE_ID,
      nodoDominio: nodoDominio || 'no-disponible',
    },
  };
  try {
    const r = await llamar(`${MODULO_C_URL}/eventos`, 'POST', traza);
    if (!r.ok) console.error(`[Auditoría] Módulo C respondió ${r.status}`);
    return r.ok;
  } catch (err) {
    console.error('[Auditoría] No se pudo contactar al Módulo C:', {
      message: err.message,
      cause: err.cause?.code || err.cause?.message,
      url: `${MODULO_C_URL}/eventos`,
    });
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

async function consultarSalud(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await response.json().catch(() => ({}));
  const data = body.data && typeof body.data === 'object' ? body.data : body;
  return {
    status: response.ok && data.status !== 'DOWN' ? 'UP' : 'DOWN',
    nodeId: data.nodeId || response.headers.get('x-node-id') || 'desconocido',
    data,
  };
}

async function proxyAuditoria(req, res, path, method = 'GET', body) {
  try {
    const result = await llamar(`${MODULO_C_URL}${path}`, method, body);
    res.setHeader('X-Audit-Node', result.nodeId || 'desconocido');
    return res.status(result.status).json(result.data);
  } catch (err) {
    console.error('[Gateway] Error llamando al Módulo C:', err.message);
    return fail(res, 503, 'Auditoría no disponible', [
      { campo: 'modulo-c', mensaje: 'No se pudo comunicar con el servicio de auditoría.' },
    ]);
  }
}

async function proxySalud(res, url, headerName, serviceName) {
  try {
    const result = await llamar(url, 'GET');
    res.setHeader(headerName, result.nodeId || 'desconocido');
    return res.status(result.status).json(result.data);
  } catch (err) {
    return fail(res, 503, `${serviceName} no disponible`, [
      { campo: serviceName, mensaje: `No se pudo consultar la salud de ${serviceName}.` },
    ]);
  }
}

function servicioNoDisponible(err) {
  return { status: 'DOWN', nodeId: 'no-disponible', detail: err.message };
}

app.get('/health', (req, res) => {
  return res.json({ status: 'UP', service: 'modulo-a-gateway', nodeId: NODE_ID });
});

app.get('/api/health/gateway', (req, res) => {
  return res.json({ status: 'UP', service: 'modulo-a-gateway', nodeId: NODE_ID });
});

app.get('/api/health/dominio', (req, res) =>
  proxySalud(res, `${MODULO_B_URL}/health`, 'X-Domain-Node', 'Módulo B'));

app.get('/api/health/auditoria', (req, res) =>
  proxySalud(res, `${MODULO_C_URL}/health`, 'X-Audit-Node', 'Módulo C'));

app.get('/api/dashboard/health', async (req, res) => {
  const [dominioResult, auditoriaResult] = await Promise.allSettled([
    consultarSalud(`${MODULO_B_URL}/health`),
    consultarSalud(`${MODULO_C_URL}/health`),
  ]);
  const dominio = dominioResult.status === 'fulfilled'
    ? dominioResult.value
    : servicioNoDisponible(dominioResult.reason);
  const auditoria = auditoriaResult.status === 'fulfilled'
    ? auditoriaResult.value
    : servicioNoDisponible(auditoriaResult.reason);

  const nodes = [
    { name: 'API Gateway', service: 'gateway', status: 'UP', nodeId: NODE_ID },
    { name: 'Dominio', service: 'modulo-b', status: dominio.status, nodeId: dominio.nodeId },
    { name: 'Auditoría', service: 'modulo-c', status: auditoria.status, nodeId: auditoria.nodeId },
  ];
  const databases = [
    { name: dominio.data?.database?.name || 'PostgreSQL', status: dominio.data?.database?.status || 'UNKNOWN' },
    { name: auditoria.data?.database?.name || 'MongoDB', status: auditoria.data?.database?.status || 'UNKNOWN' },
  ];
  const healthy = nodes.every((node) => node.status === 'UP')
    && databases.every((database) => database.status === 'UP');

  return res.json({
    status: healthy ? 'UP' : 'DEGRADED',
    data: {
      nodes,
      databases,
      failoverEvents: [],
      note: 'El entorno local usa una instancia por servicio; el failover automático está en la arquitectura propuesta.',
    },
  });
});

app.get('/api/citas', async (req, res) => {
  try {
    const result = await llamar(`${MODULO_B_URL}/api/citas`, 'GET');
    res.setHeader('X-Domain-Node', result.nodeId || 'desconocido');
    return res.status(result.status).json(result.data);
  } catch (err) {
    return errorDeRed(res, err);
  }
});

app.get('/api/auditoria/eventos', async (req, res) => {
  return proxyAuditoria(req, res, '/eventos');
});

app.get('/api/auditoria/eventos/cita/:citaId', (req, res) =>
  proxyAuditoria(req, res, `/eventos/cita/${encodeURIComponent(req.params.citaId)}`));

app.get('/api/auditoria/eventos/tipo/:tipoOperacion', (req, res) => {
  const tipos = ['CREACION', 'ACTUALIZACION_ESTADO', 'ELIMINACION'];
  const tipoOperacion = req.params.tipoOperacion.toUpperCase();
  if (!tipos.includes(tipoOperacion)) {
    return fail(res, 400, 'Tipo de operación inválido', [
      { campo: 'tipoOperacion', mensaje: `Debe ser uno de: ${tipos.join(', ')}.` },
    ]);
  }
  return proxyAuditoria(req, res, `/eventos/tipo/${encodeURIComponent(tipoOperacion)}`);
});

app.get('/api/auditoria/eventos/rango', (req, res) => {
  const { desde, hasta } = req.query;
  if (!desde || !hasta || Number.isNaN(Date.parse(desde)) || Number.isNaN(Date.parse(hasta))) {
    return fail(res, 400, 'Rango de fechas inválido', [
      { campo: 'rango', mensaje: 'Indica desde y hasta en formato ISO 8601.' },
    ]);
  }
  const params = new URLSearchParams({ desde, hasta });
  return proxyAuditoria(req, res, `/eventos/rango?${params.toString()}`);
});

app.post('/api/auditoria/eventos', (req, res) => {
  const { citaId, tipoOperacion, resultado } = req.body || {};
  const detalles = [];
  if (!esTextoNoVacio(citaId)) detalles.push({ campo: 'citaId', mensaje: 'El ID de la cita es obligatorio.' });
  if (!esTextoNoVacio(tipoOperacion)) detalles.push({ campo: 'tipoOperacion', mensaje: 'El tipo de operación es obligatorio.' });
  if (!esTextoNoVacio(resultado)) detalles.push({ campo: 'resultado', mensaje: 'El resultado es obligatorio.' });
  if (detalles.length) return fail(res, 400, 'Faltan datos para registrar el evento', detalles);

  return proxyAuditoria(req, res, '/eventos', 'POST', req.body);
});

// ---------- Endpoint 1: crear cita ----------
app.post('/api/citas', async (req, res) => {
  const detalles = validarCrearCita(req.body || {});
  if (detalles.length) return fail(res, 400, 'Error de validación en los datos de la solicitud', detalles);

  const { paciente_id, medico_id, fecha_hora, motivo } = req.body;
  try {
    const r = await llamar(`${MODULO_B_URL}/citas`, 'POST', { paciente_id, medico_id, fecha_hora, motivo });
    res.setHeader('X-Domain-Node', r.nodeId || 'desconocido');
    if (!r.ok) return reenviarErrorB(res, r);

    const { cita_id, estado, creado_en } = r.data.data || {};
    await notificarAuditoria(req, 'CREACION', cita_id, estado, r.nodeId);
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
    res.setHeader('X-Domain-Node', r.nodeId || 'desconocido');
    if (!r.ok) return reenviarErrorB(res, r);

    const { cita_id, estado_anterior, estado_actual, actualizado_en } = r.data.data || {};
    await notificarAuditoria(req, 'ACTUALIZACION_ESTADO', cita_id, estado_actual, r.nodeId);
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
    res.setHeader('X-Domain-Node', r.nodeId || 'desconocido');
    if (!r.ok) return reenviarErrorB(res, r); // aquí pasan el 404 y el 409

    const { cita_id, eliminado_en } = r.data.data || {};
    await notificarAuditoria(req, 'ELIMINACION', cita_id, 'ELIMINADA', r.nodeId);
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
