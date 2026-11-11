/** Historical MIT-licensed public regression excerpts; see provenance.json. Do not edit. */
const TRUNCATED_MARKER = "…[truncated]";
interface ExemplarUnit { title: string; body: string; labels: Record<string,string> }
interface ExemplarEntry { [key: string]:string; title: string; body: string }
interface BeadsItem { dependencies?: (string | { depends_on_id?: unknown; kind?:unknown; type?:unknown; id?:unknown })[]; blocked_by?:unknown; [key:string]:unknown }
interface BeadsRepairEdge {line:number;blocker:string}
interface Parsed {lines:string[]}
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
}
function exemplarContext(ranked: readonly ExemplarUnit[], budget: number): ExemplarEntry[] {
  const entries: ExemplarEntry[] = [];
  let used = 2; // The enclosing JSON array brackets count against the budget.
  for (const unit of ranked) {
    const separator = entries.length === 0 ? 0 : 1;
    const body = budgetedBody(unit, (budget * 4 - used - separator) / 4);
    if (body === null) break;
    const entry: ExemplarEntry = { title: unit.title, body, ...unit.labels };
    used += JSON.stringify(entry).length + separator;
    entries.push(entry);
  }
  return entries;
}
function budgetedBody(unit: ExemplarUnit, remaining: number): string | null {
  const skeleton = JSON.stringify({ title: unit.title, body: "", ...unit.labels }).length;
  if (skeleton > remaining * 4) return null;
  if (JSON.stringify({ title: unit.title, body: unit.body, ...unit.labels }).length <= remaining * 4) return unit.body;
  const room = remaining * 4 - skeleton - TRUNCATED_MARKER.length;
  let slice = Math.max(0, room);
  let text = `${unit.body.slice(0, slice)}${TRUNCATED_MARKER}`;
  // Escape inflation can push a candidate over the budget; halve deterministically.
  while (slice > 0 && JSON.stringify({ title: unit.title, body: text, ...unit.labels }).length > remaining * 4) {
    slice = Math.floor(slice / 2);
    text = `${unit.body.slice(0, slice)}${TRUNCATED_MARKER}`;
  }
  return slice === 0 && JSON.stringify({ title: unit.title, body: text, ...unit.labels }).length > remaining * 4 ? "" : text;
}
function scalarString(raw: unknown): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  const value = String(raw).trim();
  return value ? value : undefined;
}
function normalizeBeadKey(id: unknown): string | undefined {
  if (id === undefined || id === null) return undefined;
  const t = String(id).trim();
  return t.length ? t : undefined;
}
function extractBlockerIds(item: BeadsItem): string[] {
  const ids = new Set<string>();
  const push = (v: unknown) => {
    const value = scalarString(v);
    if (value) ids.add(value);
  };
  if (Array.isArray(item.dependencies)) {
    for (const dep of item.dependencies) {
      if (typeof dep === "string") push(dep);
      else if (dep && typeof dep === "object") {
        const dependsOn = scalarString(dep.depends_on_id);
        if (dependsOn) {
          push(dependsOn);
          continue;
        }
        const kind = (scalarString(dep.kind) ?? scalarString(dep.type) ?? "blocked_by").toLowerCase();
        if (kind === "blocked_by" || kind === "depends_on" || kind === "blocks_me") push(dep.id);
      }
    }
  }
  if (Array.isArray(item.blocked_by)) item.blocked_by.forEach(push);
  else push(item.blocked_by);
  return [...ids];
}
function removeEdge(item: BeadsItem, blocker: string): BeadsItem {
  const result = { ...item };
  if (result.dependencies) result.dependencies = result.dependencies.filter(dep => !extractBlockerIds({ dependencies: [dep] }).includes(blocker));
  if (Array.isArray(result.blocked_by)) result.blocked_by = result.blocked_by.filter(id => normalizeBeadKey(id) !== blocker);
  else if (normalizeBeadKey(result.blocked_by) === blocker) delete result.blocked_by;
  return result;
}
function editedText(parsed: Parsed, remove: BeadsRepairEdge[]): string {
  const lines = [...parsed.lines], changed = new Map<number, BeadsItem>();
  for (const edge of remove) {
    const item = changed.get(edge.line) ?? JSON.parse(lines[edge.line - 1]) as BeadsItem;
    changed.set(edge.line, removeEdge(item, edge.blocker));
  }
  for (const [line, item] of changed) lines[line - 1] = JSON.stringify(item);
  return lines.join("\n");
}
export { editedText, tokenize, exemplarContext };
