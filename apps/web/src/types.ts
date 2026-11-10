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
export type PropertyIndex = 'None' | 'Range' | 'Text' | 'Point';
export type ModelProperty = { name: string; dataType: string; description: string; nodeKey: boolean; uniqueness: boolean; mustExist: boolean; index: PropertyIndex };
export type ReferenceClassification = 'Internal Reference' | 'External Reference';
export type NodePlacement = { id: string; name: string; x: number; y: number };
export type ModelDefinition = NodePlacement & { kind: 'definition'; classification: DataClassification; draft: boolean; properties: ModelProperty[] };
export type ModelReference = NodePlacement & { kind: 'reference'; classification: ReferenceClassification; target: { modelId: string; nodeId: string } };
export type ModelNode = ModelDefinition | ModelReference;
export type RelationCardinality = '0..*' | '1..*' | '1..1';
export type ModelRelationship = { id: string; name: string; source: string; target: string; sourceCardinality: RelationCardinality; targetCardinality: RelationCardinality };
export type ModelInput = { schemaVersion: 2; nodes: ModelNode[]; relationships: ModelRelationship[] };
export type StoredModel = ModelInput & { revision: number };
export type NamedModel = { id: string; name: string; model: StoredModel };
export type ModelSummary = { id: string; name: string; deletable: boolean } & ({ available: true; revision: number } | { available: false; error: string });
export type CatalogDefinition = Pick<ModelDefinition, 'id' | 'name' | 'classification' | 'draft' | 'properties'>;
export type ReferenceCatalogModel = { id: string; name: string } & ({ available: true; revision: number; definitions: CatalogDefinition[] } | { available: false; error: string });
