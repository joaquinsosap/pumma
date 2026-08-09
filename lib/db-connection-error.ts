/** User-facing database connection errors (safe to show in UI). */

export class DbConnectionError extends Error {
  readonly causeDetail?: string;

  constructor(message: string, causeDetail?: string) {
    super(message);
    this.name = "DbConnectionError";
    this.causeDetail = causeDetail;
  }
}

function looksLikeDbConnection(text: string): boolean {
  return (
    /Mongo(ServerSelection|Network|Timeout|Authentication|Parse)Error/i.test(
      text,
    ) ||
    /MONGODB_URI/i.test(text) ||
    /ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i.test(text) ||
    /SSL routines|tlsv1 alert|certificate/i.test(text) ||
    /DATA_SOURCE !== ['"]mongodb['"]/i.test(text) ||
    /getDb\(\) called/i.test(text)
  );
}

export function isDbConnectionError(error: unknown): boolean {
  if (error instanceof DbConnectionError) return true;
  if (typeof error === "string") return looksLikeDbConnection(error);
  if (!(error instanceof Error)) return false;
  if (error.name === "DbConnectionError") return true;
  if (
    looksLikeDbConnection(error.name) ||
    looksLikeDbConnection(error.message)
  ) {
    return true;
  }
  if (error.cause) return isDbConnectionError(error.cause);
  return false;
}

export function asDbConnectionError(error: unknown): DbConnectionError {
  if (error instanceof DbConnectionError) return error;

  const detail =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : undefined;

  if (
    detail?.includes("MONGODB_URI is not set") ||
    (process.env.DATA_SOURCE === "mongodb" && !process.env.MONGODB_URI)
  ) {
    return new DbConnectionError(
      "Database is not configured. Set MONGODB_URI in your environment.",
      detail,
    );
  }

  if (isDbConnectionError(error)) {
    return new DbConnectionError(
      "Could not connect to the database. Check that MongoDB is running and your connection settings are correct.",
      detail,
    );
  }

  return new DbConnectionError("Connection error. Please try again.", detail);
}

export function rethrowAsDbConnectionError(error: unknown): never {
  if (isDbConnectionError(error)) throw asDbConnectionError(error);
  throw error;
}

export const DB_CONNECTION_MESSAGE =
  "Could not connect to the database. Check that MongoDB is running and your connection settings are correct.";
