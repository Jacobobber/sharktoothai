/* Minimal logger wrapper to allow centralized replacement later. */
export const logger = {
  info: (message: unknown, meta?: unknown) => {
    if (meta === undefined) {
      console.log(message);
      return;
    }
    console.log(message, meta ?? "");
  },
  warn: (message: unknown, meta?: unknown) => {
    if (meta === undefined) {
      console.warn(message);
      return;
    }
    console.warn(message, meta ?? "");
  },
  error: (message: unknown, meta?: unknown) => {
    if (meta === undefined) {
      console.error(message);
      return;
    }
    console.error(message, meta ?? "");
  }
};
