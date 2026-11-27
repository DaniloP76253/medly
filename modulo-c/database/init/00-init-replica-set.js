let initialized = true;

try {
  rs.status();
} catch (error) {
  initialized = false;
}

if (!initialized) {
  rs.initiate({
    _id: 'rs0',
    members: [
      { _id: 0, host: 'mongo-1:27017', priority: 2 },
      { _id: 1, host: 'mongo-2:27017', priority: 1 },
      { _id: 2, host: 'mongo-3:27017', priority: 1 }
    ]
  });
}

let primaryReady = false;
for (let attempt = 0; attempt < 60; attempt += 1) {
  try {
    if (db.hello().isWritablePrimary) {
      primaryReady = true;
      break;
    }
  } catch (error) {
    // La elección todavía está en curso.
  }
  sleep(1000);
}

if (!primaryReady) {
  throw new Error('El Replica Set no eligió un primario dentro de 60 segundos.');
}

load('/scripts/init/01-init-audit.js');
print('Replica Set rs0 inicializado y base medly_audit preparada.');

