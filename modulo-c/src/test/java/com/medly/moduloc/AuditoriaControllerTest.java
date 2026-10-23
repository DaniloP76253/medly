package com.medly.moduloc;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.medly.moduloc.controller.AuditoriaController;
import com.medly.moduloc.dto.EventoAuditoriaResponse;
import com.medly.moduloc.dto.RegistroEventoRequest;
import com.medly.moduloc.service.AuditoriaService;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@WebMvcTest(AuditoriaController.class)
class AuditoriaControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private AuditoriaService auditoriaService;

    @Test
    @DisplayName("POST /api/auditoria/eventos - Debe registrar evento exitosamente (201 Created)")
    void testRegistrarEventoExitoso() throws Exception {
        RegistroEventoRequest request = RegistroEventoRequest.builder()
                .citaId("cita_98a7b6c5")
                .tipoOperacion("CREACION")
                .estadoCita("PENDIENTE")
                .resultado("SUCCESS")
                .ipOrigen("192.168.1.100")
                .servicioOrigen("MODULO_A")
                .detalleOperacion(Map.of(
                        "paciente_id", "PAC-4412",
                        "medico_id", "MED-008",
                        "motivo", "Control general de salud"
                ))
                .build();

        EventoAuditoriaResponse mockResponse = EventoAuditoriaResponse.builder()
                .id("evt_123456")
                .citaId("cita_98a7b6c5")
                .tipoOperacion("CREACION")
                .estadoCita("PENDIENTE")
                .timestamp(Instant.now())
                .ipOrigen("192.168.1.100")
                .hashOperacion("a1b2c3d4e5f6...")
                .resultado("SUCCESS")
                .servicioOrigen("MODULO_A")
                .build();

        when(auditoriaService.registrarEvento(any(RegistroEventoRequest.class))).thenReturn(mockResponse);

        mockMvc.perform(post("/api/auditoria/eventos")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(request)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.status").value("SUCCESS"))
                .andExpect(jsonPath("$.codigo").value(201))
                .andExpect(jsonPath("$.data.citaId").value("cita_98a7b6c5"))
                .andExpect(jsonPath("$.data.tipoOperacion").value("CREACION"))
                .andExpect(jsonPath("$.data.estadoCita").value("PENDIENTE"));
    }

    @Test
    @DisplayName("POST /api/auditoria/eventos - Debe retornar 400 si faltan campos obligatorios")
    void testRegistrarEventoErrorValidacion() throws Exception {
        // Objeto sin citaId ni tipoOperacion
        RegistroEventoRequest requestInvalido = RegistroEventoRequest.builder()
                .estadoCita("PENDIENTE")
                .build();

        mockMvc.perform(post("/api/auditoria/eventos")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(requestInvalido)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.status").value("ERROR"))
                .andExpect(jsonPath("$.codigo").value(400))
                .andExpect(jsonPath("$.detalles").isArray());
    }

    @Test
    @DisplayName("GET /api/auditoria/eventos - Debe listar todos los eventos (200 OK)")
    void testObtenerTodosLosEventos() throws Exception {
        EventoAuditoriaResponse evt1 = EventoAuditoriaResponse.builder()
                .id("evt_1")
                .citaId("cita_98a7b6c5")
                .tipoOperacion("CREACION")
                .estadoCita("PENDIENTE")
                .timestamp(Instant.now())
                .build();

        when(auditoriaService.obtenerTodosLosEventos()).thenReturn(List.of(evt1));

        mockMvc.perform(get("/api/auditoria/eventos"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUCCESS"))
                .andExpect(jsonPath("$.codigo").value(200))
                .andExpect(jsonPath("$.data[0].citaId").value("cita_98a7b6c5"));
    }

    @Test
    @DisplayName("GET /api/auditoria/eventos/cita/{citaId} - Debe retornar traza de una cita específica")
    void testObtenerEventosPorCita() throws Exception {
        EventoAuditoriaResponse evtCreacion = EventoAuditoriaResponse.builder()
                .id("evt_1")
                .citaId("cita_98a7b6c5")
                .tipoOperacion("CREACION")
                .estadoCita("PENDIENTE")
                .timestamp(Instant.now().minusSeconds(600))
                .build();

        EventoAuditoriaResponse evtActualizacion = EventoAuditoriaResponse.builder()
                .id("evt_2")
                .citaId("cita_98a7b6c5")
                .tipoOperacion("ACTUALIZACION_ESTADO")
                .estadoAnterior("PENDIENTE")
                .estadoCita("CONFIRMADA")
                .timestamp(Instant.now())
                .build();

        when(auditoriaService.obtenerEventosPorCita("cita_98a7b6c5"))
                .thenReturn(List.of(evtActualizacion, evtCreacion));

        mockMvc.perform(get("/api/auditoria/eventos/cita/cita_98a7b6c5"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUCCESS"))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[0].tipoOperacion").value("ACTUALIZACION_ESTADO"))
                .andExpect(jsonPath("$.data[1].tipoOperacion").value("CREACION"));
    }

    @Test
    @DisplayName("GET /api/auditoria/eventos/tipo/{tipo} - Debe filtrar eventos por tipo")
    void testObtenerEventosPorTipo() throws Exception {
        EventoAuditoriaResponse evt = EventoAuditoriaResponse.builder()
                .id("evt_3")
                .citaId("cita_11b2c3d4")
                .tipoOperacion("ELIMINACION")
                .estadoCita("ELIMINADA")
                .build();

        when(auditoriaService.obtenerEventosPorTipo("ELIMINACION")).thenReturn(List.of(evt));

        mockMvc.perform(get("/api/auditoria/eventos/tipo/ELIMINACION"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.status").value("SUCCESS"))
                .andExpect(jsonPath("$.data[0].tipoOperacion").value("ELIMINACION"));
    }
}

