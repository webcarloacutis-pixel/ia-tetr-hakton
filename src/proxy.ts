import { NextResponse, type NextRequest } from "next/server";

const INSTITUTIONAL_PREFIXES = [
  "/dashboard",
  "/login",
  "/api/announcements",
  "/api/assistant",
  "/api/auth",
  "/api/dashboard",
  "/api/knowledge",
  "/api/metrics",
  "/api/scheduler",
  "/api/segments",
];

function isInstitutionalPath(pathname: string) {
  return INSTITUTIONAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest) {
  if (process.env.ECOMMERCE_ONLY !== "true") {
    return NextResponse.next();
  }

  if (!isInstitutionalPath(request.nextUrl.pathname)) {
    return NextResponse.next();
  }

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json(
      {
        ok: false,
        error: "Ruta institucional desactivada en modo ecommerce.",
      },
      { status: 404 },
    );
  }

  return NextResponse.redirect(new URL("/audio-test", request.url));
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/login",
    "/api/announcements/:path*",
    "/api/assistant/:path*",
    "/api/auth/:path*",
    "/api/dashboard/:path*",
    "/api/knowledge/:path*",
    "/api/metrics/:path*",
    "/api/scheduler/:path*",
    "/api/segments/:path*",
  ],
};
