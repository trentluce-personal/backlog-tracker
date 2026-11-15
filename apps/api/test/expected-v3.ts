// Independent expectation oracle for the original schema-1/2 integration fixtures.
// Every full graph comparison verifies the migrated schema objects, not just nodes.
import strict from 'node:assert/strict';
type Row = Record<string, any>;
function expected(value: any): any {
  if (Array.isArray(value)) return value.map(expected);
  if (!value || typeof value !== 'object' || Buffer.isBuffer(value)) return value;
  if ((value.schemaVersion === 1 || value.schemaVersion === 2) && Array.isArray(value.nodes) && Array.isArray(value.relationships)) {
    const constraints: Row[] = [], indexes: Row[] = [], relationshipTypes: Row[] = [];
    const nodes = value.nodes.map((node: Row) => {
      if (node.kind === 'reference') return node;
      for (const p of node.properties ?? []) {
        const target = { kind: 'node', definitionId: node.id };
        const kinds = p.nodeKey ? ['KEY'] : [...(p.uniqueness ? ['UNIQUE'] : []), ...(p.mustExist ? ['EXISTS'] : [])];
        for (const kind of kinds) { const n = constraints.length + 1; constraints.push({ id: `constraint-${n}`, name: `migrated_constraint_${n}`, kind, draft: false, target, properties: [p.name] }); }
        const index = p.index === true ? 'Range' : p.index === false ? 'None' : p.index;
        if (index && index !== 'None' && !(index === 'Range' && (p.nodeKey || p.uniqueness))) {
          const n = indexes.length + 1;
          indexes.push({ id: `index-${n}`, name: `migrated_index_${n}`, kind: index.toUpperCase(), draft: false, targets: [target], properties: [p.name], filterProperties: [], config: {} });
        }
      }
      return expected({ classification: 'Transactional', draft: false, properties: [], ...node, kind: 'definition' });
    });
    const relationships = value.relationships.map((r: Row) => {
      let type = relationshipTypes.find(t => t.name === r.name);
      if (!type) { type = { kind: 'definition', id: `relationship-type-${relationshipTypes.length + 1}`, name: r.name, draft: false, properties: [], sourceLabel: null, targetLabel: null }; relationshipTypes.push(type); }
      const { name, ...edge } = r;
      return { sourceCardinality: '0..*', targetCardinality: '0..*', ...edge, relationshipTypeId: type.id };
    });
    return { ...value, schemaVersion: 3, nodes, relationships, relationshipTypes, constraints, indexes };
  }
  const result = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, expected(v)]));
  if (result.kind === 'definition' && typeof result.x === 'number') result.impliedLabels ??= [];
  if (typeof result.dataType === 'string' && Object.hasOwn(result, 'nodeKey')) for (const key of ['nodeKey', 'uniqueness', 'mustExist', 'index']) delete result[key];
  return result;
}
export const assert = Object.assign((...args: Parameters<typeof strict>) => strict(...args), strict, {
  deepEqual(actual: unknown, legacyExpected: unknown, message?: string) { strict.deepEqual(actual, expected(legacyExpected), message); },
});
