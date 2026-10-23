#!/usr/bin/env bash
# ==============================================================================
# Script de pruebas automatizadas para Medly - Módulo C
# Valida la interacción con las operaciones de Módulo B (Crear, Actualizar, Eliminar)
# ==============================================================================

set -euo pipefail

BASE_URL="${1:-http://localhost:6000/api/auditoria}"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}================================================================${NC}"
echo -e "${BLUE}    EJECUTANDO PRUEBAS DE AUDITORÍA - MÓDULO C (Puerto 6000)   ${NC}"
echo -e "${BLUE}    URL Base: ${BASE_URL}${NC}"
echo -e "${BLUE}================================================================${NC}\n"

check_response() {
    local status_code="$1"
    local expected="$2"
    local test_name="$3"
    
    if [ "$status_code" -eq "$expected" ]; then
        echo -e "  [${GREEN}PASS${NC}] $test_name (HTTP $status_code)"
    else
        echo -e "  [${RED}FAIL${NC}] $test_name (Esperado: $expected, Obtenido: $status_code)"
    fi
}

# ------------------------------------------------------------------------------
# 1. Registrar evento de creación (Endpoint 1: POST /api/citas en Modulo A & B)
# ------------------------------------------------------------------------------
echo -e "${YELLOW}1. Simulando Notificación: Creación de Cita (Módulo B -> C)...${NC}"
RESPONSE_1=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/eventos" \
  -H "Content-Type: application/json" \
  -d '{
    "citaId": "cita_test_001",
    "tipoOperacion": "CREACION",
    "estadoCita": "PENDIENTE",
    "resultado": "SUCCESS",
    "ipOrigen": "192.168.1.50",
    "servicioOrigen": "MODULO_A",
    "detalleOperacion": {
      "paciente_id": "PAC-4412",
      "medico_id": "MED-008",
      "fecha_hora": "2026-10-20T10:30:00Z",
      "motivo": "Control general de salud"
    }
  }')

CODE_1=$(echo "$RESPONSE_1" | tail -n1)
BODY_1=$(echo "$RESPONSE_1" | sed '$d')
check_response "$CODE_1" 201 "Registro evento de creación"
echo "  Respuesta: $BODY_1"
echo ""

# ------------------------------------------------------------------------------
# 2. Registrar evento de actualización de estado (Endpoint 2: PATCH /api/citas/{id}/estado)
# ------------------------------------------------------------------------------
echo -e "${YELLOW}2. Simulando Notificación: Cambio de Estado (Módulo B -> C)...${NC}"
RESPONSE_2=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/eventos" \
  -H "Content-Type: application/json" \
  -d '{
    "citaId": "cita_test_001",
    "tipoOperacion": "ACTUALIZACION_ESTADO",
    "estadoCita": "CONFIRMADA",
    "estadoAnterior": "PENDIENTE",
    "resultado": "SUCCESS",
    "ipOrigen": "192.168.1.50",
    "servicioOrigen": "MODULO_A",
    "detalleOperacion": {
      "nuevo_estado": "CONFIRMADA",
      "observacion": "Paciente confirmó asistencia vía telefónica"
    }
  }')

CODE_2=$(echo "$RESPONSE_2" | tail -n1)
BODY_2=$(echo "$RESPONSE_2" | sed '$d')
check_response "$CODE_2" 201 "Registro evento de actualización de estado"
echo "  Respuesta: $BODY_2"
echo ""

# ------------------------------------------------------------------------------
# 3. Registrar evento de eliminación (Endpoint 3: DELETE /api/citas/{id})
# ------------------------------------------------------------------------------
echo -e "${YELLOW}3. Simulando Notificación: Eliminación de Cita (Módulo B -> C)...${NC}"
RESPONSE_3=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/eventos" \
  -H "Content-Type: application/json" \
  -d '{
    "citaId": "cita_test_001",
    "tipoOperacion": "ELIMINACION",
    "estadoCita": "ELIMINADA",
    "estadoAnterior": "CONFIRMADA",
    "resultado": "SUCCESS",
    "ipOrigen": "192.168.1.50",
    "servicioOrigen": "MODULO_A",
    "detalleOperacion": {
      "eliminado_en": "2026-10-22T20:27:00Z"
    }
  }')

CODE_3=$(echo "$RESPONSE_3" | tail -n1)
BODY_3=$(echo "$RESPONSE_3" | sed '$d')
check_response "$CODE_3" 201 "Registro evento de eliminación"
echo "  Respuesta: $BODY_3"
echo ""

# ------------------------------------------------------------------------------
# 4. Validar consulta de traza de auditoría por cita
# ------------------------------------------------------------------------------
echo -e "${YELLOW}4. Consultando Traza Completa de la Cita 'cita_test_001'...${NC}"
RESPONSE_4=$(curl -s -w "\n%{http_code}" -X GET "${BASE_URL}/eventos/cita/cita_test_001")
CODE_4=$(echo "$RESPONSE_4" | tail -n1)
BODY_4=$(echo "$RESPONSE_4" | sed '$d')
check_response "$CODE_4" 200 "Consulta de traza por ID de cita"
echo "  Traza obtenida: $BODY_4"
echo ""

# ------------------------------------------------------------------------------
# 5. Prueba de validación (Error 400 por payload inválido)
# ------------------------------------------------------------------------------
echo -e "${YELLOW}5. Validando rechazo de payload inválido (Esperado 400)...${NC}"
RESPONSE_5=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/eventos" \
  -H "Content-Type: application/json" \
  -d '{"estadoCita": "PENDIENTE"}')
CODE_5=$(echo "$RESPONSE_5" | tail -n1)
BODY_5=$(echo "$RESPONSE_5" | sed '$d')
check_response "$CODE_5" 400 "Manejo de error de validación (Bad Request)"
echo "  Detalle de error: $BODY_5"
echo ""

echo -e "${GREEN}================================================================${NC}"
echo -e "${GREEN}    TODAS LAS PRUEBAS DE MÓDULO C HAN FINALIZADO               ${NC}"
echo -e "${GREEN}================================================================${NC}"

