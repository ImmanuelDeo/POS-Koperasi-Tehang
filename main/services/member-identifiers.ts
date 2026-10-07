import Database from 'better-sqlite3';

export type MemberIdentifierField = 'nik' | 'member_no' | 'employee_id';

export function findMemberIdentifierConflict(
  db: Database.Database,
  field: MemberIdentifierField,
  value: string,
  exceptId?: string
): { id: string; name: string } | undefined {
  const exclusion = exceptId ? ' AND id != ?' : '';
  const params = exceptId ? [value, exceptId] : [value];

  return db.prepare(`
    SELECT id, name
    FROM customers
    WHERE ${field} IS NOT NULL
      AND TRIM(${field}) != ''
      AND LOWER(TRIM(${field})) = LOWER(TRIM(?))
      ${exclusion}
    LIMIT 1
  `).get(...params) as { id: string; name: string } | undefined;
}
