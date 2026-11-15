import type { ModelInput, ModelNode, ModelRelationshipType } from '../types';

export const serializeModel = (model: ModelInput) => JSON.stringify({ schemaVersion: 3, nodes: model.nodes, relationshipTypes: model.relationshipTypes, relationships: model.relationships, constraints: model.constraints, indexes: model.indexes });
export const rebaseNodes = (nodes: ModelNode[], modelId: string): ModelNode[] => nodes.map(node => node.kind === 'reference' && node.classification === 'Internal Reference' ? { ...node, target: { ...node.target, modelId } } : node);
export const rebaseTypes = (types: ModelRelationshipType[], modelId: string): ModelRelationshipType[] => types.map(type => type.kind === 'reference' && type.classification === 'Internal Reference' ? { ...type, target: { ...type.target, modelId } } : type);
