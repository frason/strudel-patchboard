// Node can't load @kabelsalat/web (browser-only, used by core's repl for a feature we don't use). Stub it for the test harness.
import { register } from 'node:module';
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec === '@kabelsalat/web') return { url: 'data:text/javascript,export class SalatRepl{ evaluate(){} }', shortCircuit: true };
  return next(spec, ctx);
}`));
