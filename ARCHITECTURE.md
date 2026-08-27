# Arquitectura del Proyecto

Scraper de consulta pública del TRF5 (PJE). El objetivo es recuperar los procesos
de la tabla `fPP:processosTable` y persistirlos en `output/processos.json`.

El código sigue una arquitectura por capas basada en interfaces y separación de
responsabilidades. Cada capa tiene una única razón de cambio y se comunica con las
demás únicamente a través de contratos (`interfaces`), no de implementaciones
concretas.

---

## Capas

### `src/types/` — Contratos y modelo de dominio

Define **qué** es el sistema, no cómo funciona. Aquí viven las interfaces que
describen el comportamiento esperado de cada componente (`IHttpClient`,
`IProcessoParser`, `IFileWriter`, `IScrapeProcessosUseCase`) y el modelo de datos
(`Processo`, `DateRange`, `FormContext`).

**Utilidad:** es el lenguaje común del proyecto. Las demás capas dependen de estos
tipos, no unas de otras.

**Justificación:** al aislar los contratos en su propia capa, el acoplamiento se
invierte (dependencia hacia la abstracción). Cambiar una implementación concreta no
obliga a tocar el resto del sistema, y el dominio queda desacoplado de detalles
técnicos como `axios` o `cheerio`.

### `src/utils/` — Lógica pura y reutilizable

Funciones y utilidades transversales:

- `date.util.ts` — cálculo del rango del mes actual (`augustRange`).
- `concurrency.util.ts` — `mapWithLimit` para ejecutar tareas con concurrencia acotada.
- `config.util.ts` — `loadConfig()` lee los parámetros de comportamiento desde
  `process.env` (`DELAY_MS`, `CONCURRENCY`, `TIMEOUT_MS`, `JITTER_MS`).
- `sleep.util.ts` — `sleep(ms)`.
- `rate-limiter.util.ts` — `RateLimiter` encadena las peticiones para respetar un
  intervalo mínimo (`DELAY_MS` + jitter) entre ellas, evitando saturar el sitio.
- `logger.util.ts` — singleton `log` con `info/warn/error`; escribe con timestamp en
  consola **y** en `output/logs/scraper-YYYY-MM-DD.log`.

**Utilidad:** encapsulan reglas de negocio pequeñas, control de ritmo y registro,
testeables de forma aislada.

**Justificación:** mantener esta lógica fuera de las clases de servicio evita
duplicación y facilita pruebas sin mocks. Es correcto porque son operaciones
independientes del origen de los datos.

### `src/services/` — Implementaciones de infraestructura

Clases concretas que implementan las interfaces de `types`:
`HttpClient` (acceso HTTP con `RateLimiter`, reintentos para `429`/`503` respetando
`Retry-After`, y logging por petición),
`ProcessoParser` (extracción y parseo del HTML) y `JsonFileWriter` (persistencia
en disco).

**Utilidad:** es la única capa que sabe hablar con el exterior (HTTP, HTML,
sistema de archivos). El resto del sistema solo ve abstracciones.

**Justificación:** agrupar la infraestructura detrás de interfaces es el patrón
*Dependency Inversion*. Permite sustituir `HttpClient` por un stub en tests, o
cambiar `cheerio` por otro parser, sin modificar el caso de uso. Es correcto
porque contiene todo lo volátil (librerías de terceros, formatos externos).

### `src/use-cases/` — Orquestación del caso de uso

Contiene `ScrapeProcessosUseCase`, que coordina las capas anteriores para
cumplir el objetivo de negocio: obtener la página, construir la búsqueda, enviarla
y guardar el resultado.

**Utilidad:** expresa el flujo de alto nivel en un solo lugar, mediante inyección
de dependencias, sin importar cómo se implementa cada paso.

**Justificación:** el caso de uso es el núcleo de la aplicación y no debe contener
detalles técnicos. Al recibir sus dependencias por constructor, queda desacoplado
de la infraestructura y es fácil de leer, mantener y probar. Es correcto porque
centraliza el "qué hacer" sin saber el "cómo".

### `src/index.ts` — Punto de entrada (composition root)

Único lugar donde se instancian las implementaciones concretas y se cablean con el
caso de uso. Luego invoca `execute()`.

**Utilidad:** ensambla el grafo de dependencias y arranca la ejecución.

**Justificación:** concentrar la composición aquí evita que las capas internas
decidan sus propias dependencias (lo que las acoplaría). Es correcto porque el
punto de entrada es el lugar natural donde el conocimiento de las implementaciones
concretas es aceptable y acotado.

**Ejecución:** el proyecto se corre con `npm run start` (equivalente a `npm start` /
`node src/index.ts`, vía *type-stripping* de Node 22, sin compilación). Scripts
disponibles en `package.json`:

- `npm run start` — ejecución normal del scrape.
- `npm run scrape` — alias de la ejecución normal.
- `npm run retry` — reintenta solo los documentos/detalles fallidos
  (equivale a `RETRY_FAILED=1 npm run start`).

Toda la configuración de comportamiento (delays, concurrencia, reintentos, timeouts)
se pasa por variables de entorno; ver `README.md`.

---

## Flujo de dependencias

```
index.ts  ──>  use-cases  ──>  (interfaces en) types
   │                │
   └─ instancia ──> services ──> types
                    utils ──> types
```

Las flechas apuntan en la dirección de la invocación, pero todas las capas dependen
de `types` (abstracción), nunca de `services` de forma directa. Esto garantiza que
el dominio y la orquestación no dependan de detalles de infraestructura.

---

## Por qué esta arquitectura es correcta

- **Separación de responsabilidades:** cada capa tiene una única razón para cambiar.
- **Inversión de dependencias:** el caso de uso no conoce `axios`, `cheerio` ni `fs`.
- **Testeabilidad:** cualquier servicio puede ser reemplazado por un doble (stub/mock).
- **Mantenibilidad:** cambiar el portal, el formato de salida o el parser no afecta
  la lógica de orquestación.
- **Claridad:** el lector entiende el sistema leyendo `use-cases` y `types`, sin
  necesidad de revisar la implementación técnica.
