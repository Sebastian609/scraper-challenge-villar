# Flujo del Scraping - PJe TRF5

## Resumen

Este scraper extrae procesos judiciales del portal de consulta publica del **TRF5** (Tribunal Regional Federal da 5a Regiao) usando peticiones HTTP puras, sin navegador. Simula un formulario JSF/Seam enviando los campos ocultos (`javax.faces.ViewState`, cookies de sesion) que el servidor espera.

**Target:** `https://pjett.trf5.jus.br/pjeconsulta/ConsultaPublica/listView.seam`

**Stack:** Node.js 22+ (TypeScript sin compilacion), axios, cheerio.

---

## Diagrama de Flujo

```
┌─────────────────────────────────────────────────────────┐
│  1. Carga de configuracion y dependencias               │
│     index.ts                                            │
│     loadConfig() -> instantiate services -> execute()   │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  2. GET pagina de busqueda                              │
│     GET /ConsultaPublica/listView.seam                  │
│     Extrae: javax.faces.ViewState, currentDate, cookie │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  3. POST formulario JSF (busqueda)                      │
│     Reenvia todos los campos del form#fPP               │
│     Override: rango de fechas (01/08 - 31/08)           │
│     Content-Type: application/x-www-form-urlencoded     │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  4. Parseo de la tabla de resultados                    │
│     Selector: #fPP\:processosTable tbody tr             │
│     Resultado: array de 30 procesos                     │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  5. Fetch secuencial de paginas de detalle              │
│     Para cada proceso: GET DetalleProcessoConsulta     │
│     Extrae: partes, movimientos, documentos            │
│     (30 requests secuenciales con rate limiting)        │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  6. Descarga concurrente de PDFs (3 en paralelo)       │
│     Por cada documento:                                 │
│       a) GET pagina del documento                       │
│       b) POST form de descarga (ViewState + tokens)     │
│       c) Validar magic bytes %PDF                       │
│       d) Guardar en output/documents/                   │
└──────────────────────┬──────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────┐
│  7. Guardado de resultados                              │
│     output/processos.json (30 procesos con detalles)    │
│     output/documents/*.pdf (138 PDFs)                   │
│     output/failed.json (solo si hay fallos)             │
└─────────────────────────────────────────────────────────┘
```

---

## Paso 1: Inicializacion

**Archivo:** `src/index.ts`

1. `loadConfig()` carga variables de entorno desde `.env` con valores por defecto.
2. Inicializa el logger con archivo de log en `output/logs/scraper-YYYY-MM-DD.log`.
3. Crea el grafo de dependencias con inyeccion manual:
   ```
   HttpClient -> ProcessoParser -> JsonFileWriter -> ScrapeProcessosUseCase
   ```
4. Ejecuta `useCase.execute()`.

---

## Paso 2: Carga de la Pagina de Busqueda

**Metodo:** `HttpClient.get()` -> `ProcessoParser.extractFormContext()`

- **Request:** `GET /ConsultaPublica/listView.seam`
- **Extrae del HTML:**
  - `javax.faces.ViewState` desde `form#fPP input[name="javax.faces.ViewState"]`
  - `currentDate` desde el campo de fecha oculto
- **Cookie:** Se captura `Set-Cookie` de la respuesta para mantener la sesion.

El `ViewState` es un token de JSF que el servidor genera por sesion. Sin el valido, el POST siguiente sera rechazado.

---

## Paso 3: Envio del Formulario de Busqueda

**Metodo:** `ProcessoParser.buildSearchFields()` -> `HttpClient.post()`

El scraper reconstruye el formulario completo del HTML original (`form#fPP`), recolectando **todos** los campos `input`, `select` y `textarea`, luego sobreescribe:

| Campo | Valor |
|-------|-------|
| `fPP:dataAutuacaoDecoration:dataAutuacaoInicioInputDate` | `01/08/YYYY` |
| `fPP:dataAutuacaoDecoration:dataAutuacaoFimInputDate` | `31/08/YYYY` |
| `javax.faces.ViewState` | Token extraido en paso 2 |
| `fPP:searchProcessos` | Trigger del boton de busqueda |

El body se envia como `application/x-www-form-urlencoded` con los headers de sesion y Referer.

---

## Paso 4: Parseo de Resultados

**Metodo:** `ProcessoParser.parseResults()`

Busca la tabla `#fPP\:processosTable tbody tr` y para cada fila extrae:

| Campo | Fuente |
|-------|--------|
| `numeroProcesso` | Texto en negrita (`<b>`) del `<td>` central |
| `numero` | Regex `\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}` sobre el numero |
| `clase` | Texto antes del enlace en el `<td>` central |
| `descripcion` | Texto despues de " - " en el `<b>` |
| `partes` | Texto despues del enlace en el `<td>` central |
| `ultimaMovimentacao` | `<td>` tercero |
| `detalheUrl` | Hash `ca=...` extraido del `onclick` del primer `<a>` |

Resultado tipico: **30 procesos** (una sola pagina, sin paginacion).

---

## Paso 5: Fetch de Detalles

**Metodo:** `ScrapeProcessosUseCase.fetchDetail()` -> `ProcessoParser.parseDetail()`

Para cada uno de los 30 procesos, hace un `GET` secuencial a su URL de detalle:

```
GET /ConsultaPublica/DetalheProcessoConsultaPublica/listView.seam?ca=<hash>
```

El parser extrae tres tipos de datos:

### Partes
- Selectores: `#processoPartesPoloAtivoResumidoList` y `#processoPartesPoloPassivoResumidoList`
- Campos: `nome`, `tipo`, `situacao`, `polo` (Ativo/Passivo)

### Movimientos
- Selector: `#j_id146:processoEvento` o `processoEvento*tb`
- Cada fila: `"DD/MM/YYYY HH:MM:SS - descripcion"`

### Documentos
- Links con `onclick` que contiene `documentoSemLoginHTML.seam` y `idProcessoDoc=<id>`
- Campos: `descricao`, `docUrl`, `idProcessoDoc`

Las 30 consultas se ejecutan **secuencialmente** con rate limiting entre cada una.

---

## Paso 6: Descarga de PDFs

**Metodo:** `ScrapeProcessosUseCase.downloadDocuments()` -> `downloadOne()`

Aplana todos los documentos de todos los procesos y los descarga con **concurrencia limitada** (default: 3 en paralelo) usando `mapWithLimit()`.

Para cada documento:

1. **GET** la pagina del documento (`documentoSemLoginHTML.seam`) para obtener tokens frescos de sesion.
2. **Parsea** el form de descarga (`parseDocumentDownload()`) que extrae:
   - `ca` y `idProcDocBin` del `onclick` del boton `downloadPDF`
   - `viewState` y `action` del form `#j_id42`
3. **POST** el form de descarga con los campos:
   ```
   j_id42, javax.faces.ViewState, j_id42:downloadPDF, ca, idProcDocBin
   ```
4. **Valida** que la respuesta empiece con `%PDF` (magic bytes).
5. **Guarda** el binario en `output/documents/{numero}__{idProcessoDoc}.pdf`.
6. Actualiza `documento.arquivo` con la ruta local.

---

## Paso 7: Guardado

- **`output/processos.json`**: Array de 30 objetos `Processo` con todos los detalles anidados y rutas de archivos.
- **`output/documents/*.pdf`**: 138 archivos PDF individuales.
- **`output/failed.json`**: Solo se genera si hubo fallos. Contiene arrays `detalles` y `documentos` con el motivo de cada fallo.
- **`output/logs/scraper-YYYY-MM-DD.log`**: Log detallado de cada operacion HTTP.

---

## Paso 8: Modo Retry (Opcional)

**Comando:** `npm run retry`

Cuando se ejecuta con `RETRY_FAILED=1`:

1. Lee `output/processos.json` y `output/failed.json`.
2. Obtiene una nueva sesion (cookie) haciendo GET a la pagina de busqueda.
3. Para cada fallo de **detalle**: re-intenta el fetch del detalle.
4. Para cada fallo de **documento**: re-consulta el detalle para obtener una URL fresca (el token `ca` es de sesion) y re-intenta la descarga.
5. Actualiza ambos archivos JSON con los resultados.

---

## Arquitectura

```
src/
├── index.ts                          # Entry point, composicion de dependencias
├── types/
│   ├── processo.type.ts              # Modelos de datos (Processo, Parte, etc.)
│   └── scraper.interface.ts          # Contratos (IHttpClient, IProcessoParser, etc.)
├── services/
│   ├── http-client.ts                # Cliente HTTP (axios + retry + rate limit)
│   ├── processo-parser.ts            # Parser HTML (cheerio)
│   └── json-file-writer.ts           # Escritura de archivos
├── use-cases/
│   └── scrape-processos.use-case.ts  # Orquestacion principal
└── utils/
    ├── config.util.ts                # Configuracion desde .env
    ├── date.util.ts                  # Rango de fechas (agosto)
    ├── concurrency.util.ts           # mapWithLimit para concurrencia acotada
    ├── rate-limiter.util.ts          # Rate limiter por token bucket
    ├── sleep.util.ts                 # Sleep basado en Promises
    └── logger.util.ts                # Logger dual (consola + archivo)
```

**Patron:** Arquitectura limpia por capas con Dependency Inversion. Los contratos estan en `types/`, las implementaciones en `services/`, y la orquestacion en `use-cases/`.

---

## Modelos de Datos

```typescript
interface Processo {
  numeroProcesso: string;      // Ej: "PUILCiv 0000619-36.2021.4.05.8109"
  numero: string;              // Ej: "0000619-36.2021.4.05.8109"
  classe: string;              // Tipo de proceso
  descricao: string;           // Descripcion/materia
  partes: string;              // Resumen de partes
  ultimaMovimentacao: string;  // Ultimo movimiento
  detalheUrl: string;          // URL al detalle (con token ca)
  detalhe?: ProcessoDetalhe;   // Detalle completo (poblado despues)
}

interface ProcessoDetalhe {
  partes: Parte[];
  movimentacoes: Movimentacao[];
  documentos: Documento[];
}

interface Parte {
  nome: string;
  tipo: string;
  situacao: string;
  polo: "Ativo" | "Passivo";
}

interface Movimentacao {
  data: string;       // Ej: "02/02/2023 18:27:05"
  descricao: string;
}

interface Documento {
  descricao: string;
  docUrl: string;
  idProcessoDoc: string;
  archivo?: string;   // Ruta local despues de descargar
}
```

---

## Configuracion

| Variable | Default | Descripcion |
|----------|---------|-------------|
| `DELAY_MS` | `1000` | Intervalo minimo entre requests HTTP (ms) |
| `JITTER_MS` | `200` | Delay aleatorio adicional (0 a jitterMs) |
| `CONCURRENCY` | `3` | Maximo de descargas de PDF en paralelo |
| `TIMEOUT_MS` | `30000` | Timeout de axios (ms) |
| `MAX_RETRIES` | `3` | Reintentos en HTTP 429/503 |
| `BACKOFF_MS` | `1000` | Base para backoff exponencial: `BACKOFF_MS * 2^(attempt-1)` |
| `RETRY_FAILED` | (unset) | Set a `"1"` para solo reintentar fallos |

**Comandos npm:**
- `npm run start` / `npm run scrape`: Ejecucion normal
- `npm run retry`: Solo reintentar fallos

---

## Mecanismos de Resiliencia

### Rate Limiting (`src/utils/rate-limiter.util.ts`)
Implementacion tipo token bucket que encadena promesas. Garantiza al menos `DELAY_MS + random(0, jitterMs)` milisegundos entre cualquier par de requests HTTP, incluyendo reintentos.

### Retry con Backoff Exponencial (`src/services/http-client.ts`)
Solo reintentable en HTTP **429** (Too Many Requests) y **503** (Service Unavailable). Si el servidor envia header `Retry-After`, lo respeta. Si no, usa `BACKOFF_MS * 2^(attempt-1)`.

### Validacion de PDFs
Cada buffer descargado se valida comparando los primeros 4 bytes contra `%PDF`. Si no coincide, se registra como fallo y no se guarda el archivo corrupto.

### Sesion
Las cookies se capturan del header `Set-Cookie` en el primer GET y se reenvian en todos los requests subsecuentes. Los tokens `ca` de los documentos son de sesion, por eso en retry se re-consulta el detalle para obtener URLs frescas.

---

## Ejecucion Real (referencia)

| Metrica | Valor |
|---------|-------|
| Fecha | 2026-08-27 |
| Duracion | ~8 minutos |
| Rango buscado | 01/08/2026 - 31/08/2026 |
| Procesos encontrados | 30 |
| Detalles obtenidos | 30/30 (100%) |
| PDFs descargados | 138/138 (100%) |
| Fallos | 0 |
