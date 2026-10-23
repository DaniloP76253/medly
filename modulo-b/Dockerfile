FROM python:3.11-slim

WORKDIR /app

# Instalar dependencias del sistema requeridas para psycopg2 y utilidades
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    libpq-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# El módulo B se ejecuta en el puerto 5000 según especificación de red interna
EXPOSE 5000

CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5000"]
