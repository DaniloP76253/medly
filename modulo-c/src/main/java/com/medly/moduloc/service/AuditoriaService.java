package com.medly.moduloc.service;

import com.medly.moduloc.dto.EventoAuditoriaResponse;
import com.medly.moduloc.dto.RegistroEventoRequest;
import com.medly.moduloc.model.EventoAuditoria;
import com.medly.moduloc.model.TipoOperacion;
import com.medly.moduloc.repository.EventoAuditoriaRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class AuditoriaService {

    private final EventoAuditoriaRepository repository;

    /**
     * Registra un nuevo evento de auditoría inmutable.
     * Cada modificación del Módulo B (crear cita, actualizar estado, eliminar)
     * es notificada por el Gateway y registrada aquí.
     */
    public EventoAuditoriaResponse registrarEvento(RegistroEventoRequest request) {
        Instant ahora = Instant.now();

        TipoOperacion tipo = TipoOperacion.valueOf(request.getTipoOperacion().toUpperCase());

        String hash = generarHashOperacion(
                request.getCitaId(),
                request.getTipoOperacion(),
                ahora.toString(),
                request.getResultado()
        );

        EventoAuditoria evento = EventoAuditoria.builder()
                .citaId(request.getCitaId())
                .tipoOperacion(tipo)
                .estadoCita(request.getEstadoCita())
                .estadoAnterior(request.getEstadoAnterior())
                .timestamp(ahora)
                .ipOrigen(request.getIpOrigen())
                .hashOperacion(hash)
                .detalleOperacion(request.getDetalleOperacion())
                .servicioOrigen(request.getServicioOrigen())
                .resultado(request.getResultado())
                .build();

        EventoAuditoria guardado = repository.save(evento);
        log.info("Evento de auditoría registrado: tipo={}, citaId={}, hash={}",
                tipo, request.getCitaId(), hash);

        return mapToResponse(guardado);
    }

    /**
     * Obtiene todos los eventos de auditoría, ordenados por timestamp descendente.
     */
    public List<EventoAuditoriaResponse> obtenerTodosLosEventos() {
        return repository.findAllByOrderByTimestampDesc()
                .stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    /**
     * Obtiene la traza de auditoría completa de una cita específica.
     * Esto permite rastrear todas las modificaciones hechas por el Módulo B.
     */
    public List<EventoAuditoriaResponse> obtenerEventosPorCita(String citaId) {
        return repository.findByCitaIdOrderByTimestampDesc(citaId)
                .stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    /**
     * Filtra eventos por tipo de operación.
     */
    public List<EventoAuditoriaResponse> obtenerEventosPorTipo(String tipoOperacion) {
        TipoOperacion tipo = TipoOperacion.valueOf(tipoOperacion.toUpperCase());
        return repository.findByTipoOperacionOrderByTimestampDesc(tipo)
                .stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    /**
     * Filtra eventos por rango de fechas.
     */
    public List<EventoAuditoriaResponse> obtenerEventosPorRangoFechas(Instant desde, Instant hasta) {
        return repository.findByTimestampBetweenOrderByTimestampDesc(desde, hasta)
                .stream()
                .map(this::mapToResponse)
                .collect(Collectors.toList());
    }

    /**
     * Genera un hash SHA-256 de la operación para garantizar integridad
     * y trazabilidad inmutable del evento.
     */
    private String generarHashOperacion(String citaId, String tipoOperacion,
                                         String timestamp, String resultado) {
        try {
            String datos = String.join("|", citaId, tipoOperacion, timestamp, resultado);
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = digest.digest(datos.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hashBytes);
        } catch (NoSuchAlgorithmException e) {
            log.error("Error al generar hash SHA-256", e);
            throw new RuntimeException("Error al generar hash de operación", e);
        }
    }

    private EventoAuditoriaResponse mapToResponse(EventoAuditoria evento) {
        return EventoAuditoriaResponse.builder()
                .id(evento.getId())
                .citaId(evento.getCitaId())
                .tipoOperacion(evento.getTipoOperacion().name())
                .estadoCita(evento.getEstadoCita())
                .estadoAnterior(evento.getEstadoAnterior())
                .timestamp(evento.getTimestamp())
                .ipOrigen(evento.getIpOrigen())
                .hashOperacion(evento.getHashOperacion())
                .detalleOperacion(evento.getDetalleOperacion())
                .servicioOrigen(evento.getServicioOrigen())
                .resultado(evento.getResultado())
                .build();
    }
}
