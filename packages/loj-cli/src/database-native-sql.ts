import type { IRFieldDecorator, IRModel, IRModelField, IRSdslProgram } from '@loj-lang/sdsl-compiler/ir';

export type NativeSqlVendor =
  | 'h2'
  | 'sqlite'
  | 'postgres'
  | 'mysql'
  | 'mariadb'
  | 'sqlserver'
  | 'oracle';

export function generateNativeSqlSchema(ir: IRSdslProgram, vendor: NativeSqlVendor): string {
  const lines: string[] = [
    `-- Generated native SQL schema for ${vendor}`,
    `-- app: ${ir.app.name}`,
    '-- This file is generated from .api.loj models via the project-shell database profile.',
    '',
  ];

  for (const model of ir.models) {
    lines.push(renderCreateTableStatement(model, vendor));
    lines.push('');
  }

  const foreignKeys = ir.models.flatMap((model) => collectForeignKeyStatements(model, vendor));
  if (foreignKeys.length > 0) {
    lines.push(...foreignKeys);
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

function renderCreateTableStatement(model: IRModel, vendor: NativeSqlVendor): string {
  const tableName = safeTableName(model.name);
  const columns: string[] = [`  id ${identityPrimaryKeyType(vendor)}`];
  const tableConstraints: string[] = [];

  for (const field of persistedModelFields(model)) {
    columns.push(`  ${renderColumnDefinition(model, field, vendor)}`);
    if (field.fieldType.type === 'enum') {
      tableConstraints.push(renderEnumConstraint(model, field, vendor));
    }
  }

  const body = [...columns, ...tableConstraints].join(',\n');
  return `CREATE TABLE ${tableName} (\n${body}\n);`;
}

function renderColumnDefinition(model: IRModel, field: IRModelField, vendor: NativeSqlVendor): string {
  const columnName = persistedColumnName(field);
  const required = hasDecorator(field, 'required') || hasDecorator(field, 'createdAt') || hasDecorator(field, 'updatedAt');
  const unique = hasDecorator(field, 'unique');
  const parts = [columnName, columnType(model, field, vendor)];

  if (required) {
    parts.push('NOT NULL');
  }
  if (unique) {
    parts.push('UNIQUE');
  }
  if (hasDecorator(field, 'createdAt') || hasDecorator(field, 'updatedAt')) {
    const currentTimestamp = currentTimestampExpression(vendor);
    if (currentTimestamp) {
      parts.push(`DEFAULT ${currentTimestamp}`);
    }
  }

  return parts.join(' ');
}

function renderEnumConstraint(model: IRModel, field: IRModelField, vendor: NativeSqlVendor): string {
  const tableName = safeTableName(model.name);
  const columnName = persistedColumnName(field);
  const values = field.fieldType.type === 'enum'
    ? field.fieldType.values.map((value) => `'${escapeSqlLiteral(value)}'`).join(', ')
    : '';
  return `  CONSTRAINT ${constraintName('ck', tableName, columnName, vendor)} CHECK (${columnName} IN (${values}))`;
}

function collectForeignKeyStatements(model: IRModel, vendor: NativeSqlVendor): string[] {
  const tableName = safeTableName(model.name);
  return persistedModelFields(model)
    .filter((field): field is IRModelField & { fieldType: { type: 'relation'; kind: 'belongsTo'; target: string } } =>
      field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo')
    .map((field) => {
      const columnName = persistedColumnName(field);
      const targetTableName = safeTableName(field.fieldType.target);
      return `ALTER TABLE ${tableName}\n  ADD CONSTRAINT ${constraintName('fk', tableName, columnName, vendor)} FOREIGN KEY (${columnName}) REFERENCES ${targetTableName}(id);`;
    });
}

function persistedModelFields(model: IRModel): IRModelField[] {
  return model.fields.filter((field) => !(field.fieldType.type === 'relation' && field.fieldType.kind === 'hasMany'));
}

function persistedColumnName(field: IRModelField): string {
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return `${field.name}_id`;
  }
  return field.name;
}

function columnType(model: IRModel, field: IRModelField, vendor: NativeSqlVendor): string {
  if (field.fieldType.type === 'enum') {
    const longestValue = Math.max(16, ...field.fieldType.values.map((value) => value.length));
    return varcharType(longestValue, vendor);
  }

  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return relationColumnType(vendor);
  }

  if (field.fieldType.type !== 'scalar') {
    return varcharType(255, vendor);
  }

  switch (field.fieldType.name) {
    case 'string':
      return varcharType(255, vendor);
    case 'text':
      return textType(vendor);
    case 'integer':
      return integerType(vendor);
    case 'long':
      return longType(vendor);
    case 'decimal':
      return decimalType(vendor);
    case 'boolean':
      return booleanType(vendor);
    case 'datetime':
      return dateTimeType(vendor);
    case 'date':
      return 'DATE';
  }
  return varcharType(255, vendor);
}

function identityPrimaryKeyType(vendor: NativeSqlVendor): string {
  switch (vendor) {
    case 'sqlite':
      return 'INTEGER PRIMARY KEY AUTOINCREMENT';
    case 'postgres':
      return 'BIGSERIAL PRIMARY KEY';
    case 'mysql':
    case 'mariadb':
      return 'BIGINT AUTO_INCREMENT PRIMARY KEY';
    case 'sqlserver':
      return 'BIGINT IDENTITY(1,1) PRIMARY KEY';
    case 'oracle':
      return 'NUMBER(19) GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY';
    case 'h2':
      return 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY';
  }
  return 'BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY';
}

function relationColumnType(vendor: NativeSqlVendor): string {
  switch (vendor) {
    case 'oracle':
      return 'NUMBER(19)';
    case 'sqlite':
      return 'INTEGER';
    default:
      return 'BIGINT';
  }
}

function varcharType(length: number, vendor: NativeSqlVendor): string {
  if (vendor === 'oracle') {
    return `VARCHAR2(${length})`;
  }
  if (vendor === 'sqlserver') {
    return `NVARCHAR(${length})`;
  }
  return `VARCHAR(${length})`;
}

function textType(vendor: NativeSqlVendor): string {
  switch (vendor) {
    case 'h2':
      return 'CLOB';
    case 'sqlserver':
      return 'NVARCHAR(MAX)';
    case 'oracle':
      return 'CLOB';
    default:
      return 'TEXT';
  }
}

function integerType(vendor: NativeSqlVendor): string {
  if (vendor === 'sqlserver') {
    return 'INT';
  }
  if (vendor === 'oracle') {
    return 'NUMBER(10)';
  }
  return 'INTEGER';
}

function longType(vendor: NativeSqlVendor): string {
  switch (vendor) {
    case 'oracle':
      return 'NUMBER(19)';
    case 'sqlite':
      return 'INTEGER';
    default:
      return 'BIGINT';
  }
}

function decimalType(vendor: NativeSqlVendor): string {
  if (vendor === 'oracle') {
    return 'NUMBER(18, 2)';
  }
  return 'NUMERIC(18, 2)';
}

function booleanType(vendor: NativeSqlVendor): string {
  switch (vendor) {
    case 'sqlserver':
      return 'BIT';
    case 'oracle':
      return 'NUMBER(1)';
    case 'sqlite':
      return 'INTEGER';
    default:
      return 'BOOLEAN';
  }
}

function dateTimeType(vendor: NativeSqlVendor): string {
  switch (vendor) {
    case 'postgres':
      return 'TIMESTAMP WITH TIME ZONE';
    case 'mysql':
    case 'mariadb':
      return 'DATETIME(6)';
    case 'sqlserver':
      return 'DATETIME2';
    case 'oracle':
      return 'TIMESTAMP WITH TIME ZONE';
    case 'sqlite':
      return 'TEXT';
    case 'h2':
      return 'TIMESTAMP WITH TIME ZONE';
  }
}

function currentTimestampExpression(vendor: NativeSqlVendor): string | null {
  switch (vendor) {
    case 'oracle':
      return 'CURRENT_TIMESTAMP';
    default:
      return 'CURRENT_TIMESTAMP';
  }
}

function safeTableName(modelName: string): string {
  const baseName = toSnakeCase(modelName);
  if (SQL_RESERVED_IDENTIFIERS.has(baseName.toLowerCase())) {
    return `${baseName}_records`;
  }
  return baseName;
}

function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase())
    .join('_');
}

function hasDecorator(field: { decorators: IRFieldDecorator[] }, decoratorName: string): boolean {
  return field.decorators.some((decorator) => decorator.name === decoratorName);
}

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function constraintName(
  prefix: 'fk' | 'ck',
  tableName: string,
  columnName: string,
  vendor: NativeSqlVendor,
): string {
  const raw = `${prefix}_${tableName}_${columnName}`;
  const maxLength = vendor === 'oracle' ? 30 : 63;
  if (raw.length <= maxLength) {
    return raw;
  }
  const suffix = shortHash(raw);
  const head = raw.slice(0, Math.max(0, maxLength - suffix.length - 1));
  return `${head}_${suffix}`;
}

function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36).slice(0, 6);
}

const SQL_RESERVED_IDENTIFIERS = new Set([
  'group',
  'order',
  'select',
  'table',
  'user',
  'where',
]);
