import assert from "node:assert/strict";

import {
  chatWithEcommerceAssistant,
  registerEcommercePaymentProof,
  resetEcommerceConversation,
} from "@/server/ecommerce-assistant";

async function main() {
  const sessionId = "qa-ecommerce-local";

  resetEcommerceConversation(sessionId);

  const orderResult = await chatWithEcommerceAssistant(
    sessionId,
    [
      "Hola, quiero comprar:",
      "Producto: Vivo Y04 Jade Black Phone 128GB 4GB RAM",
      "Precio: COP 399,900",
      "Dirección: Colpatria Tower",
      "Ciudad: Bogotá",
      "Cliente: Sebastián",
    ].join("\n"),
  );

  assert.match(orderResult.reply, /Vivo Y04 Jade Black Phone 128GB 4GB RAM/i);
  assert.match(orderResult.reply, /\$[\s\u00a0]?399\.900/i);
  assert.match(orderResult.reply, /Colpatria Tower/i);
  assert.match(orderResult.reply, /Bogot[aá]/i);
  assert.match(orderResult.reply, /Sebasti[aá]n/i);
  assert.match(orderResult.reply, /comprobante/i);

  console.log("Respuesta al pedido:\n");
  console.log(orderResult.reply);

  const proofResult = await registerEcommercePaymentProof(sessionId);

  assert.match(proofResult.reply, /recibi el comprobante/i);
  assert.match(proofResult.reply, /verificarlo/i);

  console.log("\nRespuesta al comprobante:\n");
  console.log(proofResult.reply);
  console.log("\nQA ecommerce: pruebas aprobadas.");
}

void main();
