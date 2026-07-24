## 📊 Evidencias de Calidad (QA/DevOps)

- **GitHub Project (tablero de CTQs):** [analisis-de-encuesta](https://github.com/users/MaryG0107/projects/1)
- **Matriz CTQ:** [docs/quality/CTQ.md](docs/quality/CTQ.md)
- **Definition of Done:** [docs/quality/DoD.md](docs/quality/DoD.md)
- **Quality Gate (workflow):** [.github/workflows/quality-gate.yml](.github/workflows/quality-gate.yml)
- **Pull Request de validación:** [#4 - Quality baseline: CTQ, DoD y Quality Gate inicial](https://github.com/MaryG0107/Analizador/pull/4)
- **Resultado del Quality Gate:** ✅ Ejecutado exitosamente (1 successful check) en el PR #4.

### Issues relacionados a CTQs
- [#1 - CTQ-001: Envío confiable del formulario](https://github.com/MaryG0107/Analizador/issues/1)
- [#2 - CTQ-002: Persistencia de datos en base de datos](https://github.com/MaryG0107/Analizador/issues/2)
- [#3 - CTQ-003: Tiempo de carga del panel de resultados](https://github.com/MaryG0107/Analizador/issues/3)



# Analizador de encuestas — version web (multi-usuario)

Aplicacion web con backend real: varias personas pueden capturar encuestas
al mismo tiempo desde distintos navegadores/computadoras, y el dashboard se
actualiza en vivo para todos gracias a Socket.IO.

## Estructura

```
survey-app/
  server/            backend (Node.js + Express + PostgreSQL)
    index.js          punto de entrada, wiring de rutas y Socket.IO
    db.js              acceso a la base de datos PostgreSQL (driver pg)
    parser.js          parser de preguntas desde texto de Word (.docx)
    questionTypes.js   tipos de pregunta (mc / multi / yesno) — extensible
    stats.js           calculo de estadisticas (para exportar)
    routes/            endpoints de la API REST
  public/             frontend (HTML/CSS/JS, sin build step)
    index.html
    app.js
    styles.css
  .env                DATABASE_URL y demas variables de entorno (no se versiona)
```

## Correr en tu computadora

Requisitos: [Node.js](https://nodejs.org) 18 o mas reciente, y una base de datos
PostgreSQL accesible (local o en la nube).

```bash
cd survey-app
cp .env.example .env   # y edita DATABASE_URL, ADMIN_USER, ADMIN_PASSWORD y SESSION_SECRET
npm install
npm start
```

Abre `http://localhost:3000` en tu navegador e inicia sesion con el
`ADMIN_USER`/`ADMIN_PASSWORD` que configuraste en `.env`. Para probar el modo
"multi-usuario", abre la misma URL en dos pestañas o desde otra
computadora en la misma red usando tu IP local
(`http://TU-IP-LOCAL:3000`) — veras el dashboard actualizarse en ambas
al mismo tiempo (cada persona debe iniciar sesion con las mismas credenciales
compartidas).

## Autenticacion

Toda la app (preguntas, captura y analisis) esta protegida por una sesion de
servidor: sin iniciar sesion con `ADMIN_USER`/`ADMIN_PASSWORD`, la API
responde `401` y no se puede leer ni modificar nada (ver `server/auth.js` y
`test/auth.test.js`). Por ahora es un solo usuario compartido por todo el
equipo — roles con permisos distintos por persona queda como mejora futura.

## Subir esto a un hosting (para que varias personas lo usen desde internet)

Cualquiera de estas opciones funciona sin tarjeta de credito para uso
basico:

1. **Render.com** (mas sencillo): crea una cuenta, "New Web Service",
   conecta este codigo (puedes subirlo a un repositorio de GitHub
   primero), Build command `npm install`, Start command `npm start`.
2. **Railway.app**: similar a Render, detecta automaticamente que es un
   proyecto Node.js.
3. **Un VPS propio**: subes la carpeta, corres `npm install && npm start`,
   e idealmente usas `pm2` para mantenerlo corriendo.

La base de datos es PostgreSQL, configurada mediante la variable de entorno
`DATABASE_URL`. En estos hostings puedes usar su addon de Postgres (Render,
Railway) o un proveedor administrado como Neon o Supabase — solo asigna esa
URL de conexión como variable de entorno del servicio.

## Como funciona el tiempo real

Cada vez que alguien crea, edita o borra una pregunta o una respuesta,
el servidor avisa a todos los navegadores conectados por medio de
Socket.IO (`questions:changed`, `responses:changed`, `config:changed`).
Cada navegador vuelve a pedir los datos actualizados y redibuja el
dashboard — asi todos ven los mismos numeros al instante.

## 📊 Evidencias de Calidad (QA/DevOps)

- **GitHub Project (tablero de CTQs):** [analisis-de-encuesta](https://github.com/users/MaryG0107/projects/1)
- **Matriz CTQ:** [docs/quality/CTQ.md](docs/quality/CTQ.md)
- **Definition of Done:** [docs/quality/DoD.md](docs/quality/DoD.md)
- **Quality Gate (workflow):** [.github/workflows/quality-gate.yml](.github/workflows/quality-gate.yml)
- **Pull Request de validación:** [#4 - Quality baseline: CTQ, DoD y Quality Gate inicial](https://github.com/MaryG0107/Analizador/pull/4)
- **Resultado del Quality Gate:** ✅ Ejecutado exitosamente (1 successful check) en el PR #4.

### Issues relacionados a CTQs
- [#1 - CTQ-001: Envío confiable del formulario](https://github.com/MaryG0107/Analizador/issues/1)
- [#2 - CTQ-002: Persistencia de datos en base de datos](https://github.com/MaryG0107/Analizador/issues/2)
- [#3 - CTQ-003: Tiempo de carga del panel de resultados](https://github.com/MaryG0107/Analizador/issues/3)
