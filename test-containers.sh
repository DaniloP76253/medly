#!/usr/bin/env bash

set -Eeuo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"
GATEWAY_URL="${GATEWAY_URL:-http://localhost:8081}"
WAIT_SECONDS="${WAIT_SECONDS:-180}"
KEEP_RUNNING=true

if [[ "${1:-}" == "--down" ]]; then
  KEEP_RUNNING=false
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: Docker no está instalado o no está disponible en PATH." >&2
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "ERROR: Docker Compose v2 no está disponible." >&2
  exit 1
fi

compose() {
  docker compose -f "$COMPOSE_FILE" "$@"
}

cleanup() {
  local exit_code=$?
  if (( exit_code != 0 )); then
    echo
    echo "El test falló. Estado de los contenedores:"
    compose ps || true
    echo
    echo "Últimos logs:"
    compose logs --tail=80 || true
  fi

  if [[ "$KEEP_RUNNING" == false ]]; then
    compose down
  fi

  exit "$exit_code"
}
trap cleanup EXIT

check_http() {
  local method="$1"
  local url="$2"
  local expected_status="$3"
  local payload="${4:-}"
  local response status body

  if [[ -n "$payload" ]]; then
    response="$(curl --silent --show-error \
      --connect-timeout 5 --max-time 15 \
      -X "$method" "$url" \
      -H "Content-Type: application/json" \
      -d "$payload" \
      -w $'\n%{http_code}')"
  else
    response="$(curl --silent --show-error \
      --connect-timeout 5 --max-time 15 \
      -X "$method" "$url" \
      -w $'\n%{http_code}')"
  fi

  status="${response##*$'\n'}"
  body="${response%$'\n'*}"

  if [[ "$status" != "$expected_status" ]]; then
    echo "FAIL: $method $url devolvió HTTP $status; se esperaba $expected_status." >&2
    echo "Respuesta: $body" >&2
    return 1
  fi

  printf 'PASS: %-6s %s (HTTP %s)\n' "$method" "$url" "$status"
  printf '%s' "$body"
}

echo "Validando configuración de Docker Compose..."
compose config -q

echo "Levantando y construyendo los contenedores..."
compose up -d --build

echo "Esperando contenedores saludables (máximo ${WAIT_SECONDS}s)..."
deadline=$((SECONDS + WAIT_SECONDS))
services=(db-relacional modulo-b atlas-local modulo-c modulo-a)

while (( SECONDS < deadline )); do
  all_healthy=true
  for service in "${services[@]}"; do
    health="$(compose ps -q "$service" | xargs -r docker inspect \
      --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}sin-healthcheck{{end}}')"
    if [[ "$health" != "healthy" ]]; then
      all_healthy=false
      break
    fi
  done

  if [[ "$all_healthy" == true ]]; then
    break
  fi
  sleep 3
done

if [[ "$all_healthy" != true ]]; then
  echo "ERROR: los contenedores no llegaron a healthy dentro del tiempo límite." >&2
  compose ps
  exit 1
fi

echo "Todos los contenedores están saludables."

test_id="test-$(date +%s)"
create_payload="$(cat <<JSON
{
  "paciente_id": "PAC-TEST",
  "medico_id": "MED-TEST",
  "fecha_hora": "2026-10-20T10:30:00Z",
  "motivo": "Prueba automática de contenedores ${test_id}"
}
JSON
)"

echo
echo "Probando flujo integrado a través del gateway ($GATEWAY_URL)..."
create_response="$(check_http POST "$GATEWAY_URL/api/citas" 201 "$create_payload")"
cita_id="$(printf '%s' "$create_response" | sed -nE 's/.*"cita_id"[[:space:]]*:[[:space:]]*"([^"]+)".*/\1/p' | head -n1)"

if [[ -z "$cita_id" ]]; then
  echo "FAIL: la respuesta de creación no contiene data.cita_id." >&2
  echo "Respuesta: $create_response" >&2
  exit 1
fi
echo "      Cita creada: $cita_id"

check_http PATCH "$GATEWAY_URL/api/citas/$cita_id/estado" 200 \
  '{"nuevo_estado":"CONFIRMADA","observacion":"Prueba automática"}' >/dev/null

check_http DELETE "$GATEWAY_URL/api/citas/$cita_id" 200 >/dev/null

echo
echo "Verificando que el gateway rechace datos inválidos..."
check_http POST "$GATEWAY_URL/api/citas" 400 '{"paciente_id":"incompleto"}' >/dev/null

echo
echo "OK: los contenedores y el flujo integrado funcionan correctamente."
