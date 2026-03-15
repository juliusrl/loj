import type { IRModel, IRModelField, IRResource } from './ir.js';

type RelationRootField = IRModelField & { fieldType: { type: 'relation'; kind: 'belongsTo' | 'hasMany'; target: string } };
type BelongsToRootField = IRModelField & { fieldType: { type: 'relation'; kind: 'belongsTo'; target: string } };
type HasManyRootField = IRModelField & { fieldType: { type: 'relation'; kind: 'hasMany'; target: string; by: string } };
type ProjectableTargetField = IRModelField & (
  | { fieldType: { type: 'scalar'; name: 'string' | 'number' | 'boolean' | 'datetime' } }
  | { fieldType: { type: 'enum'; values: string[] } }
);

export type RelationProjectionAnalysis =
  | { kind: 'none' }
  | {
      kind: 'invalid';
      reason:
        | 'unsupportedPathShape'
        | 'unknownRootField'
        | 'rootFieldNotRelation'
        | 'targetModelMissing'
        | 'targetResourceMissing'
        | 'unsupportedHasManyLeaf'
        | 'unknownTargetField'
        | 'unsupportedTargetField';
      field: string;
      rootFieldName?: string;
      leafFieldName?: string;
      rootField?: IRModelField;
      targetModel?: IRModel;
      targetResource?: IRResource;
      targetField?: IRModelField;
    }
  | {
      kind: 'belongsToField';
      field: string;
      rootFieldName: string;
      leafFieldName: string;
      rootField: BelongsToRootField;
      targetModel: IRModel;
      targetResource: IRResource;
      targetField: ProjectableTargetField;
    }
  | {
      kind: 'hasManyCount';
      field: string;
      rootFieldName: string;
      leafFieldName: 'count';
      rootField: HasManyRootField;
      targetModel: IRModel;
      targetResource: IRResource;
    };

export function analyzeRelationProjection(
  field: string,
  model: IRModel,
  models: readonly IRModel[],
  resources: readonly IRResource[],
): RelationProjectionAnalysis {
  const parts = field.split('.');
  if (parts.length === 1) {
    return { kind: 'none' };
  }
  if (parts.length !== 2 || parts.some((part) => part.trim().length === 0)) {
    return {
      kind: 'invalid',
      reason: 'unsupportedPathShape',
      field,
    };
  }

  const [rootFieldName, leafFieldName] = parts;
  const rootField = model.fields.find((candidate) => candidate.name === rootFieldName);
  if (!rootField) {
    return {
      kind: 'invalid',
      reason: 'unknownRootField',
      field,
      rootFieldName,
      leafFieldName,
    };
  }
  if (rootField.fieldType.type !== 'relation') {
    return {
      kind: 'invalid',
      reason: 'rootFieldNotRelation',
      field,
      rootFieldName,
      leafFieldName,
      rootField,
    };
  }
  const relationRootField = rootField as RelationRootField;

  const targetModel = models.find((candidate) => candidate.name === relationRootField.fieldType.target);
  if (!targetModel) {
    return {
      kind: 'invalid',
      reason: 'targetModelMissing',
      field,
      rootFieldName,
      leafFieldName,
      rootField: relationRootField,
    };
  }

  const targetResource = resources.find((candidate) => candidate.model === targetModel.name);
  if (!targetResource) {
    return {
      kind: 'invalid',
      reason: 'targetResourceMissing',
      field,
      rootFieldName,
      leafFieldName,
      rootField: relationRootField,
      targetModel,
    };
  }

  if (relationRootField.fieldType.kind === 'hasMany') {
    const hasManyRootField = relationRootField as HasManyRootField;
    if (leafFieldName !== 'count') {
      return {
        kind: 'invalid',
        reason: 'unsupportedHasManyLeaf',
        field,
        rootFieldName,
        leafFieldName,
        rootField: hasManyRootField,
        targetModel,
        targetResource,
      };
    }

    return {
      kind: 'hasManyCount',
      field,
      rootFieldName,
      leafFieldName: 'count',
      rootField: hasManyRootField,
      targetModel,
      targetResource,
    };
  }

  const targetField = targetModel.fields.find((candidate) => candidate.name === leafFieldName);
  if (!targetField) {
    return {
      kind: 'invalid',
      reason: 'unknownTargetField',
      field,
      rootFieldName,
      leafFieldName,
      rootField: relationRootField,
      targetModel,
      targetResource,
    };
  }
  if (targetField.fieldType.type === 'relation') {
    return {
      kind: 'invalid',
      reason: 'unsupportedTargetField',
      field,
      rootFieldName,
      leafFieldName,
      rootField: relationRootField,
      targetModel,
      targetResource,
      targetField,
    };
  }
  const belongsToRootField = relationRootField as BelongsToRootField;
  const projectableTargetField = targetField as ProjectableTargetField;

  return {
    kind: 'belongsToField',
    field,
    rootFieldName,
    leafFieldName,
    rootField: belongsToRootField,
    targetModel,
    targetResource,
    targetField: projectableTargetField,
  };
}
