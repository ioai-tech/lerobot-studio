export type SourceKind = 'remoteArchive' | 'localArchive' | 'directory' | 'sample' | 'unknown';

/** Parsed `?url=` intent for restoring a previous local or remote source. */
export interface ParsedSourceUrl {
  kind: SourceKind;
  /** Decoded raw ?url= value */
  raw: string;
  /** UI hint (e.g. local label) */
  hint?: string;
  /** sample:// id */
  sampleId?: string;
  /** IndexedDB has a restorable handle */
  restorable?: boolean;
}
