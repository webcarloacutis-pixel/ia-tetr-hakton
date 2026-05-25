# VoiceCart AI

Bot ecommerce por WhatsApp para recibir pedidos, entender notas de voz, pedir comprobante de pago y confirmar su recepcion.

## Que Hace

- Recibe mensajes entrantes desde UltraMsg.
- Entiende texto y notas de voz.
- Transcribe audios con OpenAI.
- Extrae producto, precio, direccion, ciudad y cliente.
- Consulta productos desde `productos.json`.
- Confirma el pedido y pide comprobante de pago.
- Acepta imagen, documento o mensaje/audio de comprobante.
- Responde que el comprobante fue recibido y que el pedido sera verificado.
- Puede generar respuestas de voz con ElevenLabs.
- Mantiene modo seguro para evitar envios proactivos.

## Flujo Principal

Cliente:

```text
Hola, quiero comprar el Vivo Y04 Jade Black 128GB.
Precio 399900.
Direccion Colpatria Tower.
Ciudad Bogota.
Cliente Sebastian.
```

Bot:

```text
Listo, Sebastian, tengo tu pedido:

Producto: Vivo Y04 Jade Black Phone 128GB 4GB RAM
Total: $ 399.900
Entrega: Colpatria Tower, Bogota
Cliente: Sebastian

Para confirmar el pedido, realiza el pago por el medio acordado y enviame el comprobante por este mismo WhatsApp.
```

Cuando llega el comprobante:

```text
Gracias, recibi el comprobante de pago.

Vamos a verificarlo y te confirmamos el estado del pedido por este mismo WhatsApp.
```

## Variables De Entorno

Copia `.env.example` a `.env` y completa:

```env
ECOMMERCE_ONLY="true"
ECOMMERCE_LANGUAGE="en"

OPENAI_API_KEY="sk-..."
OPENAI_MODEL="gpt-5-mini"
OPENAI_TRANSCRIPTION_MODEL="gpt-4o-mini-transcribe"

ULTRAMSG_INSTANCE_ID="instance177604"
ULTRAMSG_BASE_URL="https://api.ultramsg.com/instance177604"
ULTRAMSG_TOKEN="..."
WHATSAPP_SAFE_MODE="true"
WHATSAPP_AUDIO_REPLIES="true"
WHATSAPP_SEND_TEXT_WITH_AUDIO="false"

ELEVENLABS_API_KEY="..."
ELEVENLABS_VOICE_ID="..."
ELEVENLABS_MODEL_ID="eleven_multilingual_v2"
ELEVENLABS_OUTPUT_FORMAT="mp3_44100_128"
ELEVENLABS_LANGUAGE_CODE="en"

PAYMENT_INSTRUCTIONS="To confirm your order, please complete the payment through the agreed method and send me the payment receipt here on WhatsApp."
PRODUCTS_JSON_PATH="productos.json"
```

`DATABASE_URL` no es obligatoria para probar el bot ecommerce.

## Scripts

```bash
npm install
npm run dev:ecommerce
```

Scripts utiles:

- `npm run dev:ecommerce`: levanta Next.js/API en `http://localhost:3030` sin scheduler institucional.
- `npm run dev`: alias de `dev:ecommerce`.
- `npm run qa:ecommerce`: prueba el flujo pedido -> comprobante.
- `npm run lint`: valida el codigo.
- `npm run build`: build de produccion.

## Audio Test

Abre:

```text
http://localhost:3030/audio-test
```

Sirve para probar:

- carga de `OPENAI_API_KEY`;
- transcripcion de audio;
- carga de `ELEVENLABS_API_KEY`;
- carga de `ELEVENLABS_VOICE_ID`;
- generacion y reproduccion de audio.

Si ElevenLabs no esta configurado, la respuesta muestra errores como `missing ELEVENLABS_API_KEY` o `missing ELEVENLABS_VOICE_ID`.

## UltraMsg

Webhook principal:

```text
/api/ultramsg/webhook
```

Ruta corta compatible:

```text
/api/webhook
```

En UltraMsg configura:

```text
https://TU-DOMINIO/api/webhook
```

Activa:

- `Webhook on Received`
- `Webhook Download Media`

Deja apagados para pruebas:

- `Webhook on Create`
- `Webhook on ACK`
- `Webhook On Reaction`

No ejecutes pruebas salientes desde terminal. Para probar:

1. Levanta el proyecto o despliegalo.
2. Configura la URL del webhook en UltraMsg.
3. Escribe desde tu WhatsApp personal al numero conectado.
4. Envia texto, nota de voz y comprobante.
5. Revisa logs del servidor.

## Modo Seguro

Con `WHATSAPP_SAFE_MODE=true`:

- solo responde a mensajes entrantes;
- no envia mensajes proactivos;
- deduplica mensajes recibidos;
- espera entre 8 y 15 segundos antes de responder;
- maximo 10 respuestas por hora;
- maximo 1 respuesta por mensaje recibido;
- loguea saltos de seguridad.

Logs esperados:

```text
[ultramsg] webhook received
[ultramsg] inbound message from:
[ultramsg] safe mode active
[ultramsg] waiting before reply
[ultramsg] sending reply
[ultramsg] reply sent
[ultramsg] skipped duplicate
[ultramsg] rate limit reached
[ultramsg] missing token
[ultramsg] missing instance id
[ultramsg] error
[whatsapp] audio received
[transcription] started
[transcription] result:
[ecommerce] processing order
```

## Render

El `render.yaml` define solo el servicio web ecommerce.

Variables sensibles que debes completar en Render:

- `OPENAI_API_KEY`
- `ULTRAMSG_TOKEN`
- `ELEVENLABS_API_KEY`
- `ELEVENLABS_VOICE_ID`
- `PAYMENT_INSTRUCTIONS`

Despues del deploy usa:

```text
https://TU-SERVICIO.onrender.com/api/webhook
```

como webhook en UltraMsg.

## Archivos Principales

- `src/app/api/ultramsg/webhook/route.ts`: webhook real de WhatsApp.
- `src/server/ecommerce-assistant.ts`: logica de venta, pedido y comprobante.
- `src/server/messageService.ts`: envio seguro por UltraMsg.
- `src/server/openai-service.ts`: texto y transcripcion.
- `src/server/elevenlabs-service.ts`: texto a voz.
- `src/app/audio-test/page.tsx`: prueba local de audio.
- `productos.json`: catalogo.
