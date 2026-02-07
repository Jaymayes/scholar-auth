import rateLimit from "express-rate-limit";

// Registration endpoint: 5 requests per hour per IP (prevent spam)
export const registerRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  message: { error: "Too many registration attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Login endpoint: 10 requests per hour per IP (prevent brute force)
export const loginRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: "Too many login attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Email verification: 10 requests per hour per IP
export const verifyEmailRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 10,
  message: { error: "Too many verification attempts. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Refresh endpoint: 100 requests per hour per IP
export const refreshRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 100,
  message: { error: "Too many refresh requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Introspect endpoint: 1000 requests per hour per IP
export const introspectRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 1000,
  message: { error: "Too many introspection requests. Please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});
