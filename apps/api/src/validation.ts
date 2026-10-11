import { BadRequestException } from "@nestjs/common";
import { z } from "zod";

export function input<T extends z.ZodType>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new BadRequestException(result.error.issues.map(issue => issue.message).join(". "));
  }
  return result.data;
}

export const email = z.email().max(254).transform(value => value.toLowerCase());
export const resourceName = z.string().trim().min(1, "A name is required").max(120);
