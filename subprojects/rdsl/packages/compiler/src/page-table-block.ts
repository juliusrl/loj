import type { IRDashboardBlock, IRListView, IRModel, IRModelField, IRReadModel, IRResource } from './ir.js';

type HasManyField = IRModelField & {
  fieldType: { type: 'relation'; kind: 'hasMany'; target: string; by: string };
};

type RecordRelationResolution =
  | {
      kind: 'invalid';
      reason:
        | 'resourceMissing'
        | 'modelMissing'
        | 'relationFieldMissing'
        | 'relationFieldNotHasMany'
        | 'targetModelMissing'
        | 'targetResourceMissing';
      data?: string;
      resourceName?: string;
      readModelName?: string;
      relationFieldName?: string;
      resource?: IRResource;
      model?: IRModel;
      relationField?: IRModelField;
      targetModel?: IRModel;
      targetResource?: IRResource;
    }
  | {
      kind: 'resolved';
      data: string;
      resourceName: string;
      relationFieldName: string;
      resource: IRResource;
      model: IRModel;
      relationField: HasManyField;
      targetModel: IRModel;
      targetResource: IRResource;
    };

export type PageBlockDataAnalysis =
  | { kind: 'none' }
  | {
      kind: 'invalid';
      reason:
        | 'missingData'
        | 'unsupportedDataRef'
        | 'resourceMissing'
        | 'resourceListMissing'
        | 'readModelMissing'
        | 'readModelListMissing'
        | 'modelMissing'
        | 'relationFieldMissing'
        | 'relationFieldNotHasMany'
        | 'targetModelMissing'
        | 'targetResourceMissing'
        | 'targetResourceListMissing';
      data?: string;
      resourceName?: string;
      readModelName?: string;
      relationFieldName?: string;
      resource?: IRResource;
      model?: IRModel;
      relationField?: IRModelField;
      targetModel?: IRModel;
      targetResource?: IRResource;
      readModel?: IRReadModel;
    }
  | {
      kind: 'readModelCount';
      data: string;
      readModelName: string;
      readModel: IRReadModel;
    }
  | {
      kind: 'resourceList';
      data: string;
      resourceName: string;
      resource: IRResource;
      model: IRModel;
      listView: IRListView;
    }
  | {
      kind: 'recordRelationList';
      data: string;
      resourceName: string;
      relationFieldName: string;
      resource: IRResource;
      model: IRModel;
      relationField: HasManyField;
      targetModel: IRModel;
      targetResource: IRResource;
      listView?: IRListView;
    }
  | {
      kind: 'readModelList';
      data: string;
      readModelName: string;
      readModel: IRReadModel;
      listView: NonNullable<IRReadModel['list']>;
    }
  | {
      kind: 'recordRelationCount';
      data: string;
      resourceName: string;
      relationFieldName: string;
      resource: IRResource;
      model: IRModel;
      relationField: HasManyField;
      targetModel: IRModel;
      targetResource: IRResource;
    };

export type PageTableBlockDataAnalysis = PageBlockDataAnalysis;

function resolveRecordRelationData(
  data: string,
  resourceName: string,
  relationFieldName: string,
  resources: readonly IRResource[],
  models: readonly IRModel[],
): RecordRelationResolution {
  const resource = resources.find((candidate) => candidate.name === resourceName);
  if (!resource) {
    return {
      kind: 'invalid',
      reason: 'resourceMissing',
      data,
      resourceName,
    };
  }

  const model = models.find((candidate) => candidate.name === resource.model);
  if (!model) {
    return {
      kind: 'invalid',
      reason: 'modelMissing',
      data,
      resourceName,
      resource,
    };
  }

  const relationField = model.fields.find((candidate) => candidate.name === relationFieldName);
  if (!relationField) {
    return {
      kind: 'invalid',
      reason: 'relationFieldMissing',
      data,
      resourceName,
      relationFieldName,
      resource,
      model,
    };
  }

  if (relationField.fieldType.type !== 'relation' || relationField.fieldType.kind !== 'hasMany') {
    return {
      kind: 'invalid',
      reason: 'relationFieldNotHasMany',
      data,
      resourceName,
      relationFieldName,
      resource,
      model,
      relationField,
    };
  }
  const hasManyField = relationField as HasManyField;

  const targetModel = models.find((candidate) => candidate.name === hasManyField.fieldType.target);
  if (!targetModel) {
    return {
      kind: 'invalid',
      reason: 'targetModelMissing',
      data,
      resourceName,
      relationFieldName,
      resource,
      model,
      relationField: hasManyField,
    };
  }

  const targetResource = resources.find((candidate) => candidate.model === hasManyField.fieldType.target);
  if (!targetResource) {
    return {
      kind: 'invalid',
      reason: 'targetResourceMissing',
      data,
      resourceName,
      relationFieldName,
      resource,
      model,
      relationField: hasManyField,
      targetModel,
    };
  }

  return {
    kind: 'resolved',
    data,
    resourceName,
    relationFieldName,
    resource,
    model,
    relationField: hasManyField,
    targetModel,
    targetResource,
  };
}

export function analyzePageBlockData(
  block: IRDashboardBlock,
  resources: readonly IRResource[],
  models: readonly IRModel[],
  readModels: readonly IRReadModel[] = [],
): PageBlockDataAnalysis {
  if (block.blockType === 'metric') {
    const data = block.data?.trim();
    if (!data) {
      return { kind: 'none' };
    }

    const readModelCountMatch = data.match(/^readModel\.([A-Za-z][A-Za-z0-9_-]*)\.count$/);
    if (readModelCountMatch) {
      const readModelName = readModelCountMatch[1];
      const readModel = readModels.find((candidate) => candidate.name === readModelName);
      if (!readModel) {
        return {
          kind: 'invalid',
          reason: 'readModelMissing',
          data,
          readModelName,
        };
      }
      return {
        kind: 'readModelCount',
        data,
        readModelName,
        readModel,
      };
    }

    const relationCountMatch = data.match(/^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)\.count$/);
    if (!relationCountMatch) {
      return { kind: 'none' };
    }

    const [, resourceName, relationFieldName] = relationCountMatch;
    if (!resources.some((candidate) => candidate.name === resourceName)) {
      return { kind: 'none' };
    }
    const relation = resolveRecordRelationData(data, resourceName, relationFieldName, resources, models);
    if (relation.kind === 'invalid') {
      return relation;
    }

    return {
      kind: 'recordRelationCount',
      data,
      resourceName,
      relationFieldName,
      resource: relation.resource,
      model: relation.model,
      relationField: relation.relationField,
      targetModel: relation.targetModel,
      targetResource: relation.targetResource,
    };
  }

  if (block.blockType !== 'table') {
    return { kind: 'none' };
  }

  const data = block.data?.trim();
  if (!data) {
    return {
      kind: 'invalid',
      reason: 'missingData',
    };
  }

  const listMatch = data.match(/^([A-Za-z][A-Za-z0-9_-]*)\.list$/);
  if (listMatch) {
    const resourceName = listMatch[1];
    const resource = resources.find((candidate) => candidate.name === resourceName);
    if (!resource) {
      return {
        kind: 'invalid',
        reason: 'resourceMissing',
        data,
        resourceName,
      };
    }

    const model = models.find((candidate) => candidate.name === resource.model);
    if (!model) {
      return {
        kind: 'invalid',
        reason: 'modelMissing',
        data,
        resourceName,
        resource,
      };
    }

    if (!resource.views.list) {
      return {
        kind: 'invalid',
        reason: 'resourceListMissing',
        data,
        resourceName,
        resource,
        model,
      };
    }

    return {
      kind: 'resourceList',
      data,
      resourceName,
      resource,
      model,
      listView: resource.views.list,
    };
  }

  const readModelListMatch = data.match(/^readModel\.([A-Za-z][A-Za-z0-9_-]*)\.list$/);
  if (readModelListMatch) {
    const readModelName = readModelListMatch[1];
    const readModel = readModels.find((candidate) => candidate.name === readModelName);
    if (!readModel) {
      return {
        kind: 'invalid',
        reason: 'readModelMissing',
        data,
        readModelName,
      };
    }
    if (!readModel.list) {
      return {
        kind: 'invalid',
        reason: 'readModelListMissing',
        data,
        readModelName,
        readModel,
      };
    }
    return {
      kind: 'readModelList',
      data,
      readModelName,
      readModel,
      listView: readModel.list,
    };
  }

  const relationMatch = data.match(/^([A-Za-z][A-Za-z0-9_-]*)\.([A-Za-z][A-Za-z0-9_-]*)$/);
  if (!relationMatch) {
    return {
      kind: 'invalid',
      reason: 'unsupportedDataRef',
      data,
    };
  }

  const [, resourceName, relationFieldName] = relationMatch;
  const relation = resolveRecordRelationData(data, resourceName, relationFieldName, resources, models);
  if (relation.kind === 'invalid') {
    return relation;
  }

  return {
    kind: 'recordRelationList',
    data,
    resourceName,
    relationFieldName,
    resource: relation.resource,
    model: relation.model,
    relationField: relation.relationField,
    targetModel: relation.targetModel,
    targetResource: relation.targetResource,
    listView: relation.targetResource.views.list,
  };
}

export const analyzePageTableBlockData = analyzePageBlockData;
