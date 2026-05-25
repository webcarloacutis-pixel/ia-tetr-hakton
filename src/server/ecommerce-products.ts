import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

type RawProduct = Record<string, unknown>;

export type EcommerceProduct = {
  id: string;
  name: string;
  price: number | null;
  currency: string;
  stock: number | null;
  active: boolean;
  raw: RawProduct;
};

type ProductCache = {
  path: string;
  mtimeMs: number;
  products: EcommerceProduct[];
};

const globalForProducts = globalThis as unknown as {
  __ecommerceProductsCache?: ProductCache | null;
};

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getProductsPath() {
  return path.resolve(process.cwd(), process.env.PRODUCTS_JSON_PATH?.trim() || "productos.json");
}

function readStringField(product: RawProduct, keys: string[]) {
  for (const key of keys) {
    const value = product[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return null;
}

function readNumberField(product: RawProduct, keys: string[]) {
  for (const key of keys) {
    const value = product[key];

    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    if (typeof value === "string" && value.trim()) {
      const normalized = value.replace(/[^\d,.-]/g, "").replace(/\.(?=\d{3}\b)/g, "");
      const parsed = Number(normalized.replace(",", "."));

      if (Number.isFinite(parsed)) {
        return parsed;
      }
    }
  }

  return null;
}

function normalizeProduct(product: RawProduct, index: number): EcommerceProduct | null {
  const name = readStringField(product, [
    "nombre",
    "name",
    "producto",
    "product",
    "title",
    "titulo",
  ]);

  if (!name) {
    return null;
  }

  const id =
    readStringField(product, ["id", "sku", "slug", "codigo", "code"]) ??
    normalizeText(name).replace(/\s+/g, "-") ??
    `producto-${index + 1}`;
  const stock = readNumberField(product, ["stock", "inventario", "quantity", "cantidad"]);
  const active = product.active !== false && product.activo !== false;

  return {
    id,
    name,
    price: readNumberField(product, ["precio", "price", "valor", "amount"]),
    currency:
      readStringField(product, ["moneda", "currency"])?.toUpperCase() ||
      "COP",
    stock,
    active,
    raw: product,
  };
}

function unwrapProducts(value: unknown) {
  if (Array.isArray(value)) {
    return value;
  }

  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;

    for (const key of ["productos", "products", "items", "data"]) {
      const nested = objectValue[key];

      if (Array.isArray(nested)) {
        return nested;
      }
    }
  }

  return [];
}

export function loadProducts() {
  const productsPath = getProductsPath();

  if (!existsSync(productsPath)) {
    return [];
  }

  const stat = statSync(productsPath);
  const cached = globalForProducts.__ecommerceProductsCache;

  if (cached?.path === productsPath && cached.mtimeMs === stat.mtimeMs) {
    return cached.products;
  }

  const raw = JSON.parse(readFileSync(productsPath, "utf8")) as unknown;
  const products = unwrapProducts(raw)
    .map((item, index) =>
      item && typeof item === "object" ? normalizeProduct(item as RawProduct, index) : null,
    )
    .filter((item): item is EcommerceProduct => Boolean(item));

  globalForProducts.__ecommerceProductsCache = {
    path: productsPath,
    mtimeMs: stat.mtimeMs,
    products,
  };

  return products;
}

export function formatPriceCOP(value: number | null, currency = "COP") {
  if (value === null) {
    return null;
  }

  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(value);
}

export function findProductByName(query: string) {
  const normalizedQuery = normalizeText(query);
  const queryTokens = new Set(normalizedQuery.split(" ").filter((token) => token.length >= 2));

  if (!queryTokens.size) {
    return null;
  }

  const scored = loadProducts()
    .filter((product) => product.active)
    .map((product) => {
      const normalizedName = normalizeText(product.name);
      const nameTokens = new Set(normalizedName.split(" "));
      let score = normalizedName.includes(normalizedQuery) ? 4 : 0;

      for (const token of queryTokens) {
        if (nameTokens.has(token)) {
          score += 1;
        }
      }

      return {
        product,
        score,
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);

  return scored[0]?.product ?? null;
}

export function buildCatalogSummary(limit = 40) {
  return loadProducts()
    .filter((product) => product.active)
    .slice(0, limit)
    .map((product) => ({
      id: product.id,
      nombre: product.name,
      precio: product.price,
      moneda: product.currency,
      stock: product.stock,
    }));
}
