import { z } from '../registry.js';

export const OptionalQueryStringSchema = z.string().optional();
export const SearchLimitQuerySchema = z.coerce.number().int().min(1).max(50).optional();
export const SearchOffsetQuerySchema = z.coerce.number().int().min(0).optional();
