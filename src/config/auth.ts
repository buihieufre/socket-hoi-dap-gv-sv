import jwt from "jsonwebtoken";

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  fullName?: string;
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): JWTPayload | null {
  try {
    const jwtSecret =
      process.env.JWT_SECRET || "your-secret-key-change-in-production";
    return jwt.verify(token, jwtSecret) as JWTPayload;
  } catch (error) {
    return null;
  }
}

/**
 * Get token from cookies
 */
export function getTokenFromCookies(cookies: string): string | null {
  const cookieArray = cookies.split("; ");
  const tokenCookie = cookieArray.find((cookie) =>
    cookie.startsWith("auth_token=")
  );
  if (tokenCookie) {
    return tokenCookie.split("=")[1];
  }
  return null;
}
