import "server-only";

import fs from "node:fs";
import path from "node:path";
import type { ZodType } from "zod";

import { StudioNotFoundError, StudioValidationError } from "../errors";

export function readJsonFile(filePath: string): unknown {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (isEnoent(error)) {
      throw new StudioNotFoundError("Record not found.");
    }
    throw error;
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new StudioValidationError("File is not valid JSON.");
  }
}

export function parseJsonRecord<T>(filePath: string, schema: ZodType<T>): T {
  const parsed = readJsonFile(filePath);
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new StudioValidationError("File does not match the expected schema.");
  }
  return result.data;
}

export function writeJsonFile(filePath: string, value: unknown): void {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true });
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${process.hrtime.bigint()}.tmp`);

  fs.writeFileSync(tempPath, payload, "utf8");
  try {
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      fs.renameSync(tempPath, filePath);
    } catch {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Best-effort cleanup of the temp file after a failed replace.
      }
      throw error;
    }
  }
}

export function ensureDirectory(directoryPath: string): void {
  fs.mkdirSync(directoryPath, { recursive: true });
}

function isEnoent(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
