const API = '/api';
const refreshButton = document.querySelector('#refresh-button');
const transactionForm = document.querySelector('#transaction-form');
const transactionMessage = document.querySelector('#transaction-message');
const manageForm = document.querySelector('#manage-form');
const manageMessage = document.querySelector('#manage-message');
const auditFilterForm = document.querySelector('#audit-filter-form');
const manualAuditForm = document.querySelector('#manual-audit-form');
const toast = document.querySelector('#toast');

let toastTimer;
let activeAuditQuery = { kind: 'all' };

const escapeHTML = (value) => String(value ?? '—').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[character]));

function dateText(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHTML(value);
  return new Intl.DateTimeFormat('es-CL', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function apiArray(body) {
  const data = body?.data;
  return Array.isArray(data) ? data : [];
}

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.mensaje || `Error HTTP ${response.status}`);
  return { body, response };
}

function setOverallStatus(status) {
  const root = document.querySelector('#overall-status');
  const label = document.querySelector('#overall-status-label');
  const states = {
    UP: ['up', 'Todos los servicios disponibles'],
    DEGRADED: ['degraded', 'Sistema degradado'],
    DOWN: ['down', 'Sistema no disponible'],
  };
  const [state, text] = states[status] || ['loading', 'Estado desconocido'];
  root.dataset.state = state;
  label.textContent = text;
}

function stateClass(status) {
  if (status === 'UP') return 'up';
  if (status === 'DOWN') return 'down';
  return 'unknown';
}

function serviceIcon(service) {
  if (service === 'gateway') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h16v12H4zM8 10h8M8 14h4"/></svg>';
  if (service === 'modulo-b') return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 20 7.5 12 12 4 7.5 12 3Z"/><path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5"/></svg>';
  return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h4"/></svg>';
}

function renderHealth(data) {
  const nodes = Array.isArray(data.nodes) ? data.nodes : [];
  const databases = Array.isArray(data.databases) ? data.databases : [];
  const available = nodes.filter((node) => node.status === 'UP').length;
  document.querySelector('#metric-services').textContent = `${available}/${nodes.length || 3}`;
  document.querySelector('#metric-failovers').textContent = String(data.failoverEvents?.length || 0);

  document.querySelector('#nodes-list').innerHTML = nodes.length
    ? nodes.map((node) => `
      <div class="health-row">
        <div class="health-service">
          <span class="service-icon">${serviceIcon(node.service)}</span>
          <div><div class="health-name">${escapeHTML(node.name)}</div><div class="health-node">${escapeHTML(node.nodeId || 'nodo sin identificar')}</div></div>
        </div>
        <div class="health-actions">
          <span class="health-state" data-state="${stateClass(node.status)}" data-health-status>${node.status === 'UP' ? 'DISPONIBLE' : node.status === 'DOWN' ? 'NO DISPONIBLE' : 'DESCONOCIDO'}</span>
          <button class="health-check-button" type="button" data-health-path="${healthPaths[node.service] || ''}" ${healthPaths[node.service] ? '' : 'disabled'}>Probar</button>
        </div>
      </div>`).join('')
    : '<div class="loading-row">No hay información de servicios.</div>';

  document.querySelector('#databases-list').innerHTML = databases.length
    ? databases.map((database) => `
      <div class="database-card">
        <span class="database-name">${escapeHTML(database.name)}</span>
        <span class="db-state" data-state="${stateClass(database.status)}">${database.status === 'UP' ? 'OK' : database.status === 'DOWN' ? 'CAÍDA' : '—'}</span>
      </div>`).join('')
    : '<div class="loading-row">No hay información de bases de datos.</div>';

  const events = data.failoverEvents || [];
  const failoverSummary = document.querySelector('#failover-summary');
  failoverSummary.classList.toggle('has-events', events.length > 0);
  failoverSummary.innerHTML = events.length
    ? `<span class="summary-check">!</span><span>${events.length} evento(s) de failover reportado(s).</span>`
    : '<span class="summary-check">✓</span><span>Sin eventos de failover reportados por el entorno local.</span>';

  setOverallStatus(data.status || 'UNKNOWN');
  document.querySelector('#health-updated').textContent = `Actualizado ${new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' }).format(new Date())}`;

  document.querySelectorAll('.health-check-button:not(:disabled)').forEach((button) => {
    button.addEventListener('click', () => checkServiceHealth(button));
  });
}

async function checkServiceHealth(button) {
  const row = button.closest('.health-row');
  const status = row.querySelector('[data-health-status]');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = '…';
  try {
    const { body } = await apiRequest(button.dataset.healthPath);
    const data = body.data && typeof body.data === 'object' ? body.data : body;
    const healthy = data.status === 'UP';
    status.dataset.state = healthy ? 'up' : data.status === 'DOWN' ? 'down' : 'unknown';
    status.textContent = healthy ? 'DISPONIBLE' : data.status === 'DOWN' ? 'NO DISPONIBLE' : 'DESCONOCIDO';
    const node = data.nodeId ? ` (${data.nodeId})` : '';
    showToast(`${row.querySelector('.health-name').textContent}: ${status.textContent.toLowerCase()}${node}`, !healthy);
  } catch (error) {
    status.dataset.state = 'down';
    status.textContent = 'NO DISPONIBLE';
    showToast(error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

function statusPill(status) {
  const state = String(status || '').toUpperCase();
  let className = '';
  if (state === 'PENDIENTE') className = 'pending';
  if (state === 'CANCELADA' || state === 'ELIMINADA') className = 'cancelled';
  if (state === 'ERROR') className = 'cancelled';
  if (state === 'EN_CURSO') className = 'progress';
  return `<span class="state-pill ${className}">${escapeHTML(state || '—')}</span>`;
}

function buildNodeMap(events) {
  const nodeByAppointment = new Map();
  for (const event of events) {
    if (!nodeByAppointment.has(event.citaId)) {
      nodeByAppointment.set(event.citaId, event.detalleOperacion || {});
    }
  }
  return nodeByAppointment;
}

function renderAppointments(appointments, nodeByAppointment) {
  document.querySelector('#metric-appointments').textContent = String(appointments.length);
  const body = document.querySelector('#appointments-body');
  if (!appointments.length) {
    body.innerHTML = '<tr><td class="empty-cell" colspan="7">Aún no hay citas activas. Registra una para iniciar el flujo.</td></tr>';
    return;
  }
  body.innerHTML = appointments.slice(0, 8).map((appointment) => {
    const nodes = nodeByAppointment.get(appointment.cita_id) || {};
    return `<tr>
      <td class="primary-cell">${escapeHTML(appointment.cita_id)}</td>
      <td>${escapeHTML(appointment.paciente_id)}</td>
      <td>${escapeHTML(appointment.medico_id)}</td>
      <td class="secondary-cell">${dateText(appointment.fecha_hora)}</td>
      <td>${statusPill(appointment.estado)}</td>
      <td class="node-cell">${escapeHTML(nodes.nodoDominio || 'sin dato')}</td>
      <td><button class="button button-secondary row-select-button" type="button" data-appointment-id="${escapeHTML(appointment.cita_id)}">Seleccionar</button></td>
    </tr>`;
  }).join('');

  body.querySelectorAll('.row-select-button').forEach((button) => {
    button.addEventListener('click', () => {
      document.querySelector('#manage-appointment-id').value = button.dataset.appointmentId;
      document.querySelector('#gestionar-cita').scrollIntoView({ behavior: 'smooth', block: 'center' });
      manageMessage.textContent = `Cita ${button.dataset.appointmentId} seleccionada.`;
    });
  });
}

const operationNames = {
  CREACION: 'CREACIÓN',
  ACTUALIZACION_ESTADO: 'CAMBIO DE ESTADO',
  ELIMINACION: 'ELIMINACIÓN',
};

const healthPaths = {
  gateway: '/health/gateway',
  'modulo-b': '/health/dominio',
  'modulo-c': '/health/auditoria',
};

function auditRequestPath(query = activeAuditQuery) {
  if (query.kind === 'cita') return `/auditoria/eventos/cita/${encodeURIComponent(query.citaId)}`;
  if (query.kind === 'tipo') return `/auditoria/eventos/tipo/${encodeURIComponent(query.tipoOperacion)}`;
  if (query.kind === 'rango') {
    const params = new URLSearchParams({ desde: query.desde, hasta: query.hasta });
    return `/auditoria/eventos/rango?${params.toString()}`;
  }
  return '/auditoria/eventos';
}

function syncAuditFilterFields() {
  const kind = document.querySelector('#audit-filter-kind').value;
  const citaField = document.querySelector('#audit-cita-field');
  const tipoField = document.querySelector('#audit-tipo-field');
  const rangoField = document.querySelector('#audit-rango-field');
  citaField.hidden = kind !== 'cita';
  tipoField.hidden = kind !== 'tipo';
  rangoField.hidden = kind !== 'rango';
  document.querySelector('#audit-cita-id').required = kind === 'cita';
  document.querySelector('#audit-desde').required = kind === 'rango';
  document.querySelector('#audit-hasta').required = kind === 'rango';
}

function renderAudit(events, auditNode) {
  document.querySelector('#metric-events').textContent = String(events.length);
  document.querySelector('#audit-node-label').textContent = `Origen: ${auditNode || 'nodo no identificado'}`;
  const body = document.querySelector('#audit-body');
  if (!events.length) {
    body.innerHTML = '<tr><td class="empty-cell" colspan="5">No hay eventos para esta consulta.</td></tr>';
    return;
  }
  body.innerHTML = events.slice(0, 8).map((event) => {
    const nodes = event.detalleOperacion || {};
    return `<tr>
      <td class="operation-label">${escapeHTML(operationNames[event.tipoOperacion] || event.tipoOperacion)}</td>
      <td class="primary-cell">${escapeHTML(event.citaId)}</td>
      <td>${statusPill(event.estadoCita || event.resultado)}</td>
      <td class="secondary-cell">${dateText(event.timestamp)}</td>
      <td class="node-cell">GW ${escapeHTML(nodes.nodoGateway || '—')} · B ${escapeHTML(nodes.nodoDominio || '—')} · C ${escapeHTML(nodes.nodoAuditoria || '—')}</td>
    </tr>`;
  }).join('');
}

function renderLoadError(target, columns, message) {
  document.querySelector(target).innerHTML = `<tr><td class="empty-cell" colspan="${columns}">${escapeHTML(message)}</td></tr>`;
}

async function refreshData() {
  refreshButton.classList.add('is-spinning');
  try {
    const [healthResult, appointmentsResult, auditResult] = await Promise.allSettled([
      apiRequest('/dashboard/health'),
      apiRequest('/citas'),
      apiRequest(auditRequestPath()),
    ]);

    if (healthResult.status === 'fulfilled') {
      const healthResponse = healthResult.value.body;
      renderHealth({ ...(healthResponse.data || {}), status: healthResponse.status });
    } else {
      setOverallStatus('DOWN');
      document.querySelector('#nodes-list').innerHTML = '<div class="loading-row">No se pudo consultar el estado de los servicios.</div>';
      document.querySelector('#databases-list').innerHTML = '<div class="loading-row">No se pudo consultar el estado de las bases de datos.</div>';
    }

    const events = auditResult.status === 'fulfilled' ? apiArray(auditResult.value.body) : [];
    const nodeByAppointment = buildNodeMap(events);
    if (appointmentsResult.status === 'fulfilled') {
      renderAppointments(apiArray(appointmentsResult.value.body), nodeByAppointment);
    } else {
      renderLoadError('#appointments-body', 7, 'No se pudieron cargar las citas. Revisa que los servicios estén activos.');
    }
    if (auditResult.status === 'fulfilled') {
      renderAudit(events, auditResult.value.response.headers.get('X-Audit-Node'));
    } else {
      document.querySelector('#metric-events').textContent = '—';
      renderLoadError('#audit-body', 5, 'No se pudo consultar el historial de auditoría.');
      document.querySelector('#audit-node-label').textContent = 'Origen: sin conexión';
    }

    document.querySelector('#last-refresh').textContent = `Última actualización ${new Intl.DateTimeFormat('es-CL', { timeStyle: 'short' }).format(new Date())}`;
  } finally {
    refreshButton.classList.remove('is-spinning');
  }
}

function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), 3600);
}

function transactionPayload(patientId, appointmentDate) {
  const formData = new FormData(transactionForm);
  return {
    paciente_id: patientId,
    medico_id: String(formData.get('medico_id')).trim(),
    fecha_hora: appointmentDate,
    motivo: String(formData.get('motivo')).trim(),
  };
}

async function createAppointment(payload) {
  const { body, response } = await apiRequest('/citas', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  return {
    appointment: body.data,
    domainNode: response.headers.get('X-Domain-Node') || 'sin dato',
  };
}

function setFormBusy(isBusy) {
  document.querySelector('#create-button').disabled = isBusy;
  document.querySelector('#burst-button').disabled = isBusy;
  refreshButton.disabled = isBusy;
}

transactionForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!transactionForm.reportValidity()) return;
  const formData = new FormData(transactionForm);
  const localDate = new Date(String(formData.get('fecha_hora')));
  if (Number.isNaN(localDate.getTime())) return;

  setFormBusy(true);
  transactionMessage.className = 'form-message';
  transactionMessage.textContent = 'Enviando transacción al gateway…';
  try {
    const result = await createAppointment(transactionPayload(
      String(formData.get('paciente_id')).trim(), localDate.toISOString(),
    ));
    transactionMessage.className = 'form-message success';
    transactionMessage.textContent = `Cita ${result.appointment?.cita_id || ''} atendida por ${result.domainNode}.`;
    showToast('Cita registrada y enviada a auditoría.');
    await refreshData();
  } catch (error) {
    transactionMessage.className = 'form-message error';
    transactionMessage.textContent = error.message;
    showToast(error.message, true);
  } finally {
    setFormBusy(false);
  }
});

document.querySelector('#burst-button').addEventListener('click', async () => {
  if (!transactionForm.reportValidity()) return;
  const formData = new FormData(transactionForm);
  const baseDate = new Date(String(formData.get('fecha_hora')));
  if (Number.isNaN(baseDate.getTime())) return;
  const count = Math.min(20, Math.max(2, Number(document.querySelector('#burst-count').value) || 2));
  const basePatientId = String(formData.get('paciente_id')).trim();
  const patientPrefix = basePatientId.slice(0, Math.max(1, 45 - String(count).length));
  const payloads = Array.from({ length: count }, (_, index) => transactionPayload(
    `${patientPrefix}-${index + 1}`,
    new Date(baseDate.getTime() + index * 60_000).toISOString(),
  ));

  setFormBusy(true);
  transactionMessage.className = 'form-message';
  transactionMessage.textContent = `Enviando ${count} transacciones en paralelo…`;
  try {
    const results = await Promise.allSettled(payloads.map(createAppointment));
    const created = results.filter((result) => result.status === 'fulfilled').length;
    const failed = count - created;
    transactionMessage.className = failed ? 'form-message error' : 'form-message success';
    transactionMessage.textContent = failed
      ? `Ráfaga finalizada: ${created} correctas y ${failed} con error.`
      : `Ráfaga finalizada: ${created} citas registradas.`;
    showToast(failed ? `${created}/${count} citas registradas.` : `${created} citas registradas correctamente.`, failed > 0);
    await refreshData();
  } catch (error) {
    transactionMessage.className = 'form-message error';
    transactionMessage.textContent = error.message;
    showToast(error.message, true);
  } finally {
    setFormBusy(false);
  }
});

manageForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!manageForm.reportValidity()) return;
  const citaId = document.querySelector('#manage-appointment-id').value.trim();
  const nuevoEstado = document.querySelector('#manage-new-state').value;
  const observacion = document.querySelector('#manage-observation').value.trim();
  const updateButton = document.querySelector('#update-appointment-button');
  updateButton.disabled = true;
  manageMessage.className = 'form-message';
  manageMessage.textContent = 'Actualizando estado de la cita…';
  try {
    const { body } = await apiRequest(`/citas/${encodeURIComponent(citaId)}/estado`, {
      method: 'PATCH',
      body: JSON.stringify({ nuevo_estado: nuevoEstado, observacion }),
    });
    manageMessage.className = 'form-message success';
    manageMessage.textContent = body.mensaje || `Estado actualizado para ${citaId}.`;
    showToast(`Cita ${citaId} actualizada.`);
    await refreshData();
  } catch (error) {
    manageMessage.className = 'form-message error';
    manageMessage.textContent = error.message;
    showToast(error.message, true);
  } finally {
    updateButton.disabled = false;
  }
});

document.querySelector('#delete-appointment-button').addEventListener('click', async () => {
  if (!manageForm.reportValidity()) return;
  const citaId = document.querySelector('#manage-appointment-id').value.trim();
  if (!window.confirm(`¿Eliminar la cita ${citaId}?`)) return;
  const deleteButton = document.querySelector('#delete-appointment-button');
  deleteButton.disabled = true;
  manageMessage.className = 'form-message';
  manageMessage.textContent = 'Eliminando cita…';
  try {
    const { body } = await apiRequest(`/citas/${encodeURIComponent(citaId)}`, { method: 'DELETE' });
    manageMessage.className = 'form-message success';
    manageMessage.textContent = body.mensaje || `Cita ${citaId} eliminada.`;
    showToast(`Cita ${citaId} eliminada.`);
    await refreshData();
  } catch (error) {
    manageMessage.className = 'form-message error';
    manageMessage.textContent = error.message;
    showToast(error.message, true);
  } finally {
    deleteButton.disabled = false;
  }
});

document.querySelector('#audit-filter-kind').addEventListener('change', syncAuditFilterFields);
auditFilterForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  syncAuditFilterFields();
  if (!auditFilterForm.reportValidity()) return;
  const kind = document.querySelector('#audit-filter-kind').value;
  if (kind === 'cita') {
    activeAuditQuery = { kind, citaId: document.querySelector('#audit-cita-id').value.trim() };
  } else if (kind === 'tipo') {
    activeAuditQuery = { kind, tipoOperacion: document.querySelector('#audit-tipo').value };
  } else if (kind === 'rango') {
    const desde = new Date(document.querySelector('#audit-desde').value);
    const hasta = new Date(document.querySelector('#audit-hasta').value);
    if (desde > hasta) {
      const endDate = document.querySelector('#audit-hasta');
      endDate.setCustomValidity('La fecha final debe ser posterior a la fecha inicial.');
      endDate.reportValidity();
      endDate.setCustomValidity('');
      return;
    }
    activeAuditQuery = { kind, desde: desde.toISOString(), hasta: hasta.toISOString() };
  } else {
    activeAuditQuery = { kind: 'all' };
  }
  await refreshData();
});

document.querySelector('#reset-audit-filter').addEventListener('click', async () => {
  auditFilterForm.reset();
  activeAuditQuery = { kind: 'all' };
  syncAuditFilterFields();
  await refreshData();
});

manualAuditForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!manualAuditForm.reportValidity()) return;
  const detailsText = document.querySelector('#manual-details').value.trim();
  let detalleOperacion;
  if (detailsText) {
    try {
      detalleOperacion = JSON.parse(detailsText);
      if (!detalleOperacion || Array.isArray(detalleOperacion) || typeof detalleOperacion !== 'object') {
        throw new Error('El detalle debe ser un objeto JSON.');
      }
    } catch (error) {
      const message = error instanceof SyntaxError ? 'El detalle no contiene JSON válido.' : error.message;
      const messageElement = document.querySelector('#manual-audit-message');
      messageElement.className = 'form-message error';
      messageElement.textContent = message;
      return;
    }
  }

  const payload = {
    citaId: document.querySelector('#manual-cita-id').value.trim(),
    tipoOperacion: document.querySelector('#manual-event-type').value,
    estadoCita: document.querySelector('#manual-event-state').value,
    estadoAnterior: document.querySelector('#manual-previous-state').value.trim() || null,
    resultado: document.querySelector('#manual-result').value,
    servicioOrigen: document.querySelector('#manual-origin').value.trim() || null,
    ipOrigen: document.querySelector('#manual-ip-origin').value.trim() || null,
    detalleOperacion,
  };
  const submitButton = manualAuditForm.querySelector('button[type="submit"]');
  const message = document.querySelector('#manual-audit-message');
  submitButton.disabled = true;
  message.className = 'form-message';
  message.textContent = 'Registrando evento…';
  try {
    const { body } = await apiRequest('/auditoria/eventos', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    message.className = 'form-message success';
    message.textContent = body.mensaje || 'Evento registrado.';
    showToast('Evento de auditoría registrado.');
    await refreshData();
  } catch (error) {
    message.className = 'form-message error';
    message.textContent = error.message;
    showToast(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
});

refreshButton.addEventListener('click', refreshData);

const initialAppointmentDate = new Date(Date.now() + 60 * 60 * 1000);
initialAppointmentDate.setMinutes(initialAppointmentDate.getMinutes() - initialAppointmentDate.getTimezoneOffset());
document.querySelector('#appointment-date').value = initialAppointmentDate.toISOString().slice(0, 16);

syncAuditFilterFields();
refreshData();
setInterval(refreshData, 12_000);
