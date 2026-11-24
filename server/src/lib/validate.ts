import type { ZodTypeAny, z } from 'zod';
import { badRequest } from './errors';

export function parse<T extends ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path?.join('.') || undefined;
    throw badRequest('validation', first?.message ?? 'Ungültige Eingabe', {
      path,
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
  return result.data;
}

export function toInt(value: unknown, name = 'id'): number {
  const n = typeof value === 'number' ? value : Number.parseInt(String(value), 10);
  if (!Number.isInteger(n) || n <= 0) throw badRequest('bad_id', `Ungültige ${name}`);
  return n;
}
