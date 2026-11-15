export type Status = 'backlog' | 'in_progress' | 'done';
export type Priority = 'low' | 'medium' | 'high';
export interface Project { id: string; name: string; createdAt: string }
export interface Task {
  id: string;
  projectId: string;
  title: string;
  description: string;
  priority: Priority;
  dueDate: string | null;
  status: Status;
  createdAt: string;
  updatedAt: string;
}
export type TaskInput = Pick<Task, 'projectId' | 'title' | 'description' | 'priority' | 'dueDate' | 'status'>;
export const statuses: { value: Status; label: string; description: string }[] = [
  { value: 'backlog', label: 'Backlog', description: 'Ideas and next steps' },
  { value: 'in_progress', label: 'In progress', description: 'What’s moving forward' },
  { value: 'done', label: 'Done', description: 'A little progress, collected' },
];
export const priorities: Priority[] = ['low', 'medium', 'high'];

export type DataClassification = 'Transactional' | 'Master Data' | 'Reference Data' | 'Metadata';
export type ModelProperty = { name: string; dataType: string; description: string };
export type ReferenceClassification = 'Internal Reference' | 'External Reference';
export type NodePlacement = { id: string; name: string; x: number; y: number };
export type ModelDefinition = NodePlacement & { kind: 'definition'; classification: DataClassification; draft: boolean; properties: ModelProperty[]; impliedLabels: string[]; displayName?: string };
export type ModelReference = NodePlacement & { kind: 'reference'; classification: ReferenceClassification; target: { modelId: string; nodeId: string } };
export type ModelNode = ModelDefinition | ModelReference;
export type RelationCardinality = '0..*' | '0..1' | '1..*' | '1..1';
export type RelationshipTypeDefinition = { kind: 'definition'; id: string; name: string; displayName?: string; draft: boolean; properties: ModelProperty[]; sourceLabel: string | null; targetLabel: string | null };
export type RelationshipTypeReference = { kind: 'reference'; id: string; name: string; classification: ReferenceClassification; target: { modelId: string; relationshipTypeId: string } };
export type ModelRelationshipType = RelationshipTypeDefinition | RelationshipTypeReference;
export type DefinitionTarget = { kind: 'node' | 'relationship'; definitionId: string };
export type ModelConstraint = { id: string; name: string; draft: boolean; kind: 'KEY' | 'UNIQUE' | 'EXISTS' | 'TYPE'; target: DefinitionTarget; properties: string[] };
export type ModelIndex = { id: string; name: string; draft: boolean; kind: 'RANGE' | 'TEXT' | 'POINT' | 'FULLTEXT' | 'VECTOR' | 'LOOKUP'; targets: DefinitionTarget[]; properties: string[]; filterProperties: string[]; config: Record<string, string | number | boolean | number[]> };
export type ModelRelationship = { id: string; relationshipTypeId: string; source: string; target: string; sourceCardinality: RelationCardinality; targetCardinality: RelationCardinality };
export type ModelInput = { schemaVersion: 3; nodes: ModelNode[]; relationshipTypes: ModelRelationshipType[]; relationships: ModelRelationship[]; constraints: ModelConstraint[]; indexes: ModelIndex[] };
export type StoredModel = ModelInput & { revision: number; sourceSchemaVersion?: 1 | 2 | 3 };
export type NamedModel = { id: string; name: string; model: StoredModel };
export type ModelSummary = { id: string; name: string; deletable: boolean } & ({ available: true; revision: number } | { available: false; error: string });
export type CatalogDefinition = Omit<ModelDefinition, 'x' | 'y'>;
export type ReferenceCatalogModel = { id: string; name: string } & ({ available: true; revision: number; sourceSchemaVersion: 1 | 2 | 3; definitions: CatalogDefinition[]; relationshipTypes: RelationshipTypeDefinition[]; constraints: ModelConstraint[]; indexes: ModelIndex[] } | { available: false; error: string });
export type ValidationResult = { valid: boolean; excludeDrafts: boolean; issues: { severity: 'error' | 'warning'; code: string; modelId: string; path: string; message: string; related?: unknown }[]; dependencies: { modelId: string; revision: number }[] };
export type ExportFormat = 'json' | 'cypher' | 'graph-type';
export type ModelExport = { format: ExportFormat; filename: string; mediaType: string; content: string; validation: ValidationResult; requirements: string[] };
