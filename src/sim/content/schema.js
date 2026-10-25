// A small, dependency-free schema validator for mod content and manifests.
// It collects human-readable errors and the cross references to check after all mods load.
import { ID_RE } from '../util.js';

const ALWAYS_ALLOWED = new Set(['$override', '$comment', 'description']);

export function validate(value, schema, path, ctx) {
  const err = (msg) => ctx.errors.push(`${path || '(root)'}: ${msg}`);
  if (value === undefined || value === null) {
    if (schema.required) err('is required');
    return;
  }
  switch (schema.type) {
    case 'string':
      if (typeof value !== 'string') return err('must be text');
      if (schema.maxLen && value.length > schema.maxLen) err(`must be at most ${schema.maxLen} characters`);
      if (schema.minLen && value.length < schema.minLen) err(`must be at least ${schema.minLen} characters`);
      if (schema.pattern && !schema.pattern.test(value)) err(`has an invalid format (${JSON.stringify(value)})`);
      break;
    case 'number':
    case 'int':
      if (typeof value !== 'number' || !Number.isFinite(value)) return err('must be a number');
      if (schema.type === 'int' && !Number.isInteger(value)) return err('must be a whole number');
      if (schema.min !== undefined && value < schema.min) err(`must be >= ${schema.min}`);
      if (schema.max !== undefined && value > schema.max) err(`must be <= ${schema.max}`);
      break;
    case 'bool':
      if (typeof value !== 'boolean') err('must be true or false');
      break;
    case 'id':
    case 'tag':
      if (typeof value !== 'string' || !ID_RE.test(value)) err(`must be a namespaced id like "mymod:thing" (got ${JSON.stringify(value)})`);
      break;
    case 'ref':
      if (typeof value !== 'string' || !ID_RE.test(value)) return err(`must be a namespaced ${schema.to} id (got ${JSON.stringify(value)})`);
      ctx.refs.push({ to: schema.to, id: value, path });
      break;
    case 'color':
      if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) err(`must be a color like "#a0b0c0" (got ${JSON.stringify(value)})`);
      break;
    case 'enum':
      if (!schema.values.includes(value)) err(`must be one of: ${schema.values.join(', ')} (got ${JSON.stringify(value)})`);
      break;
    case 'array':
      if (!Array.isArray(value)) return err('must be a list');
      if (schema.minItems !== undefined && value.length < schema.minItems) err(`needs at least ${schema.minItems} entries`);
      if (schema.maxItems !== undefined && value.length > schema.maxItems) err(`allows at most ${schema.maxItems} entries`);
      value.forEach((v, i) => validate(v, schema.items, `${path}[${i}]`, ctx));
      break;
    case 'object': {
      if (typeof value !== 'object' || Array.isArray(value)) return err('must be an object');
      for (const [k, s] of Object.entries(schema.props)) validate(value[k], s, path ? `${path}.${k}` : k, ctx);
      if (!schema.extra) {
        for (const k of Object.keys(value)) {
          if (!(k in schema.props) && !ALWAYS_ALLOWED.has(k)) err(`unknown field "${k}"`);
        }
      }
      if (schema.check) schema.check(value, err);
      break;
    }
    case 'map':
      if (typeof value !== 'object' || Array.isArray(value)) return err('must be an object');
      for (const [k, v] of Object.entries(value)) {
        if (schema.keys) validate(k, schema.keys, `${path} key "${k}"`, ctx);
        validate(v, schema.values, `${path}.${k}`, ctx);
      }
      break;
    case 'any':
      break;
    default:
      err(`internal: unknown schema type ${schema.type}`);
  }
}

// Helpers for writing schemas compactly.
export const req = (s) => ({ ...s, required: true });
export const str = (maxLen = 200) => ({ type: 'string', maxLen });
export const num = (min, max) => ({ type: 'number', min, max });
export const int = (min, max) => ({ type: 'int', min, max });
export const bool = () => ({ type: 'bool' });
export const ref = (to) => ({ type: 'ref', to });
export const arr = (items, extra = {}) => ({ type: 'array', items, ...extra });
export const obj = (props, extra = {}) => ({ type: 'object', props, ...extra });
export const map = (keys, values) => ({ type: 'map', keys, values });
