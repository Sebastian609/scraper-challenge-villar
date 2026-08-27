# Scraper Consulta Pública TRF5 (PJE)

Script en TypeScript que consulta la **Consulta Pública** del TRF5 (PJE), extrae los
procesos de la tabla `fPP:processosTable` y los persiste en `output/processos.json`.

## Requisitos

- **Node.js 22+** (se ejecuta vía *type-stripping* nativo, no requiere compilación).
- Conexión a internet (el scraper accede al sitio `pjett.trf5.jus.br`).

## Clonar el repositorio

```bash
git clone <URL_DEL_REPOSITORIO>
cd scraper-challenge
```

## Instalar dependencias

```bash
npm install
```

## Arrancar

```bash
node src/index.ts
```

Al finalizar se imprimirá en consola el rango de fechas usado, la cantidad de filas
encontradas y la ruta del archivo generado. Los resultados se guardan en:

```
output/processos.json
```

> El directorio `output/` está ignorado en `.gitignore`, por lo que los datos
> generados no se versionan.

## Estructura

El proyecto sigue una arquitectura por capas basada en interfaces. Para más
detalle, consulta [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## Notas

- La búsqueda se realiza para el mes de **agosto del año en curso** (01/08 al 31/08).
- Por defecto se guarda la primera página de resultados (30 registros).
- El sitio requiere un *postback* completo de JSF; por eso el cliente HTTP
  envía el formulario completo con el botón `fPP:searchProcessos`.
