import { z } from "zod";
import catalogData from "./catalog.json";
import type { DecisionSource } from "./decision-types";

/**
 * Versioned, static provider and model catalog. Every field that was not verified against an
 * official document or a recorded live response carries `verified: false` and is left empty.
 * The UI shows unverified entries with a calibration warning; they are never auto-connected.
 */

export type CatalogAdapter = DecisionSource["adapter"];

export type CatalogLocalFile = {
  fileName: string;
  sha256?: string;
  sizeBytes?: number;
  url?: string;
  verified: boolean;
};

export type CatalogModel = {
  id: string;
  name: string;
  params: string;
  openWeights: boolean;
  vision: boolean;
  localFiles?: CatalogLocalFile[];
  recommendedHardware?: { minVramGb?: number; minRamGb?: number; cpuOk?: boolean };
  verified: boolean;
};

export type CatalogLimits = {
  maxQuestions: number;
  maxChoices: number;
  maxScoreLevels: number;
  maxInputChars: number;
};

export type CatalogPrice = {
  /** US dollars per million input tokens. */
  value: number;
  source: string;
  date: string;
  verified: boolean;
};

export type CatalogProvider = {
  id: string;
  name: string;
  type?: "hosted_api" | "gateway" | "local_runtime";
  adapter?: CatalogAdapter;
  defaultEndpoint?: string;
  auth: "bearer" | "none";
  docsUrl?: string;
  models: CatalogModel[];
  limits?: CatalogLimits;
  price?: CatalogPrice;
  notes?: string;
  verified: boolean;
};

export type Catalog = {
  version: number;
  updatedAt: string;
  providers: CatalogProvider[];
};

const text = z.string().min(1).max(2048);
const integer = (max: number) => z.number().int().positive().max(max);

const LocalFileSchema = z.strictObject({
  fileName: z.string().min(1).max(260),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .optional(),
  sizeBytes: z.number().int().positive().optional(),
  url: text.optional(),
  verified: z.boolean(),
});

const ModelSchema = z.strictObject({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  params: z.string().max(40),
  openWeights: z.boolean(),
  vision: z.boolean(),
  localFiles: z.array(LocalFileSchema).max(8).optional(),
  recommendedHardware: z
    .strictObject({
      minVramGb: z.number().nonnegative().optional(),
      minRamGb: z.number().nonnegative().optional(),
      cpuOk: z.boolean().optional(),
    })
    .optional(),
  verified: z.boolean(),
});

const LimitsSchema = z.strictObject({
  maxQuestions: integer(64),
  maxChoices: integer(64),
  maxScoreLevels: integer(32),
  maxInputChars: integer(1_000_000),
});

const PriceSchema = z.strictObject({
  value: z.number().nonnegative(),
  source: text,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  verified: z.boolean(),
});

const ProviderSchema = z.strictObject({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(200),
  type: z.enum(["hosted_api", "gateway", "local_runtime"]).optional(),
  adapter: z
    .enum(["systemone", "decisions", "ollama-systemone", "llm-structured", "custom"])
    .optional(),
  defaultEndpoint: text.optional(),
  auth: z.enum(["bearer", "none"]),
  docsUrl: text.optional(),
  models: z.array(ModelSchema).max(64),
  limits: LimitsSchema.optional(),
  price: PriceSchema.optional(),
  notes: z.string().max(1000).optional(),
  verified: z.boolean(),
});

const CatalogSchema = z.strictObject({
  version: z.literal(1),
  updatedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  providers: z.array(ProviderSchema).max(128),
});

/** Parses the bundled catalog. Throws when the file does not match the schema, so a bad edit fails tests and startup. */
export function loadCatalog(): Catalog {
  return CatalogSchema.parse(catalogData);
}
