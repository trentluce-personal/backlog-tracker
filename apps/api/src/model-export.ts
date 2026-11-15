import type { Composition, ComposedDefinition, ComposedConstraint, Issue } from './model-validation.ts';
import { parsePropertyType } from './model-types.ts';

// Encode the backslash itself, preventing a literal user \u sequence being decoded.
// Unicode escapes are decoded once by Cypher's escaped-identifier lexer.
export const quoteIdentifier = (text: string) => '`' + text.replace(/\\/g, '\\u005c').replace(/`/g, '``') + '`';
const literal = (value: string | number | boolean | number[]): string => typeof value === 'string'
  ? "'" + value.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'" : JSON.stringify(value);
const pattern = (d: ComposedDefinition, variable = 'e') => d.kind === 'node' ? `(${variable}:${quoteIdentifier(d.definition.name)})` : `()-[${variable}:${quoteIdentifier(d.definition.name)}]-()`;
function requirement(c: ComposedConstraint): string {
  const { constraint } = c;
  const properties = constraint.properties.map(p => `e.${quoteIdentifier(p)}`);
  if (constraint.kind === 'EXISTS') return `${properties[0]} IS NOT NULL`;
  if (constraint.kind === 'TYPE') {
    const property = c.definition.definition.properties.find(p => p.name === constraint.properties[0])!;
    return `${properties[0]} IS :: ${parsePropertyType(property.dataType)!.cypher}`;
  }
  return `(${properties.join(', ')}) IS ${constraint.kind === 'KEY' ? (c.definition.kind === 'node' ? 'NODE KEY' : 'RELATIONSHIP KEY') : 'UNIQUE'}`;
}
function constraintDDL(c: ComposedConstraint) { return `CREATE CONSTRAINT ${quoteIdentifier(c.constraint.name)} IF NOT EXISTS FOR ${pattern(c.definition)} REQUIRE ${requirement(c)};`; }
function indexesDDL(composition: Composition): string[] {
  return composition.indexes.map(({ index, definitions }) => {
    const name = quoteIdentifier(index.name);
    if (index.kind === 'LOOKUP') return `CREATE LOOKUP INDEX ${name} IF NOT EXISTS FOR ${index.config.entity === 'node' ? '(e) ON EACH labels(e)' : '()-[e]-() ON EACH type(e)'};`;
    const tokens = definitions.map(d => quoteIdentifier(d.definition.name)).join('|');
    const pattern = definitions[0]!.kind === 'node' ? `(e:${tokens})` : `()-[e:${tokens}]-()`;
    const properties = index.properties.map(p => `e.${quoteIdentifier(p)}`).join(', ');
    const on = index.kind === 'FULLTEXT' ? `EACH [${properties}]` : `(${properties})`;
    const filter = index.filterProperties.length ? ` WITH [${index.filterProperties.map(p => `e.${quoteIdentifier(p)}`).join(', ')}]` : '';
    const options = Object.keys(index.config).length ? ` OPTIONS {indexConfig: {${Object.entries(index.config).map(([k, v]) => `${quoteIdentifier(k)}: ${literal(v)}`).join(', ')}}}` : '';
    return `CREATE ${index.kind} INDEX ${name} IF NOT EXISTS FOR ${pattern} ON ${on}${filter}${options};`;
  });
}
function issue(composition: Composition, severity: Issue['severity'], code: string, modelId: string, path: string, message: string) {
  composition.validation.issues.push({ severity, code, modelId, path, message });
  if (severity === 'error') composition.validation.valid = false;
}
export function exportModel(composition: Composition, modelId: string, format: 'json' | 'cypher' | 'graph-type', acknowledged = false) {
  const requirements = new Set<string>();
  if (format !== 'json') {
    requirements.add('Neo4j with Cypher 25; CREATE CONSTRAINT and CREATE INDEX privileges as applicable.');
    for (const c of composition.constraints) if (['KEY', 'EXISTS', 'TYPE'].includes(c.constraint.kind)) requirements.add('Neo4j Enterprise Edition for KEY, EXISTS and TYPE constraints.');
    for (const d of composition.definitions) {
      if (d.definition.properties.some(p => parsePropertyType(p.dataType)?.vector)) requirements.add('Native VECTOR properties require Neo4j 2025.10+, Enterprise Edition and block format (or Aura).');
      if (d.definition.properties.some(p => parsePropertyType(p.dataType)?.cypher.includes('UUID'))) requirements.add('Native UUID properties require Neo4j 2026.08+, Cypher 25, Enterprise Edition and block format (or Aura).');
    }
    if (composition.indexes.some(i => i.index.kind === 'VECTOR' && (i.definitions.length > 1 || i.index.filterProperties.length))) requirements.add('Multi-target and filtered VECTOR indexes require Neo4j 2026.01+ and Cypher 25.');
    issue(composition, 'warning', 'CURRENT_CYPHER_REQUIRED', modelId, '', 'Export targets current Neo4j Cypher 25; verify the listed version and edition requirements.');
  }
  if (format === 'cypher') {
    for (const d of composition.definitions) {
      if (d.kind === 'node' && 'impliedLabels' in d.definition && d.definition.impliedLabels.length || d.kind === 'relationship' && 'sourceLabel' in d.definition && (d.definition.sourceLabel !== null || d.definition.targetLabel !== null)) issue(composition, 'error', 'GRAPH_TYPE_REQUIRED', d.modelId, d.path, 'Implied labels and endpoint label requirements need graph-type export.');
    }
  }
  const graphElements: string[] = [];
  if (format === 'graph-type') {
    requirements.add('Neo4j Enterprise Edition 2026.06+ with Cypher 25; CREATE CONSTRAINT, DROP CONSTRAINT and NAME MANAGEMENT privileges.');
    issue(composition, 'warning', 'GRAPH_TYPE_REPLACEMENT', modelId, '', 'ALTER CURRENT GRAPH TYPE SET replaces the current graph type and existing constraints.');
    if (!acknowledged) issue(composition, 'error', 'GRAPH_TYPE_ACKNOWLEDGEMENT_REQUIRED', modelId, '', 'Explicit graph-type replacement acknowledgement is required.');
    const identifying = new Set(composition.definitions.filter(d => d.kind === 'node').map(d => d.definition.name));
    const root = composition.fragments.find(f => f.modelId === modelId)?.model;
    if (root) {
      const resolvePlacement = (id: string, relationship = false) => {
        const placement = (relationship ? root.relationshipTypes : root.nodes).find(d => d.id === id);
        if (!placement) return undefined;
        const owner = placement.kind === 'reference' ? placement.target.modelId : modelId;
        const targetId = placement.kind === 'reference' ? ('nodeId' in placement.target ? placement.target.nodeId : placement.target.relationshipTypeId) : placement.id;
        return composition.definitions.find(d => d.modelId === owner && d.kind === (relationship ? 'relationship' : 'node') && d.definition.id === targetId);
      };
      for (const d of composition.definitions.filter(d => d.kind === 'relationship')) {
        if (!('sourceLabel' in d.definition)) continue;
        const edges = root.relationships.filter(r => resolvePlacement(r.relationshipTypeId, true) === d);
        for (const end of ['source', 'target'] as const) {
          const label = end === 'source' ? d.definition.sourceLabel : d.definition.targetLabel;
          const nodes = edges.map(r => resolvePlacement(r[end])).filter((n): n is ComposedDefinition => !!n);
          if (label === null && new Set(nodes.map(n => n.definition.name)).size > 1) issue(composition, 'error', 'AMBIGUOUS_RELATIONSHIP_SCOPE', d.modelId, d.path, 'Multiple endpoint labels require an explicit shared endpoint label for graph-type export.');
          if (label !== null && nodes.some(n => n.definition.name !== label && 'impliedLabels' in n.definition && !n.definition.impliedLabels.includes(label))) issue(composition, 'error', 'RELATIONSHIP_ENDPOINT_LABEL', d.modelId, d.path, 'A diagram endpoint does not carry the relationship type required endpoint label.');
        }
      }
    }
    for (const d of composition.definitions) {
      const def = d.definition;
      if ('impliedLabels' in def && def.impliedLabels.some(label => identifying.has(label))) issue(composition, 'error', 'IDENTIFYING_IMPLIED_COLLISION', d.modelId, `${d.path}/impliedLabels`, 'A graph-type label cannot be both identifying and implied.');
      const constraints = composition.constraints.filter(c => c.definition === d);
      const exists = new Set(constraints.filter(c => ['KEY', 'EXISTS'].includes(c.constraint.kind)).flatMap(c => c.constraint.properties));
      const typed = new Set(constraints.filter(c => c.constraint.kind === 'TYPE').flatMap(c => c.constraint.properties));
      const properties = def.properties.filter(p => exists.has(p.name) || typed.has(p.name)).map(p => {
        // ANY NOT NULL expresses existence without imposing the declaration's type.
        // Neo4j documents this form for graph-type property existence requirements.
        if (!typed.has(p.name)) return `${quoteIdentifier(p.name)} :: ANY NOT NULL`;
        const parsed = parsePropertyType(p.dataType);
        if (!parsed) return '';
        if (parsed.genericVector) issue(composition, 'error', 'TYPE_VECTOR_PARAMETERS', d.modelId, d.path, 'Graph-type VECTOR properties require explicit coordinate type and dimension.');
        if (parsed.cypher.includes('PROPERTY VALUE') || parsed.cypher.includes('LIST<UUID')) issue(composition, 'error', 'GRAPH_TYPE_UNSUPPORTED_PROPERTY_TYPE', d.modelId, d.path, 'This declaration is not supported as a graph-type property requirement.');
        if (parsed.cypher.includes(' | ') && exists.has(p.name)) {
          issue(composition, 'error', 'GRAPH_TYPE_UNSUPPORTED_REQUIRED_UNION', d.modelId, d.path, 'Required union properties are not supported by this graph-type exporter.');
        }
        return `${quoteIdentifier(p.name)} :: ${parsed.cypher}${exists.has(p.name) ? ' NOT NULL' : ''}`;
      });
      const propertyMap = properties.length ? ` {${properties.join(', ')}}` : '';
      if (d.kind === 'node' && 'impliedLabels' in def) {
        // Empty element requirements have no graph-type representation.
        if (!properties.length && !def.impliedLabels.length) {
          issue(composition, 'error', 'GRAPH_TYPE_EMPTY_ELEMENT', d.modelId, d.path, 'An element without property or implied-label requirements has no supported graph-type representation.');
          continue;
        }
        graphElements.push(`(:${quoteIdentifier(def.name)} =>${def.impliedLabels.length ? ` :${def.impliedLabels.map(quoteIdentifier).join('&')}` : ''}${propertyMap})`);
      } else if ('sourceLabel' in def) {
        if (!properties.length && def.sourceLabel === null && def.targetLabel === null) {
          issue(composition, 'error', 'GRAPH_TYPE_EMPTY_ELEMENT', d.modelId, d.path, 'An element without property or endpoint requirements has no supported graph-type representation.');
          continue;
        }
        const endpoint = (label: string | null) => label === null ? '()' : `(:${quoteIdentifier(label)})`;
        graphElements.push(`${endpoint(def.sourceLabel)}-[:${quoteIdentifier(def.name)} =>${propertyMap}]->${endpoint(def.targetLabel)}`);
      }
    }
    for (const c of composition.constraints) if (c.constraint.kind === 'KEY' || c.constraint.kind === 'UNIQUE') {
      graphElements.push(`CONSTRAINT ${quoteIdentifier(c.constraint.name)} FOR ${pattern(c.definition).replace(']-()', ']->()')} REQUIRE ${requirement(c).replace(/IS (NODE|RELATIONSHIP) KEY$/, 'IS KEY')}`);
    }
    if (composition.constraints.some(c => c.constraint.kind === 'TYPE' || c.constraint.kind === 'EXISTS')) issue(composition, 'warning', 'GRAPH_TYPE_GENERATED_CONSTRAINT_NAMES', modelId, '', 'Graph-type property existence and type constraints use Neo4j-generated names.');
  }
  if (!composition.validation.valid) return { status: 422, body: { error: 'Model cannot be exported.', validation: composition.validation } };
  let content: string;
  if (format === 'json') content = JSON.stringify({ version: 1, rootModelId: modelId, fragments: composition.fragments, dependencies: composition.validation.dependencies }, null, 2) + '\n';
  else if (format === 'cypher') content = [...composition.constraints.map(constraintDDL), ...indexesDDL(composition)].join('\n') + '\n';
  else content = `ALTER CURRENT GRAPH TYPE SET {\n  ${graphElements.join(',\n  ')}\n};\n${indexesDDL(composition).join('\n')}\n`;
  return { status: 200, body: { format, filename: `model-${modelId}.${format === 'json' ? 'json' : 'cypher'}`, mediaType: format === 'json' ? 'application/json' : 'text/plain', content, validation: composition.validation, requirements: [...requirements] } };
}
