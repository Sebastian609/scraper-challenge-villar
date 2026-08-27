# Scraper Consulta Pública TRF5 (PJE)

Script en TypeScript que consulta la **Consulta Pública** del TRF5 (PJE), extrae los
procesos de la tabla `fPP:processosTable` y los persiste en `output/processos.json`.

## Requisitos

- **Node.js 22+** (se ejecuta vía *type-stripping* nativo, no requiere compilación).
- Conexión a internet (el scraper accede al sitio `pjett.trf5.jus.br`).

## Clonar el repositorio

```bash
git clone https://github.com/Sebastian609/scraper-challenge-villar
cd scraper-challenge-villar
```

## Instalar dependencias

```bash
npm install
```

## Configuración del entorno (`.env`)

El scraper lee su configuración desde variables de entorno. Se incluye una plantilla
`.env.example` (versionada) que debes copiar a `.env` (ignorado por git) y ajustar:

```bash
cp .env.example .env
```

Los scripts (`npm run start`, `npm run scrape`, `npm run retry`) cargan `.env`
automáticamente vía la flag nativa `--env-file=.env` de Node 22. Si prefieres otra
forma, también puedes exportar las variables manualmente.

> `.env` está en `.gitignore`; nunca se sube al repositorio. `.env.example` sí se
> versiona como referencia de todas las variables disponibles.

## Arrancar

```bash
npm run start
```

> Equivale a `npm start` y a `node src/index.ts`. Se ejecuta con el *type-stripping*
> nativo de Node 22 (no requiere compilación previa).

Al finalizar se imprimirá en consola el rango de fechas usado, la cantidad de filas
encontradas y la ruta del archivo generado. Los resultados se guardan en:

```
output/processos.json
```

### Configuración (variables de entorno)

El scraper es **respetuoso con el sitio**: espacia las peticiones HTTP y limita la
concurrencia para no saturarlo. Todos los parámetros son opcionales y tienen defaults:

| Variable       | Default | Descripción                                                      |
| -------------- | ------- | ---------------------------------------------------------------- |
| `DELAY_MS`     | `1000`  | Intervalo mínimo entre peticiones HTTP (más jitter).              |
| `JITTER_MS`    | `200`   | Demora aleatoria extra añadida a `DELAY_MS`.                      |
| `CONCURRENCY`  | `3`     | Descargas de PDF en paralelo.                                     |
| `TIMEOUT_MS`   | `30000` | Timeout de cada petición axios.                                   |
| `MAX_RETRIES`  | `3`     | Reintentos ante respuestas `429`/`503`.                           |
| `BACKOFF_MS`   | `1000`  | Base del backoff exponencial (`BACKOFF_MS * 2^(intento-1)`).      |

Ante un `429` (Too Many Requests) o `503` (Service Unavailable), el scraper reintenta
hasta `MAX_RETRIES` veces. Si el servidor envía la cabecera `Retry-After`, se respeta
ese tiempo; de lo contrario usa backoff exponencial. Toda petición (incluidos los
reintentos) respeta el `RateLimiter`, por lo que el reintento también es "polite".

### Reintentos y registro de fallos

Si tras la corrida algún documento o detalle no pudo obtenerse (errores de red, 429
agotados, respuesta no PDF), se registran en `output/failed.json` con su identificador
y motivo. Para reintentar **solo** lo fallado en una segunda corrida:

```bash
npm run retry
# equivalente a: RETRY_FAILED=1 npm run start
```

El modo reintento lee `output/processos.json` + `output/failed.json`, reintenta los
documentos/detalles pendientes y actualiza ambos archivos (los que sigan fallando
quedan en `failed.json` para un nuevo intento).

> El resultado de la búsqueda es una **sola página** (30 procesos, sin paginación), por
> lo que no es necesario iterar páginas adicionales.

Ejemplo de ejecución normal:

```bash
DELAY_MS=500 CONCURRENCY=2 MAX_RETRIES=3 npm run start
# o bien: npm run scrape
```

### Logs

Cada acción se registra con timestamp y contador de progreso, tanto en **consola**
como en un archivo de texto dentro de `output/logs/`:

```
output/logs/scraper-YYYY-MM-DD.log
```

> El directorio `output/` está ignorado en `.gitignore`, por lo que los datos
> y los logs generados no se versionan.

## Estructura

El proyecto sigue una arquitectura por capas basada en interfaces. Para más
detalle, consulta [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Flujo del Scraping

El scraper extrae procesos judiciales del portal PJe TRF5 usando peticiones HTTP
puras (sin navegador), simulando formularios JSF/Seam. El flujo completo es:

```
┌─────────────────────────────────────────────────────────┐
│  1. Carga de configuracion y dependencias               │
│     loadConfig() -> instantiate services -> execute()   │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  2. GET pagina de busqueda                              │
│     Extrae: javax.faces.ViewState, currentDate, cookie │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  3. POST formulario JSF (busqueda)                      │
│     Reenvia todos los campos del form#fPP               │
│     Override: rango de fechas (01/08 - 31/08)           │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  4. Parseo de la tabla de resultados                    │
│     Selector: #fPP\:processosTable tbody tr             │
│     Resultado: array de 30 procesos                     │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  5. Fetch secuencial de paginas de detalle              │
│     Para cada proceso: GET DetalleProcessoConsulta     │
│     Extrae: partes, movimientos, documentos            │
│     (30 requests secuenciales con rate limiting)        │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  6. Descarga concurrente de PDFs (3 en paralelo)       │
│     GET pagina documento -> POST form descarga          │
│     -> Validar %PDF -> Guardar en output/documents/     │
└──────────────────────┬──────────────────────────────────┘
                       ▼
┌─────────────────────────────────────────────────────────┐
│  7. Guardado de resultados                              │
│     output/processos.json + output/documents/*.pdf      │
│     output/failed.json (solo si hay fallos)             │
└─────────────────────────────────────────────────────────┘
```

### Paso 1: Inicializacion

`loadConfig()` carga variables de entorno desde `.env`. Se crea el grafo de
dependencias con inyeccion manual: `HttpClient` -> `ProcessoParser` ->
`JsonFileWriter` -> `ScrapeProcessosUseCase`.

### Paso 2: Carga de la pagina de busqueda

`GET /ConsultaPublica/listView.seam` para extraer el token `javax.faces.ViewState`
(requerido por JSF para validar postbacks) y la cookie de sesion.

### Paso 3: Envio del formulario de busqueda

Reconstruye el formulario `form#fPP` completo (todos los campos ocultos) y
sobreescribe las fechas al rango agosto. Se envia como
`application/x-www-form-urlencoded` con el ViewState y la cookie de sesion.

### Paso 4: Parseo de resultados

Parsea la tabla HTML con cheerio. De cada fila extrae: numero de proceso, clase,
descripcion, partes, ultima movimentacion y la URL de detalle (hash `ca` del
`onclick`). Resultado tipico: **30 procesos** (una pagina, sin paginacion).

### Paso 5: Fetch de detalles

Para cada proceso, `GET` secuencial a su pagina de detalle. El parser extrae:
**partes** (polo activo/pasivo), **movimientos** (fecha + descripcion) y
**documentos** (links con `idProcessoDoc` para descarga posterior).

### Paso 6: Descarga de PDFs

Concurrencia limitada (default: 3 en paralelo) via `mapWithLimit()`. Por cada
documento: GET la pagina -> parsear tokens de descarga -> POST el form -> validar
`%PDF` magic bytes -> guardar en `output/documents/{numero}__{id}.pdf`.

### Paso 7: Guardado

Escribe `output/processos.json` con los 30 procesos y todos sus detalles anidados.
Los PDFs quedan en `output/documents/`. Si hubo fallos, genera `output/failed.json`.

### Modo retry

`npm run retry` reintenta solo los elementos fallidos leyendo `failed.json`.
Re-consulta el detalle para obtener tokens de sesion frescos antes de re-intentar
descargas de PDF.

Para mas detalles, consulta [`SCRAPING_FLOW.md`](./SCRAPING_FLOW.md).

## Notas

- La búsqueda se realiza para el mes de **agosto del año en curso** (01/08 al 31/08).
- La búsqueda devuelve una **sola página de 30 procesos**, sin paginación adicional.
- El sitio requiere un *postback* completo de JSF; por eso el cliente HTTP
  envía el formulario completo con el botón `fPP:searchProcessos`.
