import {
  buildCatalogSummary,
  findProductByName,
  formatPriceCOP,
  type EcommerceProduct,
} from "@/server/ecommerce-products";
import { generateOpenAIText, isOpenAIConfigured } from "@/server/openai-service";

type EcommerceOrder = {
  productName: string | null;
  productPrice: number | null;
  address: string | null;
  city: string | null;
  customerName: string | null;
  catalogProductId: string | null;
  proofReceived: boolean;
};

type EcommerceSession = {
  id: string;
  order: EcommerceOrder;
  history: Array<{
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }>;
};

type ExtractedOrder = Partial<Omit<EcommerceOrder, "proofReceived" | "catalogProductId">>;
type EcommerceLanguage = "es" | "en";

const globalForEcommerce = globalThis as unknown as {
  __ecommerceAssistantSessions?: Map<string, EcommerceSession>;
};
const ORDER_FIELD_ALIASES = [
  "producto",
  "product",
  "equipo",
  "celular",
  "item",
  "precio",
  "price",
  "valor",
  "total",
  "direccion",
  "dirección",
  "address",
  "entrega",
  "ciudad",
  "city",
  "cliente",
  "nombre",
  "customer",
  "comprador",
];

function getEcommerceLanguage(): EcommerceLanguage {
  const language = process.env.ECOMMERCE_LANGUAGE?.trim().toLowerCase();
  return language === "en" ? "en" : "es";
}

function getFieldLabels(language = getEcommerceLanguage()) {
  if (language === "en") {
    return {
      product: "product",
      price: "price",
      address: "address",
      city: "city",
      customerName: "customer name",
    };
  }

  return {
    product: "producto",
    price: "precio",
    address: "direccion",
    city: "ciudad",
    customerName: "nombre del cliente",
  };
}

function createEmptyOrder(): EcommerceOrder {
  return {
    productName: null,
    productPrice: null,
    address: null,
    city: null,
    customerName: null,
    catalogProductId: null,
    proofReceived: false,
  };
}

function getStore() {
  if (!globalForEcommerce.__ecommerceAssistantSessions) {
    globalForEcommerce.__ecommerceAssistantSessions = new Map();
  }

  return globalForEcommerce.__ecommerceAssistantSessions;
}

function getSession(sessionId: string) {
  const store = getStore();
  const current = store.get(sessionId);

  if (current) {
    return current;
  }

  const session: EcommerceSession = {
    id: sessionId,
    order: createEmptyOrder(),
    history: [],
  };

  store.set(sessionId, session);
  return session;
}

function addTurn(session: EcommerceSession, role: "user" | "assistant", content: string) {
  session.history.push({
    role,
    content,
    createdAt: new Date().toISOString(),
  });
  session.history = session.history.slice(-16);
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parsePrice(value: string | number | null | undefined) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== "string") {
    return null;
  }

  const digits = value.replace(/[^\d]/g, "");
  const parsed = Number(digits);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getLabeledValue(message: string, labels: string[]) {
  const normalizedLabels = labels.map(normalizeText);
  const inlineMessage = message.replace(/\r?\n+/g, " ");
  const nextLabelPattern = ORDER_FIELD_ALIASES.map(escapeRegex).join("|");

  for (const label of labels) {
    const pattern = new RegExp(
      `(?:^|[\\s.;,])${escapeRegex(label)}\\s*:\\s*([\\s\\S]*?)(?=\\s*(?:${nextLabelPattern})\\s*:|$)`,
      "iu",
    );
    const match = inlineMessage.match(pattern);
    const value = match?.[1]?.trim().replace(/[.;,\s]+$/, "");

    if (value) {
      return value;
    }
  }

  for (const line of message.split(/\r?\n/)) {
    const [rawLabel, ...rest] = line.split(":");

    if (!rest.length) {
      continue;
    }

    const normalizedLabel = normalizeText(rawLabel);

    if (normalizedLabels.includes(normalizedLabel)) {
      const value = rest.join(":").trim();

      if (value) {
        return value;
      }
    }
  }

  return null;
}

function extractOrderLocally(message: string): ExtractedOrder {
  const productName =
    getLabeledValue(message, ["producto", "product", "equipo", "celular", "item"]) ??
    findProductByName(message)?.name ??
    null;
  const priceText = getLabeledValue(message, ["precio", "price", "valor", "total"]);

  return {
    productName,
    productPrice: parsePrice(priceText),
    address: getLabeledValue(message, ["direccion", "dirección", "address", "entrega"]),
    city: getLabeledValue(message, ["ciudad", "city"]),
    customerName: getLabeledValue(message, ["cliente", "nombre", "customer", "comprador"]),
  };
}

function parseJsonObject(value: string) {
  const match = value.match(/\{[\s\S]*\}/);

  if (!match) {
    return null;
  }

  try {
    return JSON.parse(match[0]) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function extractOrderWithOpenAI(message: string): Promise<ExtractedOrder> {
  if (!isOpenAIConfigured()) {
    return {};
  }

  const response = await generateOpenAIText({
    systemPrompt: [
      "Extrae datos de pedidos de ecommerce recibidos por WhatsApp.",
      "Devuelve solo JSON valido sin markdown.",
      "Campos: productName, productPrice, address, city, customerName.",
      "Si un dato no aparece, usa null. productPrice debe ser numero en COP sin separadores.",
    ].join(" "),
    userPrompt: JSON.stringify({
      mensaje: message,
      catalogo: buildCatalogSummary(30),
      assistantLanguage: getEcommerceLanguage(),
    }),
  });

  if (!response) {
    return {};
  }

  const parsed = parseJsonObject(response);

  if (!parsed) {
    return {};
  }

  return {
    productName: typeof parsed.productName === "string" ? parsed.productName.trim() : null,
    productPrice: parsePrice(parsed.productPrice as string | number | null),
    address: typeof parsed.address === "string" ? parsed.address.trim() : null,
    city: typeof parsed.city === "string" ? parsed.city.trim() : null,
    customerName:
      typeof parsed.customerName === "string" ? parsed.customerName.trim() : null,
  };
}

function mergeOrder(session: EcommerceSession, extracted: ExtractedOrder) {
  const next = session.order;

  if (extracted.productName) {
    next.productName = extracted.productName;
  }

  if (extracted.productPrice) {
    next.productPrice = extracted.productPrice;
  }

  if (extracted.address) {
    next.address = extracted.address;
  }

  if (extracted.city) {
    next.city = extracted.city;
  }

  if (extracted.customerName) {
    next.customerName = extracted.customerName;
  }

  const catalogProduct = next.productName ? findProductByName(next.productName) : null;

  if (catalogProduct) {
    next.catalogProductId = catalogProduct.id;
    next.productName = catalogProduct.name;

    if (!next.productPrice && catalogProduct.price) {
      next.productPrice = catalogProduct.price;
    }
  }

  return catalogProduct;
}

function getMissingFields(order: EcommerceOrder) {
  const labels = getFieldLabels();
  const missing: string[] = [];

  if (!order.productName) {
    missing.push(labels.product);
  }

  if (!order.productPrice) {
    missing.push(labels.price);
  }

  if (!order.address) {
    missing.push(labels.address);
  }

  if (!order.city) {
    missing.push(labels.city);
  }

  if (!order.customerName) {
    missing.push(labels.customerName);
  }

  return missing;
}

function getPaymentInstructions() {
  const customInstructions = process.env.PAYMENT_INSTRUCTIONS?.trim();

  if (customInstructions) {
    return customInstructions;
  }

  if (getEcommerceLanguage() === "en") {
    return "To confirm your order, please complete the payment through the agreed method and send me the payment receipt here on WhatsApp.";
  }

  return (
    "Para confirmar el pedido, realiza el pago por el medio acordado y enviame el comprobante por este mismo WhatsApp."
  );
}

function formatOrderSummary(order: EcommerceOrder) {
  const price = formatPriceCOP(order.productPrice);

  if (getEcommerceLanguage() === "en") {
    return [
      `Product: ${order.productName ?? "pending"}`,
      `Total: ${price ?? "pending"}`,
      `Delivery: ${order.address ?? "pending"}, ${order.city ?? "pending"}`,
      `Customer: ${order.customerName ?? "pending"}`,
    ].join("\n");
  }

  return [
    `Producto: ${order.productName ?? "pendiente"}`,
    `Total: ${price ?? "pendiente"}`,
    `Entrega: ${order.address ?? "pendiente"}, ${order.city ?? "pendiente"}`,
    `Cliente: ${order.customerName ?? "pendiente"}`,
  ].join("\n");
}

function buildMissingFieldsReply(order: EcommerceOrder) {
  const missing = getMissingFields(order);

  if (getEcommerceLanguage() === "en") {
    return [
      "Perfect, I can help with your purchase.",
      `I still need: ${missing.join(", ")}.`,
      "You can send it like this: Customer: your name, Address: your address, City: your city.",
    ].join("\n");
  }

  return [
    "Perfecto, te ayudo con la compra.",
    `Me falta este dato: ${missing.join(", ")}.`,
    "Puedes enviarlo asi: Cliente: tu nombre, Direccion: tu direccion, Ciudad: tu ciudad.",
  ].join("\n");
}

function buildPaymentRequestReply(order: EcommerceOrder) {
  const customer = order.customerName ? `${order.customerName}, ` : "";

  if (getEcommerceLanguage() === "en") {
    return [
      `Great, ${customer}I have your order:`,
      formatOrderSummary(order),
      getPaymentInstructions(),
    ].join("\n\n");
  }

  return [
    `Listo, ${customer}tengo tu pedido:`,
    formatOrderSummary(order),
    getPaymentInstructions(),
  ].join("\n\n");
}

function buildUnavailableReply(product: EcommerceProduct) {
  if (getEcommerceLanguage() === "en") {
    return [
      `${product.name} is not available in inventory right now.`,
      "Send me another product and I can help you with the order.",
    ].join("\n");
  }

  return [
    `Por ahora ${product.name} no aparece disponible en inventario.`,
    "Si quieres, enviame otro producto y reviso la compra.",
  ].join("\n");
}

function buildCatalogReply() {
  const products = buildCatalogSummary(8);

  if (!products.length) {
    if (getEcommerceLanguage() === "en") {
      return "I do not have products loaded in productos.json yet. Send me the product you want to buy and I will help with the order.";
    }

    return "Aun no tengo productos cargados en productos.json. Enviame el producto que quieres comprar y te ayudo con el pedido.";
  }

  const lines = products.map((product) => {
    const price = formatPriceCOP(product.precio, product.moneda);
    return `${product.nombre}${price ? ` - ${price}` : ""}`;
  });

  return [
    getEcommerceLanguage() === "en"
      ? "These are some available products:"
      : "Estos son algunos productos disponibles:",
    ...lines,
  ].join("\n");
}

function buildFallbackReply() {
  if (getEcommerceLanguage() === "en") {
    return [
      "Hi, I can help you with your WhatsApp purchase.",
      "Send me the order with Product, Price, Address, City, and Customer. Once I have it, I will ask for the payment receipt.",
    ].join("\n");
  }

  return [
    "Hola, te ayudo con tu compra por WhatsApp.",
    "Enviame el pedido con Producto, Precio, Direccion, Ciudad y Cliente. Cuando lo tenga, te pedire el comprobante de pago.",
  ].join("\n");
}

function hasCatalogIntent(message: string) {
  const normalized = normalizeText(message);
  return ["catalogo", "productos", "inventario", "precio", "precios"].some((word) =>
    normalized.includes(word),
  ) || ["catalog", "products", "inventory", "price", "prices"].some((word) =>
    normalized.includes(word),
  );
}

function hasPaymentProofIntent(message: string) {
  const normalized = normalizeText(message);
  return [
    "comprobante",
    "recibo",
    "capture",
    "captura",
    "ya pague",
    "ya pague",
    "transferencia",
    "pago hecho",
    "payment receipt",
    "receipt",
    "proof",
    "proof of payment",
    "paid",
    "i paid",
    "payment sent",
    "transfer",
  ].some((word) => normalized.includes(word));
}

function hasAnyOrderField(order: ExtractedOrder) {
  return Boolean(
    order.productName ||
      order.productPrice ||
      order.address ||
      order.city ||
      order.customerName,
  );
}

export function resetEcommerceConversation(sessionId: string) {
  getStore().set(sessionId, {
    id: sessionId,
    order: createEmptyOrder(),
    history: [],
  });
}

export async function registerEcommercePaymentProof(sessionId: string) {
  const session = getSession(sessionId);
  session.order.proofReceived = true;
  const language = getEcommerceLanguage();

  const reply = session.order.productName
    ? language === "en"
      ? [
          "Thank you, I received the payment receipt.",
          "We will verify it and confirm the order status here on WhatsApp.",
          formatOrderSummary(session.order),
        ].join("\n\n")
      : [
          "Gracias, recibi el comprobante de pago.",
          "Vamos a verificarlo y te confirmamos el estado del pedido por este mismo WhatsApp.",
          formatOrderSummary(session.order),
        ].join("\n\n")
    : language === "en"
      ? "Thank you, I received the receipt. Now send me the order so I can match it correctly."
      : "Gracias, recibi el comprobante. Ahora enviame el pedido para asociarlo correctamente.";

  addTurn(session, "assistant", reply);

  return {
    reply,
    order: session.order,
    usedOpenAI: false,
  };
}

export async function chatWithEcommerceAssistant(sessionId: string, message: string) {
  const session = getSession(sessionId);
  const trimmedMessage = message.trim();
  addTurn(session, "user", trimmedMessage);

  if (hasPaymentProofIntent(trimmedMessage)) {
    session.order.proofReceived = true;
    const language = getEcommerceLanguage();
    const reply = session.order.productName
      ? language === "en"
        ? [
            "Thank you, I received the payment receipt.",
            "We will verify it and confirm the order status here on WhatsApp.",
            formatOrderSummary(session.order),
          ].join("\n\n")
        : [
            "Gracias, recibi el comprobante de pago.",
            "Vamos a verificarlo y te confirmamos el estado del pedido por este mismo WhatsApp.",
            formatOrderSummary(session.order),
          ].join("\n\n")
      : language === "en"
        ? "Thank you, I received the receipt. Now send me the order so I can match it correctly."
        : "Gracias, recibi el comprobante. Ahora enviame el pedido para asociarlo correctamente.";

    addTurn(session, "assistant", reply);

    return {
      reply,
      order: session.order,
      usedOpenAI: false,
    };
  }

  const localExtraction = extractOrderLocally(trimmedMessage);
  let extraction = localExtraction;
  let usedOpenAI = false;

  if (!hasAnyOrderField(localExtraction) || getMissingFields({ ...session.order, ...localExtraction, proofReceived: false, catalogProductId: null }).length) {
    try {
      const aiExtraction = await extractOrderWithOpenAI(trimmedMessage);

      if (hasAnyOrderField(aiExtraction)) {
        extraction = {
          ...localExtraction,
          ...Object.fromEntries(
            Object.entries(aiExtraction).filter(([, value]) => value !== null && value !== ""),
          ),
        };
        usedOpenAI = true;
      }
    } catch (error) {
      console.warn("[ecommerce-assistant] OpenAI extraction failed", error);
    }
  }

  const catalogProduct = mergeOrder(session, extraction);

  if (catalogProduct?.stock === 0) {
    const reply = buildUnavailableReply(catalogProduct);
    addTurn(session, "assistant", reply);

    return {
      reply,
      order: session.order,
      usedOpenAI,
    };
  }

  let reply: string;

  if (!hasAnyOrderField(extraction) && hasCatalogIntent(trimmedMessage)) {
    reply = buildCatalogReply();
  } else if (!hasAnyOrderField(extraction) && !session.order.productName) {
    reply = buildFallbackReply();
  } else if (getMissingFields(session.order).length) {
    reply = buildMissingFieldsReply(session.order);
  } else if (session.order.proofReceived) {
    reply =
      getEcommerceLanguage() === "en"
        ? "I already have your receipt. We are verifying the payment and will confirm the order here on WhatsApp."
        : "Ya tengo tu comprobante. Estamos verificando el pago y te confirmamos el pedido por este WhatsApp.";
  } else {
    reply = buildPaymentRequestReply(session.order);
  }

  addTurn(session, "assistant", reply);

  return {
    reply,
    order: session.order,
    usedOpenAI,
  };
}
