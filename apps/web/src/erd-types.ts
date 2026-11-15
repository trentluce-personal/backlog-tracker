export const erDataTypes = ['smallint', 'integer', 'bigint', 'numeric', 'real', 'double precision', 'text', 'varchar', 'boolean', 'uuid', 'date', 'timestamp', 'timestamptz', 'jsonb', 'bytea'] as const;
export type ErDataType = typeof erDataTypes[number];
export interface ErColumn { id: string; name: string; dataType: ErDataType; nullable: boolean; primaryKey: boolean; unique: boolean }
export interface ErTable { id: string; name: string; x: number; y: number; columns: ErColumn[] }
export interface ErForeignKey { id: string; name: string; sourceTableId: string; sourceColumnId: string; targetTableId: string; targetColumnId: string }
export interface ErModel { kind: 'sql'; schemaVersion: 1; dialect: 'postgresql'; tables: ErTable[]; foreignKeys: ErForeignKey[] }
export interface ErDocument { id: string; name: string; model: ErModel & { revision: number } }
export type ErSummary = { id: string; name: string } & ({ available: true; revision: number } | { available: false; error: string });
export interface ErExport { filename: string; mediaType: string; content: string }
