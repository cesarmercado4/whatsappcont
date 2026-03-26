# WhatsApp Conversaciones Dashboard

Sistema para registrar mensajes entrantes de WhatsApp y medir conversaciones unicas por dia, mes y anio.

## Objetivo

Una conversacion se considera unica por la combinacion:

`telefono + fecha`

Ejemplo:
- Si `2302456789` envia 8 mensajes el mismo dia, cuenta como 1 conversacion.
- Si vuelve a escribir otro dia, cuenta como otra conversacion.

## Menu automatico por opcion

Cuando escribe un usuario, el sistema puede enviar este menu:

1 - Energia  
2 - Agua  
3 - Telefonia / Internet / Television  
4 - Consulta Administrativa

Si responde `1`, `2`, `3` o `4`, se registra la opcion para esa conversacion del dia y se responde confirmacion.

Regla de reenvio de menu:
- Si pasan 3 dias o mas desde la ultima opcion elegida y el usuario vuelve a escribir, se vuelve a mostrar el selector.

## Stack

- Node.js
- Express
- whatsapp-web.js
- SQLite
- Chart.js
- Bootstrap

## Estructura

```txt
server.js
database.js
whatsapp.js
routes/
  stats.js
views/
  dashboard.ejs
public/
  css/styles.css
  js/dashboard.js
data/
package.json
README.md
```

## Base de datos

Archivo: `data/whatsapp.sqlite`

Tablas:

1. `mensajes` (registro minimo por mensaje entrante)
- id INTEGER PRIMARY KEY AUTOINCREMENT
- telefono TEXT NOT NULL
- fecha_hora TEXT NOT NULL
- fecha TEXT NOT NULL
- anio INTEGER NOT NULL
- mes INTEGER NOT NULL
- dia INTEGER NOT NULL

2. `conversacion_opciones` (una opcion por `telefono + fecha`)
- id INTEGER PRIMARY KEY AUTOINCREMENT
- telefono TEXT NOT NULL
- fecha_hora TEXT NOT NULL
- fecha TEXT NOT NULL
- anio INTEGER NOT NULL
- mes INTEGER NOT NULL
- dia INTEGER NOT NULL
- opcion_codigo INTEGER NOT NULL
- opcion_nombre TEXT NOT NULL
- UNIQUE(telefono, fecha)

3. `contacto_estado` (estado para regla de menu 3 dias)
- telefono TEXT PRIMARY KEY
- ultima_interaccion_at TEXT NOT NULL
- ultimo_menu_at TEXT
- ultima_opcion_codigo INTEGER
- ultima_opcion_nombre TEXT
- ultima_opcion_at TEXT

## Endpoints

- `GET /` dashboard
- `GET /stats/daily`
- `GET /stats/monthly`
- `GET /stats/yearly`
- `GET /stats/summary`
- `GET /stats/options/totals`
- `GET /stats/options/daily`
- `GET /stats/options/monthly`

## Requisitos

- Node.js 18+ recomendado
- Google Chrome instalado (lo usa whatsapp-web.js mediante Puppeteer)

## Instalacion y ejecucion (Windows)

1. Instalar dependencias:

```powershell
npm install
```

2. Ejecutar en desarrollo:

```powershell
npm run dev
```

O en modo normal:

```powershell
npm start
```

3. Abrir:

```txt
http://localhost:3000
```

4. En la consola se imprimira un QR. Escanearlo con WhatsApp:
- WhatsApp en telefono -> Dispositivos vinculados -> Vincular dispositivo.

## Comportamiento implementado

- Solo guarda mensajes entrantes.
- Ignora mensajes salientes (`fromMe`).
- Ignora estados (`status@broadcast`) y chats no privados (grupos).
- Normaliza telefono para dejar solo digitos.
- Guarda datos minimos para metrica (sin contenido de mensaje).
- Intenta reconectar automaticamente si se desconecta.
- Registra conversaciones por opcion segun seleccion del usuario.

## Variables opcionales

`.env`

```env
PORT=3000
```
