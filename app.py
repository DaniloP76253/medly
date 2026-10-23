import os
import sys

# Permitir ejecutar app.py tanto desde la raíz de medly como desde modulo-b/
modulo_b_dir = os.path.join(os.path.dirname(__file__), "modulo-b")
if modulo_b_dir not in sys.path:
    sys.path.insert(0, modulo_b_dir)

from app import app  # noqa: F401

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=5000, reload=True)
