import { contracts } from './contracts.mjs';
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const string = maxLength => ({ type: 'string', minLength: 1, maxLength });
const integer = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const date = { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$' };
const dates = { type: 'array', minItems: 2, maxItems: 2, items: date };
const symbol = { type: 'string', pattern: '^[A-Z][A-Z0-9.]{0,5}$' };
const symbols = { type: 'array', uniqueItems: true, minItems: 1, maxItems: 12, items: symbol };
const withId = (id, schema) => ({ $schema: 'https://json-schema.org/draft/2020-12/schema', $id: 'urn:mingstreet:' + id, ...schema });
export const graphSchema = withId('research-graph:1', object({ schema_version: { const: '1.0' }, name: string(160),
  nodes: { type: 'array', minItems: 1, maxItems: contracts.LIMITS.nodes, items: { oneOf: contracts.blocks.map(b => object({
    id: { type: 'string', pattern: '^[a-zA-Z][a-zA-Z0-9_-]{0,39}$' }, type: { const: b.key }, version: { const: b.version },
    params: b.params_schema, position: object({ x: { type: 'number', minimum: 0, maximum: 5000 }, y: { type: 'number', minimum: 0, maximum: 5000 } }),
  }, ['id', 'type', 'version', 'params'])) } },
  edges: { type: 'array', maxItems: contracts.LIMITS.edges, items: object({ from: string(100), to: string(100) }) },
  research_config: object({ snapshot_id: { type: 'string', pattern: '^snap_[a-f0-9]{64}$' }, as_of: { type: 'string', format: 'date-time' }, random_seed: integer(1, 2147483647),
    currency: { const: 'USD' }, base_calendar: { const: 'XNYS' }, mode: { enum: ['descriptive', 'conditional', 'strategy', 'forecast'] } }),
  viewport: object({ x: { type: 'number' }, y: { type: 'number' }, zoom: { type: 'number', minimum: 0.3, maximum: 2 } }),
}, ['schema_version', 'name', 'nodes', 'edges', 'research_config']));
export const evaluationPlanSchema = withId('evaluation-plan:2', object({ schema: { const: 'mingstreet.evaluation-plan.v2' },
  target: { enum: ['forward_return', 'benchmark_relative_return'] }, universe: symbols, discovery: dates, holdout: dates,
  horizon_sessions: integer(1, 60), embargo_sessions: integer(2, 120), benchmark: symbol,
  costs: object({ commission_bps: { type: 'number', minimum: 0, maximum: 500 }, slippage_bps: { type: 'number', minimum: 0, maximum: 500 } }),
  max_trials: integer(1, 100), min_events: integer(5, 500), bootstrap_samples: integer(100, 1000),
  execution: { const: 'next_open' }, primary_metric: { const: 'mean_excess_return' } }));
export const interpretationSchema = withId('research-interpretation:2', object({ schema: { const: 'mingstreet.research-interpretation.v2' },
  export_id: string(80), experiment_id: string(80), run_id: string(80), graph_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  evaluation_plan_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' }, dataset_sha256: { type: 'string', pattern: '^[a-f0-9]{64}$' },
  author_type: { const: 'external_ai_assisted' }, summary: string(6000), created_at: { type: 'string', format: 'date-time' },
  findings: { type: 'array', maxItems: 50, items: object({ type: { const: 'quantitative_reference' }, claim: string(2000), metric_id: string(200),
    expected_value: { oneOf: [{ type: 'number' }, { type: 'string', maxLength: 40, pattern: '^-?(?:0|[1-9]\\d*)(?:\\.\\d+)?(?:[eE][+-]?\\d{1,3})?$' }] }, expected_unit: string(50), assessment: { enum: ['supported', 'limited', 'unknown'] }, limitations: string(2000) }) },
  interpretations: { type: 'array', maxItems: 30, items: string(3000) }, unknowns: { type: 'array', maxItems: 30, items: string(3000) },
  proposed_tests: { type: 'array', maxItems: 10, items: object({ title: string(160), rationale: string(3000) }) },
}, ['schema', 'export_id', 'experiment_id', 'run_id', 'graph_sha256', 'evaluation_plan_sha256', 'author_type', 'summary', 'created_at', 'findings', 'interpretations', 'unknowns', 'proposed_tests']));
