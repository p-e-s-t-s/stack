// Table ownership rule (docs/PLAN.md §3.0.1): a plugin's migrations may only create,
// alter, drop or write to tables and indexes prefixed with its namespace.

export const NAMESPACE_PATTERN = /^[a-z][a-z0-9]*$/

const IDENT = '[`"\\[]?([A-Za-z_][\\w]*)[`"\\]]?'

const RULES: { kind: string; pattern: RegExp }[] = [
  {
    kind: 'table',
    pattern: new RegExp(
      `\\bCREATE\\s+(?:TEMP\\w*\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`,
      'gi',
    ),
  },
  { kind: 'table', pattern: new RegExp(`\\bALTER\\s+TABLE\\s+${IDENT}`, 'gi') },
  { kind: 'table', pattern: new RegExp(`\\bRENAME\\s+TO\\s+${IDENT}`, 'gi') },
  { kind: 'table', pattern: new RegExp(`\\bDROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'gi') },
  {
    kind: 'index',
    pattern: new RegExp(
      `\\bCREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`,
      'gi',
    ),
  },
  {
    kind: 'table',
    pattern: new RegExp(
      `\\bINDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?[\\w\`"\\[\\]]+\\s+ON\\s+${IDENT}`,
      'gi',
    ),
  },
  { kind: 'index', pattern: new RegExp(`\\bDROP\\s+INDEX\\s+(?:IF\\s+EXISTS\\s+)?${IDENT}`, 'gi') },
  { kind: 'table', pattern: new RegExp(`\\bINSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+${IDENT}`, 'gi') },
  {
    kind: 'table',
    pattern: new RegExp(`(?<!\\bON\\s+)\\bUPDATE\\s+(?:OR\\s+\\w+\\s+)?${IDENT}`, 'gi'),
  },
  { kind: 'table', pattern: new RegExp(`\\bDELETE\\s+FROM\\s+${IDENT}`, 'gi') },
  {
    kind: 'trigger',
    pattern: new RegExp(`\\bCREATE\\s+TRIGGER\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, 'gi'),
  },
  {
    kind: 'view',
    pattern: new RegExp(`\\bCREATE\\s+VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${IDENT}`, 'gi'),
  },
]

export interface OwnershipViolation {
  kind: string
  name: string
  statement: string
}

export function isOwnedName(name: string, namespace: string) {
  // drizzle-kit rebuilds tables through `__new_<table>`
  const bare = name.startsWith('__new_') ? name.slice(6) : name
  return bare.startsWith(namespace + '_')
}

/** Names of objects a statement writes to or changes, excluding SQL comments and strings. */
export function findWrittenNames(statement: string) {
  const code = statement
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
  const found: { kind: string; name: string }[] = []
  for (const { kind, pattern } of RULES) {
    for (const match of code.matchAll(pattern)) found.push({ kind, name: match[1]! })
  }
  return found
}

export function checkOwnership(statements: string[], namespace: string): OwnershipViolation[] {
  const violations: OwnershipViolation[] = []
  for (const statement of statements) {
    for (const { kind, name } of findWrittenNames(statement)) {
      if (!isOwnedName(name, namespace))
        violations.push({ kind, name, statement: statement.trim() })
    }
  }
  return violations
}
