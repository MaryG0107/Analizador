# Matriz CTQ - Critical to Quality

| ID | Necesidad del usuario/negocio | CTQ | Métrica | Umbral aceptable | Evidencia | Prioridad | Issue |
|---|---|---|---|---|---|---|---|
| CTQ-001 | El usuario necesita llenar la encuesta rápido y sin errores | Envío confiable del formulario | % de envíos exitosos | >= 98% en pruebas funcionales | Test de envío + PR | Must | #1 |
| CTQ-002 | El usuario espera que sus respuestas no se pierdan | Persistencia de datos en base de datos | % de respuestas guardadas correctamente | 100% de datos guardados sin duplicados ni pérdidas | Prueba de guardado en data.sqlite | Must | #2 |
| CTQ-003 | El administrador necesita ver resultados rápido | Tiempo de carga del panel de resultados | p95 de tiempo de respuesta del endpoint de resultados | <= 2 segundos | Evidencia de ejecución / prueba de carga | Should | #3 |

## Reglas de trazabilidad
- Cada CTQ deberá tener un issue asociado.
- Cada issue deberá indicar evidencia esperada.
- Ningún CTQ Must podrá cerrarse sin cumplir el DoD.
