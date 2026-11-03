export type Format = 'jpg' | 'webp' | 'png' | 'avif';
export interface Recipe {
  version: 1;
  purpose: 'quality' | 'size' | 'social';
  format: Format;
  longEdge: number;
  quality: number;
  maxBytes: number;
  colorSpace: 'srgb' | 'source' | 'p3';
  inputProfile: 'auto' | 'srgb' | 'p3' | 'adobergb';
  metadata: 'keep' | 'strip';
  gps: boolean;
  frame: 'white' | 'black' | 'blur' | 'none';
  slices: 1 | 2 | 3;
  fit: 'contain' | 'cover';
  cropX: number;
  cropY: number;
}
export interface Asset {
  id: string;
  name: string;
  format: string;
  width: number;
  height: number;
  bits: number;
  icc: string;
  provenance: 'original' | 'embedded-jpeg' | 'heic-8bit';
  metadata: Record<string, unknown>;
  warnings: string[];
  thumbnail: Blob | null;
}
export interface Artifact {
  blob: Blob;
  format: Format;
  width: number;
  height: number;
  bytes: number;
  quality: number | null;
  checks: {
    signature: boolean;
    decoded: boolean;
    icc: string;
    metadata: 'verified' | 'partial' | 'none' | 'stripped';
    withinTarget: boolean;
    losslessCopy: boolean;
  };
}
export interface ConversionResult {
  recipe: Recipe;
  provenance: Asset['provenance'];
  artifacts: Artifact[];
  warnings: string[];
  engine: string;
  elapsedMs: number;
}
export interface Region {
  x: number;
  y: number;
  slice: number;
}
export interface Proof {
  before: Blob;
  after: Blob;
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface PreviewResult extends Omit<ConversionResult, 'artifacts'> {
  artifacts: Pick<Artifact, 'blob' | 'width' | 'height'>[];
  proof?: Proof;
}
export type EngineRequest = {
  id: number;
  file: File;
  baseUrl: string;
  converted?: Blob;
  mobile: boolean;
} & (
  | { method: 'inspect' }
  | { method: 'preview' | 'run'; recipe: Recipe; region?: Region }
);
