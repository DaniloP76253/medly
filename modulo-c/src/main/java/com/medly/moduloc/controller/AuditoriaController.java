package com.medly.moduloc.controller;

import com.medly.moduloc.dto.ApiResponse;
import com.medly.moduloc.dto.EventoAuditoriaResponse;
import com.medly.moduloc.dto.RegistroEventoRequest;
import com.medly.moduloc.service.AuditoriaService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.List;

@RestController
@RequestMapping("/api/auditoria")
@RequiredArgsConstructor
@Slf4j
public class AuditoriaController {

    private final AuditoriaService auditoriaService;

    @GetMapping("/health")
    public ResponseEntity<ApiResponse<String>> health() {
        return ResponseEntity.ok(
                ApiResponse.success(200, "Módulo C saludable", "OK")
        );
    }

    /**
     * Registra un evento de auditoría.
     * Este endpoint es invocado por el Módulo A (Gateway) cada vez que se ejecuta
     * una operación en el Módulo B (crear cita, actualizar estado, eliminar cita).
     */
    @PostMapping("/eventos")
    public ResponseEntity<ApiResponse<EventoAuditoriaResponse>> registrarEvento(
            @Valid @RequestBody RegistroEventoRequest request) {

        log.info("Registrando evento de auditoría: tipo={}, citaId={}",
                request.getTipoOperacion(), request.getCitaId());

        EventoAuditoriaResponse evento = auditoriaService.registrarEvento(request);

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success(
                        201,
                        "Evento de auditoría registrado exitosamente",
                        evento
                ));
    }

    /**
     * Obtiene todos los eventos de auditoría registrados.
     */
    @GetMapping("/eventos")
    public ResponseEntity<ApiResponse<List<EventoAuditoriaResponse>>> obtenerTodosLosEventos() {
        log.info("Consultando todos los eventos de auditoría");

        List<EventoAuditoriaResponse> eventos = auditoriaService.obtenerTodosLosEventos();

        return ResponseEntity.ok(
                ApiResponse.success(200, "Eventos de auditoría obtenidos exitosamente", eventos)
        );
    }

    /**
     * Obtiene la traza de auditoría completa de una cita médica específica.
     * Permite ver todo el historial de cambios realizados por el Módulo B
     * sobre una cita particular.
     */
    @GetMapping("/eventos/cita/{citaId}")
    public ResponseEntity<ApiResponse<List<EventoAuditoriaResponse>>> obtenerEventosPorCita(
            @PathVariable String citaId) {

        log.info("Consultando eventos de auditoría para la cita: {}", citaId);

        List<EventoAuditoriaResponse> eventos = auditoriaService.obtenerEventosPorCita(citaId);

        return ResponseEntity.ok(
                ApiResponse.success(
                        200,
                        "Traza de auditoría obtenida para la cita: " + citaId,
                        eventos
                )
        );
    }

    /**
     * Filtra eventos por tipo de operación (CREACION, ACTUALIZACION_ESTADO, ELIMINACION).
     */
    @GetMapping("/eventos/tipo/{tipoOperacion}")
    public ResponseEntity<ApiResponse<List<EventoAuditoriaResponse>>> obtenerEventosPorTipo(
            @PathVariable String tipoOperacion) {

        log.info("Consultando eventos de auditoría por tipo: {}", tipoOperacion);

        List<EventoAuditoriaResponse> eventos = auditoriaService.obtenerEventosPorTipo(tipoOperacion);

        return ResponseEntity.ok(
                ApiResponse.success(
                        200,
                        "Eventos filtrados por tipo: " + tipoOperacion,
                        eventos
                )
        );
    }

    /**
     * Filtra eventos por rango de fechas.
     */
    @GetMapping("/eventos/rango")
    public ResponseEntity<ApiResponse<List<EventoAuditoriaResponse>>> obtenerEventosPorRango(
            @RequestParam Instant desde,
            @RequestParam Instant hasta) {

        log.info("Consultando eventos de auditoría desde {} hasta {}", desde, hasta);

        List<EventoAuditoriaResponse> eventos = auditoriaService.obtenerEventosPorRangoFechas(desde, hasta);

        return ResponseEntity.ok(
                ApiResponse.success(
                        200,
                        "Eventos filtrados por rango de fechas",
                        eventos
                )
        );
    }
}
