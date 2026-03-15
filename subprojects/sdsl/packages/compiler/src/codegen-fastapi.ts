import type { IRFieldDecorator, IRModel, IRModelField, IRReadModel, IRReadModelField, IRResource, IRSdslProgram } from './ir.js';
import type { CodegenOptions } from './codegen.js';

interface GeneratedFileLike {
  path: string;
  content: string;
  sourceNode: string;
}

export function generateFastApiProject(ir: IRSdslProgram, options: CodegenOptions = {}): { files: GeneratedFileLike[] } {
  const files: GeneratedFileLike[] = [];
  const applicationSlug = toKebabCase(ir.app.name);
  const policyResources = ir.resources.filter((resource) => resource.auth.policy);
  const hasReadModels = ir.readModels.length > 0;
  const hasLinkedRules = ir.resources.some((resource) => resource.create?.rules) || ir.readModels.some((readModel) => readModel.rules);
  const hasWorkflows = ir.resources.some((resource) => resource.workflow);

  files.push({
    path: 'pyproject.toml',
    content: generatePyproject(ir),
    sourceNode: ir.app.id,
  });
  files.push({
    path: '.gitignore',
    content: ['.venv/', '__pycache__/', '.pytest_cache/', '*.pyc', '*.pyo', 'loj.db', 'test_*.db', '.DS_Store', ''].join('\n'),
    sourceNode: ir.app.id,
  });
  files.push({
    path: 'GENERATED.md',
    content: generateGeneratedNotice(),
    sourceNode: ir.app.id,
  });
  files.push({
    path: 'README.md',
    content: generateProjectReadme(ir),
    sourceNode: ir.app.id,
  });
  files.push({
    path: 'app/__init__.py',
    content: '',
    sourceNode: ir.app.id,
  });
  files.push({
    path: 'app/config.py',
    content: generateConfig(ir),
    sourceNode: ir.app.id,
  });
  files.push({
    path: 'app/db.py',
    content: generateDb(ir),
    sourceNode: ir.app.id,
  });
  files.push({
    path: 'app/security.py',
    content: generateSecurity(ir),
    sourceNode: ir.app.id,
  });
  if (policyResources.length > 0 || hasReadModels || hasLinkedRules || hasWorkflows) {
    files.push({
      path: 'app/custom/__init__.py',
      content: '',
      sourceNode: ir.id,
    });
    files.push({
      path: 'app/custom/policies/__init__.py',
      content: '',
      sourceNode: ir.id,
    });
  }
  if (hasReadModels) {
    files.push({
      path: 'app/custom/read_models/__init__.py',
      content: '',
      sourceNode: ir.id,
    });
  }
  if (hasLinkedRules) {
    files.push({
      path: 'app/custom/rules/__init__.py',
      content: '',
      sourceNode: ir.id,
    });
  }
  if (hasWorkflows) {
    files.push({
      path: 'app/custom/workflows/__init__.py',
      content: '',
      sourceNode: ir.id,
    });
  }
  files.push({
    path: 'app/main.py',
    content: generateMain(ir),
    sourceNode: ir.app.id,
  });
  files.push({
    path: 'app/models/__init__.py',
    content: generateModelsIndex(ir),
    sourceNode: ir.id,
  });
  files.push({
    path: 'app/models/base.py',
    content: generateModelBase(),
    sourceNode: ir.id,
  });
  files.push({
    path: 'app/schemas/__init__.py',
    content: generateSchemasIndex(ir),
    sourceNode: ir.id,
  });
  files.push({
    path: 'app/routes/__init__.py',
    content: generateRoutesIndex(ir),
    sourceNode: ir.id,
  });
  files.push({
    path: 'app/services/__init__.py',
    content: generateServicesIndex(ir),
    sourceNode: ir.id,
  });
  files.push({
    path: 'tests/__init__.py',
    content: '',
    sourceNode: ir.id,
  });

  for (const model of ir.models) {
    files.push({
      path: `app/models/${toSnakeCase(model.name)}.py`,
      content: generateModelModule(ir, model),
      sourceNode: model.id,
    });
    files.push({
      path: `app/schemas/${toSnakeCase(model.name)}.py`,
      content: generateSchemaModule(model),
      sourceNode: model.id,
    });
    files.push({
      path: `app/services/${toSnakeCase(model.name)}.py`,
      content: generateServiceModule(ir, model),
      sourceNode: model.id,
    });
  }

  for (const resource of ir.resources) {
    const model = ir.models.find((candidate) => candidate.name === resource.model);
    if (!model) {
      continue;
    }
    const nestedCreate = analyzeNestedCreateResource(ir, resource, model);
    const nestedUpdate = analyzeNestedUpdateResource(ir, resource, model);
    if (nestedCreate) {
      files.push({
        path: `app/schemas/${resourceCreateSchemaModuleName(resource)}.py`,
        content: generateResourceCreateSchemaModule(resource, model, nestedCreate.includes),
        sourceNode: resource.create!.id,
      });
    }
    if (nestedUpdate) {
      files.push({
        path: `app/schemas/${resourceUpdateSchemaModuleName(resource)}.py`,
        content: generateResourceUpdateSchemaModule(resource, model, nestedUpdate.includes),
        sourceNode: resource.update!.id,
      });
    }
    if (resource.auth.policy) {
      files.push({
        path: `app/custom/policies/${toSnakeCase(resource.name)}_policy.py`,
        content: generatePolicyModule(resource, options.readFile),
        sourceNode: resource.id,
      });
    }
    if (resource.create?.rules) {
      files.push({
        path: `app/custom/rules/${toSnakeCase(resource.name)}_create_rules.py`,
        content: generateCreateRulesModule(resource),
        sourceNode: resource.create.id,
      });
    }
    if (resource.workflow) {
      files.push({
        path: `app/custom/workflows/${toSnakeCase(resource.name)}_workflow.py`,
        content: generateWorkflowModule(resource as IRResource & { workflow: NonNullable<IRResource['workflow']> }, model),
        sourceNode: resource.workflow.id,
      });
    }
    files.push({
      path: `app/routes/${toSnakeCase(resource.name)}.py`,
      content: generateRouteModule(ir, resource, model),
      sourceNode: resource.id,
    });
    files.push({
      path: `tests/test_${toSnakeCase(resource.name)}_api.py`,
      content: generateApiTestModule(ir, resource, model),
      sourceNode: resource.id,
    });
  }

  for (const readModel of ir.readModels) {
    files.push({
      path: `app/schemas/${toSnakeCase(readModel.name)}_read_model.py`,
      content: generateReadModelSchemaModule(readModel),
      sourceNode: readModel.id,
    });
    files.push({
      path: `app/custom/read_models/${toSnakeCase(readModel.name)}_read_model.py`,
      content: generateReadModelHandlerModule(readModel, options.readFile),
      sourceNode: readModel.id,
    });
    if (readModel.rules) {
      files.push({
        path: `app/custom/rules/${toSnakeCase(readModel.name)}_read_model_rules.py`,
        content: generateReadModelRulesModule(readModel),
        sourceNode: readModel.id,
      });
    }
    files.push({
      path: `app/routes/${toSnakeCase(readModel.name)}_read_model.py`,
      content: generateReadModelRouteModule(readModel),
      sourceNode: readModel.id,
    });
  }

  return { files };
}

function generatePyproject(ir: IRSdslProgram): string {
  return `[project]
name = "${toKebabCase(ir.app.name)}"
version = "0.1.0"
description = "Generated backend-family FastAPI service"
readme = "README.md"
requires-python = ">=3.12"
dependencies = [
  "fastapi>=0.115,<1",
  "sqlalchemy>=2.0,<3",
  "uvicorn>=0.32,<1",
  "pydantic[email]>=2.9,<3",
]

[project.optional-dependencies]
dev = [
  "pytest>=8,<9",
  "httpx>=0.28,<1",
]

[build-system]
requires = ["setuptools>=68"]
build-backend = "setuptools.build_meta"

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]

[tool.setuptools.packages.find]
include = ["app*"]
`;
}

function generateProjectReadme(ir: IRSdslProgram): string {
  const commands = [
    '# Generated FastAPI Service',
    '',
    `This project was generated from backend-family source for the target \`fastapi/python/rest-sqlalchemy-auth\`.`,
    '',
    '## Suggested commands',
    '',
    '```bash',
    'python3 -m venv .venv',
    'source .venv/bin/activate',
    'pip install -e .[dev]',
    'pytest',
    'uvicorn app.main:app --reload',
    '```',
    '',
    `Default local database: \`sqlite:///./loj.db\``,
    `Default admin credentials: \`admin / admin123\``,
  ];
  if (collectProtectedRoles(ir).includes('SUPPORT')) {
    commands.push('Default support credentials: `support / support123`');
  }
  commands.push('');
  return commands.join('\n');
}

function generateConfig(ir: IRSdslProgram): string {
  const protectedRoles = collectProtectedRoles(ir);
  const adminRoles = protectedRoles.length > 0 ? protectedRoles : ['ADMIN'];
  const basicUsers = [
    {
      username: 'admin',
      password: 'admin123',
      roles: adminRoles,
    },
    ...(protectedRoles.includes('SUPPORT')
      ? [{
        username: 'support',
        password: 'support123',
        roles: ['SUPPORT'],
      }]
      : []),
  ];
  const renderedUsers = basicUsers
    .map((user) => `    BasicUserConfig(username="${user.username}", password="${user.password}", roles=${pythonTuple(user.roles.map((role) => `"${role}"`))}),`)
    .join('\n');

  return `from __future__ import annotations

from dataclasses import dataclass
import os


@dataclass(frozen=True)
class BasicUserConfig:
  username: str
  password: str
  roles: tuple[str, ...]


@dataclass(frozen=True)
class Settings:
  app_name: str
  database_url: str
  basic_users: tuple[BasicUserConfig, ...]


SETTINGS = Settings(
  app_name="${escapePythonString(ir.app.name)}",
  database_url=os.getenv("LOJ_DATABASE_URL", "sqlite:///./loj.db"),
  basic_users=(
${renderedUsers}
  ),
)
`;
}

function generateDb(ir: IRSdslProgram): string {
  return `from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.config import SETTINGS


def _connect_args(database_url: str) -> dict[str, object]:
  if database_url.startswith("sqlite"):
    return {"check_same_thread": False}
  return {}


engine = create_engine(
  SETTINGS.database_url,
  future=True,
  connect_args=_connect_args(SETTINGS.database_url),
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)


async def get_db() -> AsyncIterator[Session]:
  db = SessionLocal()
  try:
    yield db
  finally:
    db.close()
`;
}

function generateSecurity(ir: IRSdslProgram): string {
  return `from __future__ import annotations

from dataclasses import dataclass
import secrets

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBasic, HTTPBasicCredentials

from app.config import SETTINGS


http_basic = HTTPBasic()


@dataclass(frozen=True)
class AuthenticatedUser:
  username: str
  roles: tuple[str, ...]


def _unauthorized(detail: str) -> HTTPException:
  return HTTPException(
    status_code=status.HTTP_401_UNAUTHORIZED,
    detail=detail,
    headers={"WWW-Authenticate": "Basic"},
  )


def _resolve_user(credentials: HTTPBasicCredentials) -> AuthenticatedUser:
  for candidate in SETTINGS.basic_users:
    username_matches = secrets.compare_digest(credentials.username, candidate.username)
    password_matches = secrets.compare_digest(credentials.password, candidate.password)
    if username_matches and password_matches:
      return AuthenticatedUser(username=candidate.username, roles=candidate.roles)
  raise _unauthorized("Invalid credentials")


async def require_authenticated(credentials: HTTPBasicCredentials = Depends(http_basic)) -> AuthenticatedUser:
  return _resolve_user(credentials)


def require_roles(*roles: str):
  async def dependency(credentials: HTTPBasicCredentials = Depends(http_basic)) -> AuthenticatedUser:
    user = _resolve_user(credentials)
    if roles and not any(role in user.roles for role in roles):
      raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    return user

  return dependency
`;
}

function generateMain(ir: IRSdslProgram): string {
  const routeImports = [
    ...ir.resources
      .map((resource) => `from app.routes.${toSnakeCase(resource.name)} import router as ${toSnakeCase(resource.name)}_router`),
    ...ir.readModels
      .map((readModel) => `from app.routes.${toSnakeCase(readModel.name)}_read_model import router as ${toSnakeCase(readModel.name)}_read_model_router`),
  ].join('\n');
  const routeIncludes = [
    ...ir.resources
      .map((resource) => `app.include_router(${toSnakeCase(resource.name)}_router)`),
    ...ir.readModels
      .map((readModel) => `app.include_router(${toSnakeCase(readModel.name)}_read_model_router)`),
  ].join('\n');

  return `from __future__ import annotations

# Generated by Loj. Prefer editing source .api.loj files, linked files, or documented escape hatches instead of this generated file.

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError

from app.config import SETTINGS
from app.db import engine
from app.models import Base
${routeImports}


def _validation_message(error: RequestValidationError) -> str:
  issues = []
  for issue in error.errors():
    location = ".".join(str(part) for part in issue.get("loc", []))
    issues.append(f"{location}: {issue.get('msg', 'Validation error')}")
  return "; ".join(issues) if issues else "Validation failed"


Base.metadata.create_all(bind=engine)
app = FastAPI(title=SETTINGS.app_name)


@app.exception_handler(HTTPException)
async def handle_http_exception(_: Request, exception: HTTPException) -> JSONResponse:
  detail = exception.detail
  message = detail if isinstance(detail, str) else "Request failed"
  return JSONResponse(status_code=exception.status_code, content={"message": message})


@app.exception_handler(RequestValidationError)
async def handle_validation(_: Request, exception: RequestValidationError) -> JSONResponse:
  return JSONResponse(status_code=400, content={"message": _validation_message(exception)})


@app.exception_handler(IntegrityError)
async def handle_integrity(_: Request, __: IntegrityError) -> JSONResponse:
  return JSONResponse(status_code=400, content={"message": "Data integrity violation"})


@app.exception_handler(Exception)
async def handle_generic(_: Request, __: Exception) -> JSONResponse:
  return JSONResponse(status_code=500, content={"message": "Internal server error"})


@app.get("/healthz")
async def healthz() -> dict[str, str]:
  return {"status": "ok"}


${routeIncludes}
`;
}

function generateGeneratedNotice(): string {
  return [
    '# Generated Output',
    '',
    'This directory is generated by Loj.',
    '',
    'Prefer editing source `.api.loj`, linked rules/workflow/SQL files, or documented escape hatches instead of editing generated files directly.',
    '',
    'If you need an emergency hotfix, you may patch generated code temporarily, but the durable fix should go back into source DSL, an escape hatch, or the generator/runtime itself.',
    '',
    'If the generated output itself is wrong, keep the hotfix narrow, then report it as a generator/runtime bug.',
    '',
  ].join('\n');
}

function generateModelBase(): string {
  return `from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
  pass


def utc_now() -> datetime:
  return datetime.now(timezone.utc)
`;
}

function generateModelsIndex(ir: IRSdslProgram): string {
  const importLines = ['from app.models.base import Base'];
  const names: string[] = ['Base'];
  for (const model of ir.models) {
    const symbols = [model.name, ...model.fields
      .filter((field) => field.fieldType.type === 'enum')
      .map((field) => enumClassName(model.name, field.name))];
    importLines.push(`from app.models.${toSnakeCase(model.name)} import ${symbols.join(', ')}`);
    names.push(...symbols);
  }
  return `${importLines.join('\n')}\n\n__all__ = [${names.map((name) => `"${name}"`).join(', ')}]\n`;
}

function generateSchemasIndex(ir: IRSdslProgram): string {
  const importLines: string[] = [];
  const names: string[] = [];
  for (const model of ir.models) {
    const createName = `${model.name}Create`;
    const updateName = `${model.name}Update`;
    const responseName = `${model.name}Response`;
    importLines.push(`from app.schemas.${toSnakeCase(model.name)} import ${createName}, ${updateName}, ${responseName}`);
    names.push(createName, updateName, responseName);
  }
  for (const resource of ir.resources) {
    const model = ir.models.find((candidate) => candidate.name === resource.model);
    if (!model) {
      continue;
    }
    const nestedCreate = analyzeNestedCreateResource(ir, resource, model);
    if (!nestedCreate) {
      continue;
    }
    const createName = resourceCreateSchemaClassName(resource);
    const itemNames = nestedCreate.includes.map((include) => resourceCreateItemSchemaClassName(resource, include.fieldName));
    importLines.push(`from app.schemas.${resourceCreateSchemaModuleName(resource)} import ${[...itemNames, createName].join(', ')}`);
    names.push(...itemNames, createName);
  }
  for (const readModel of ir.readModels) {
    const inputName = readModelInputClassName(readModel);
    const resultName = readModelResultClassName(readModel);
    importLines.push(`from app.schemas.${toSnakeCase(readModel.name)}_read_model import ${inputName}, ${resultName}`);
    names.push(inputName, resultName);
  }
  return `${importLines.join('\n')}\n\n__all__ = [${names.map((name) => `"${name}"`).join(', ')}]\n`;
}

function generateRoutesIndex(ir: IRSdslProgram): string {
  const importLines = [
    ...ir.resources.map((resource) => `from app.routes.${toSnakeCase(resource.name)} import router as ${toSnakeCase(resource.name)}_router`),
    ...ir.readModels.map((readModel) => `from app.routes.${toSnakeCase(readModel.name)}_read_model import router as ${toSnakeCase(readModel.name)}_read_model_router`),
  ];
  const names = [
    ...ir.resources.map((resource) => `${toSnakeCase(resource.name)}_router`),
    ...ir.readModels.map((readModel) => `${toSnakeCase(readModel.name)}_read_model_router`),
  ];
  return `${importLines.join('\n')}\n\n__all__ = [${names.map((name) => `"${name}"`).join(', ')}]\n`;
}

function generateServicesIndex(ir: IRSdslProgram): string {
  const importLines: string[] = [];
  const names: string[] = [];
  for (const model of ir.models) {
    const symbols = [
      `list_${toSnakeCase(model.name)}_records`,
      `get_${toSnakeCase(model.name)}_or_404`,
      `create_${toSnakeCase(model.name)}`,
      `update_${toSnakeCase(model.name)}`,
      `delete_${toSnakeCase(model.name)}`,
    ];
    importLines.push(`from app.services.${toSnakeCase(model.name)} import ${symbols.join(', ')}`);
    names.push(...symbols);
  }
  for (const resource of ir.resources) {
    const model = ir.models.find((candidate) => candidate.name === resource.model);
    if (!model) {
      continue;
    }
    if (!analyzeNestedCreateResource(ir, resource, model)) {
      continue;
    }
    const symbol = resourceCreateServiceFunctionName(resource);
    importLines.push(`from app.services.${toSnakeCase(model.name)} import ${symbol}`);
    names.push(symbol);
  }
  for (const resource of ir.resources) {
    const model = ir.models.find((candidate) => candidate.name === resource.model);
    if (!model || !resource.workflow) {
      continue;
    }
    const symbols = [
      workflowCreateServiceFunctionName(resource),
      workflowUpdateServiceFunctionName(resource),
      workflowTransitionServiceFunctionName(resource),
    ];
    importLines.push(`from app.services.${toSnakeCase(model.name)} import ${symbols.join(', ')}`);
    names.push(...symbols);
  }
  return `${importLines.join('\n')}\n\n__all__ = [${names.map((name) => `"${name}"`).join(', ')}]\n`;
}

function generateModelModule(ir: IRSdslProgram, model: IRModel): string {
  const persistedFields = persistedModelFields(model);
  const imports = new Set<string>([
    'import enum',
    'from sqlalchemy import Boolean, Date, DateTime, Enum as SqlEnum, ForeignKey, Integer, Numeric, String, Text',
    'from sqlalchemy.orm import Mapped, mapped_column',
    'from app.models.base import Base, utc_now',
  ]);

  for (const field of persistedFields) {
    if (field.fieldType.type === 'scalar' && field.fieldType.name === 'datetime') {
      imports.add('from datetime import datetime');
    }
    if (field.fieldType.type === 'scalar' && field.fieldType.name === 'date') {
      imports.add('from datetime import date');
    }
    if (field.fieldType.type === 'scalar' && field.fieldType.name === 'decimal') {
      imports.add('from decimal import Decimal');
    }
  }

  const enumBlocks = persistedFields
    .filter((field) => field.fieldType.type === 'enum')
    .map((field) => generateEnumBlock(model, field));

  const fieldLines = [
    '  id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)',
    ...persistedFields.map((field) => `  ${field.name}: Mapped[${fieldPythonType(model, field)}] = ${mappedColumn(field, model)}`),
  ];

  return `from __future__ import annotations

${Array.from(imports).sort().join('\n')}

${enumBlocks.join('\n\n')}
class ${model.name}(Base):
  __tablename__ = "${safeTableName(model.name)}"

${fieldLines.join('\n')}
`;
}

function generateSchemaModule(model: IRModel): string {
  const persistedFields = persistedModelFields(model);
  const imports = new Set<string>([
    'from pydantic import BaseModel, ConfigDict, Field',
  ]);
  const modelImports: string[] = [];

  for (const field of persistedFields) {
    if (field.fieldType.type === 'scalar' && field.fieldType.name === 'datetime') {
      imports.add('from datetime import datetime');
    }
    if (field.fieldType.type === 'scalar' && field.fieldType.name === 'date') {
      imports.add('from datetime import date');
    }
    if (field.fieldType.type === 'scalar' && field.fieldType.name === 'decimal') {
      imports.add('from decimal import Decimal');
    }
    if (hasDecorator(field, 'email')) {
      imports.add('from pydantic import EmailStr');
    }
    if (field.fieldType.type === 'enum') {
      modelImports.push(enumClassName(model.name, field.name));
    }
  }

  if (modelImports.length > 0) {
    imports.add(`from app.models.${toSnakeCase(model.name)} import ${modelImports.join(', ')}`);
  }

  const writeFields = editableModelFields(model).map((field) => `  ${field.name}: ${schemaFieldType(model, field)}${schemaFieldDefault(field)}`);
  const responseFields = [
    '  id: int',
    ...persistedFields.map((field) => `  ${field.name}: ${schemaResponseFieldType(model, field)}`),
  ];

  return `from __future__ import annotations

${Array.from(imports).sort().join('\n')}


class ${model.name}Base(BaseModel):
${writeFields.length > 0 ? writeFields.join('\n') : '  pass'}


class ${model.name}Create(${model.name}Base):
  pass


class ${model.name}Update(${model.name}Base):
  pass


class ${model.name}Response(BaseModel):
${responseFields.join('\n')}

  model_config = ConfigDict(from_attributes=True)
`;
}

interface NestedCreateIncludeAnalysis {
  include: NonNullable<IRResource['create']>['includes'][number];
  fieldName: string;
  relationField: IRModelField & { fieldType: { type: 'relation'; kind: 'hasMany'; target: string; by: string } };
  targetModel: IRModel;
  childFields: IRModelField[];
}

interface NestedCreateResourceAnalysis {
  resource: IRResource;
  rootModel: IRModel;
  includes: NestedCreateIncludeAnalysis[];
}

interface NestedUpdateResourceAnalysis {
  resource: IRResource;
  rootModel: IRModel;
  includes: NestedCreateIncludeAnalysis[];
}

function analyzeNestedCreateResource(
  ir: IRSdslProgram,
  resource: IRResource,
  model: IRModel,
): NestedCreateResourceAnalysis | null {
  if (!resource.create || resource.create.includes.length === 0) {
    return null;
  }
  const fieldMap = new Map(model.fields.map((field) => [field.name, field]));
  const includes: NestedCreateIncludeAnalysis[] = [];
  for (const include of resource.create.includes) {
    const relationFieldCandidate = fieldMap.get(include.field);
    if (
      !relationFieldCandidate
      || relationFieldCandidate.fieldType.type !== 'relation'
      || relationFieldCandidate.fieldType.kind !== 'hasMany'
    ) {
      return null;
    }
    const relationField = relationFieldCandidate as IRModelField & {
      fieldType: { type: 'relation'; kind: 'hasMany'; target: string; by: string };
    };
    const targetModel = ir.models.find((candidate) => candidate.name === relationField.fieldType.target);
    if (!targetModel) {
      return null;
    }
    const targetFieldMap = new Map(targetModel.fields.map((field) => [field.name, field]));
    const childFields = include.fields
      .map((fieldName) => targetFieldMap.get(fieldName))
      .filter((field): field is IRModelField => Boolean(field));
    if (childFields.length !== include.fields.length) {
      return null;
    }
    includes.push({
      include,
      fieldName: include.field,
      relationField,
      targetModel,
      childFields,
    });
  }
  return {
    resource,
    rootModel: model,
    includes,
  };
}

function analyzeNestedUpdateResource(
  ir: IRSdslProgram,
  resource: IRResource,
  model: IRModel,
): NestedUpdateResourceAnalysis | null {
  if (!resource.update || resource.update.includes.length === 0) {
    return null;
  }
  const fieldMap = new Map(model.fields.map((field) => [field.name, field]));
  const includes: NestedCreateIncludeAnalysis[] = [];
  for (const include of resource.update.includes) {
    const relationFieldCandidate = fieldMap.get(include.field);
    if (
      !relationFieldCandidate
      || relationFieldCandidate.fieldType.type !== 'relation'
      || relationFieldCandidate.fieldType.kind !== 'hasMany'
    ) {
      return null;
    }
    const relationField = relationFieldCandidate as IRModelField & {
      fieldType: { type: 'relation'; kind: 'hasMany'; target: string; by: string };
    };
    const targetModel = ir.models.find((candidate) => candidate.name === relationField.fieldType.target);
    if (!targetModel) {
      return null;
    }
    const targetFieldMap = new Map(targetModel.fields.map((field) => [field.name, field]));
    const childFields = include.fields
      .map((fieldName) => targetFieldMap.get(fieldName))
      .filter((field): field is IRModelField => Boolean(field));
    if (childFields.length !== include.fields.length) {
      return null;
    }
    includes.push({
      include,
      fieldName: include.field,
      relationField,
      targetModel,
      childFields,
    });
  }
  return {
    resource,
    rootModel: model,
    includes,
  };
}

function resourceCreateSchemaModuleName(resource: IRResource): string {
  return `${toSnakeCase(resource.name)}_create`;
}

function resourceCreateSchemaClassName(resource: IRResource): string {
  return `${toPascalCase(resource.name)}Create`;
}

function resourceCreateItemSchemaClassName(resource: IRResource, fieldName: string): string {
  return `${toPascalCase(resource.name)}${toPascalCase(fieldName)}CreateItem`;
}

function resourceUpdateSchemaModuleName(resource: IRResource): string {
  return `${toSnakeCase(resource.name)}_update`;
}

function resourceUpdateSchemaClassName(resource: IRResource): string {
  return `${toPascalCase(resource.name)}Update`;
}

function resourceUpdateItemSchemaClassName(resource: IRResource, fieldName: string): string {
  return `${toPascalCase(resource.name)}${toPascalCase(fieldName)}UpdateItem`;
}

function resourceCreateServiceFunctionName(resource: IRResource): string {
  return `create_${toSnakeCase(resource.name)}`;
}

function resourceUpdateServiceFunctionName(resource: IRResource): string {
  return `update_${toSnakeCase(resource.name)}`;
}

function workflowCreateServiceFunctionName(resource: IRResource): string {
  return `create_${toSnakeCase(resource.name)}_with_workflow`;
}

function workflowUpdateServiceFunctionName(resource: IRResource): string {
  return `update_${toSnakeCase(resource.name)}_with_workflow`;
}

function workflowTransitionServiceFunctionName(resource: IRResource): string {
  return `transition_${toSnakeCase(resource.name)}`;
}

function workflowInitialState(resource: IRResource): string {
  return resource.workflow?.program.wizard?.steps[0]?.completesWith
    ?? resource.workflow?.program.states[0]?.name
    ?? '';
}

function workflowStateField(
  model: IRModel,
  resource: IRResource,
): IRModelField & { fieldType: { type: 'enum'; values: string[] } } {
  const field = model.fields.find((candidate) => candidate.name === resource.workflow?.program.field);
  if (!field || field.fieldType.type !== 'enum') {
    throw new Error(`Workflow field "${resource.workflow?.program.field ?? 'unknown'}" for resource "${resource.name}" must resolve to an enum field`);
  }
  return field as IRModelField & { fieldType: { type: 'enum'; values: string[] } };
}

function generateResourceCreateSchemaModule(
  resource: IRResource,
  model: IRModel,
  includes: NestedCreateIncludeAnalysis[],
): string {
  const imports = new Set<string>([
    'from __future__ import annotations',
    '',
    'from pydantic import BaseModel',
    `from app.schemas.${toSnakeCase(model.name)} import ${model.name}Base`,
  ]);
  for (const include of includes) {
    for (const field of include.childFields) {
      if (field.fieldType.type === 'scalar' && field.fieldType.name === 'datetime') {
        imports.add('from datetime import datetime');
      }
      if (field.fieldType.type === 'scalar' && field.fieldType.name === 'date') {
        imports.add('from datetime import date');
      }
      if (field.fieldType.type === 'scalar' && field.fieldType.name === 'decimal') {
        imports.add('from decimal import Decimal');
      }
      if (hasDecorator(field, 'email')) {
        imports.add('from pydantic import EmailStr');
      }
      if (field.fieldType.type === 'enum') {
        imports.add(`from app.models.${toSnakeCase(include.targetModel.name)} import ${enumClassName(include.targetModel.name, field.name)}`);
      }
    }
  }

  const itemBlocks = includes.map((include) => {
    const lines = include.childFields.map((field) =>
      `  ${field.name}: ${schemaFieldType(include.targetModel, field)}${schemaFieldDefault(field)}`);
    return `class ${resourceCreateItemSchemaClassName(resource, include.fieldName)}(BaseModel):
${lines.length > 0 ? lines.join('\n') : '  pass'}
`;
  }).join('\n\n');
  const includeLines = includes.map((include) =>
    `  ${include.fieldName}: list[${resourceCreateItemSchemaClassName(resource, include.fieldName)}] | None = None`);

  return `${Array.from(imports).sort().join('\n')}


${itemBlocks}

class ${resourceCreateSchemaClassName(resource)}(${model.name}Base):
${includeLines.length > 0 ? includeLines.join('\n') : '  pass'}
`;
}

function generateNestedCreateServiceFunction(
  analysis: NestedCreateResourceAnalysis,
): string {
  const rootModel = analysis.rootModel;
  const includeHelpers = analysis.includes.map((include) => `
def _persist_${toSnakeCase(analysis.resource.name)}_${toSnakeCase(include.fieldName)}_items(
  db: Session,
  parent: ${rootModel.name},
  items: list[${resourceCreateItemSchemaClassName(analysis.resource, include.fieldName)}] | None,
) -> None:
  if not items:
    return
  for item in items:
    entity = ${include.targetModel.name}()
${include.childFields.map((field) => `    entity.${field.name} = item.${field.name}`).join('\n') || '    pass'}
    entity.${include.relationField.fieldType.by} = parent.id
    db.add(entity)
`).join('\n');

  return `
def ${resourceCreateServiceFunctionName(analysis.resource)}(db: Session, payload: ${resourceCreateSchemaClassName(analysis.resource)}) -> ${rootModel.name}:
  entity = ${rootModel.name}()
  _apply_${toSnakeCase(rootModel.name)}_payload(entity, payload)
  db.add(entity)
  try:
    db.flush()
${analysis.includes.map((include) => `    _persist_${toSnakeCase(analysis.resource.name)}_${toSnakeCase(include.fieldName)}_items(db, entity, payload.${include.fieldName})`).join('\n')}
    db.commit()
  except IntegrityError as error:
    db.rollback()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data integrity violation") from error
  db.refresh(entity)
  return entity

${includeHelpers}
`;
}

function generateResourceUpdateSchemaModule(
  resource: IRResource,
  model: IRModel,
  includes: NestedCreateIncludeAnalysis[],
): string {
  const imports = new Set<string>([
    'from __future__ import annotations',
    '',
    'from pydantic import BaseModel',
    `from app.schemas.${toSnakeCase(model.name)} import ${model.name}Update as ${model.name}BaseUpdate`,
  ]);
  for (const include of includes) {
    for (const field of include.childFields) {
      if (field.fieldType.type === 'scalar' && field.fieldType.name === 'datetime') {
        imports.add('from datetime import datetime');
      }
      if (field.fieldType.type === 'scalar' && field.fieldType.name === 'date') {
        imports.add('from datetime import date');
      }
      if (field.fieldType.type === 'scalar' && field.fieldType.name === 'decimal') {
        imports.add('from decimal import Decimal');
      }
      if (hasDecorator(field, 'email')) {
        imports.add('from pydantic import EmailStr');
      }
      if (field.fieldType.type === 'enum') {
        imports.add(`from app.models.${toSnakeCase(include.targetModel.name)} import ${enumClassName(include.targetModel.name, field.name)}`);
      }
    }
  }

  const itemBlocks = includes.map((include) => {
    const lines = [
      '  id: int | None = None',
      ...include.childFields.map((field) => `  ${field.name}: ${schemaFieldType(include.targetModel, field)}${schemaFieldDefault(field)}`),
    ];
    return `class ${resourceUpdateItemSchemaClassName(resource, include.fieldName)}(BaseModel):
${lines.join('\n')}
`;
  }).join('\n\n');
  const includeLines = includes.map((include) =>
    `  ${include.fieldName}: list[${resourceUpdateItemSchemaClassName(resource, include.fieldName)}] | None = None`);

  return `${Array.from(imports).sort().join('\n')}


${itemBlocks}

class ${resourceUpdateSchemaClassName(resource)}(${model.name}BaseUpdate):
${includeLines.length > 0 ? includeLines.join('\n') : '  pass'}
`;
}

function generateNestedUpdateServiceFunction(
  analysis: NestedUpdateResourceAnalysis,
): string {
  const rootModel = analysis.rootModel;
  const includeHelpers = analysis.includes.map((include) => `
def _sync_${toSnakeCase(analysis.resource.name)}_${toSnakeCase(include.fieldName)}_items(
  db: Session,
  parent: ${rootModel.name},
  items: list[${resourceUpdateItemSchemaClassName(analysis.resource, include.fieldName)}] | None,
) -> None:
  existing = {
    item.id: item
    for item in db.scalars(select(${include.targetModel.name}).where(${include.targetModel.name}.${include.relationField.fieldType.by} == parent.id)).all()
  }
  if items is None:
    for leftover in existing.values():
      db.delete(leftover)
    return
  for item in items:
    if item.id is not None and item.id in existing:
      entity = existing.pop(item.id)
    elif item.id is not None:
      raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="${include.targetModel.name} not found for nested update")
    else:
      entity = ${include.targetModel.name}()
${include.childFields.map((field) => `    entity.${field.name} = item.${field.name}`).join('\n') || '    pass'}
    entity.${include.relationField.fieldType.by} = parent.id
    db.add(entity)
  for leftover in existing.values():
    db.delete(leftover)
`).join('\n');

  return `
def ${resourceUpdateServiceFunctionName(analysis.resource)}(db: Session, item_id: int, payload: ${resourceUpdateSchemaClassName(analysis.resource)}) -> ${rootModel.name}:
  entity = get_${toSnakeCase(rootModel.name)}_or_404(db, item_id)
  _apply_${toSnakeCase(rootModel.name)}_payload(entity, payload)
  try:
${analysis.includes.map((include) => `    _sync_${toSnakeCase(analysis.resource.name)}_${toSnakeCase(include.fieldName)}_items(db, entity, payload.${include.fieldName})`).join('\n')}
    db.commit()
  except IntegrityError as error:
    db.rollback()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data integrity violation") from error
  db.refresh(entity)
  return entity

${includeHelpers}
`;
}

function generateServiceModule(ir: IRSdslProgram, model: IRModel): string {
  const imports = new Set<string>([
    'from __future__ import annotations',
    '',
    'from fastapi import HTTPException, status',
    'from sqlalchemy import select',
    'from sqlalchemy.exc import IntegrityError',
    'from sqlalchemy.orm import Session',
    '',
    `from app.models.${toSnakeCase(model.name)} import ${model.name}`,
    `from app.schemas.${toSnakeCase(model.name)} import ${model.name}Create, ${model.name}Update`,
  ]);
  const nestedCreateResources = ir.resources
    .filter((resource) => resource.model === model.name)
    .map((resource) => analyzeNestedCreateResource(ir, resource, model))
    .filter((entry): entry is NestedCreateResourceAnalysis => Boolean(entry));
  const nestedUpdateResources = ir.resources
    .filter((resource) => resource.model === model.name)
    .map((resource) => analyzeNestedUpdateResource(ir, resource, model))
    .filter((entry): entry is NestedUpdateResourceAnalysis => Boolean(entry));
  const workflowResources = ir.resources
    .filter((resource): resource is IRResource & { workflow: NonNullable<IRResource['workflow']> } =>
      resource.model === model.name && Boolean(resource.workflow));
  for (const resourceAnalysis of nestedCreateResources) {
    imports.add(`from app.schemas.${resourceCreateSchemaModuleName(resourceAnalysis.resource)} import ${resourceCreateSchemaClassName(resourceAnalysis.resource)}`);
  }
  for (const resourceAnalysis of nestedUpdateResources) {
    imports.add(`from app.schemas.${resourceUpdateSchemaModuleName(resourceAnalysis.resource)} import ${resourceUpdateSchemaClassName(resourceAnalysis.resource)}`);
    for (const include of resourceAnalysis.includes) {
      imports.add(`from app.models.${toSnakeCase(include.targetModel.name)} import ${include.targetModel.name}`);
      imports.add(`from app.schemas.${resourceUpdateSchemaModuleName(resourceAnalysis.resource)} import ${resourceUpdateItemSchemaClassName(resourceAnalysis.resource, include.fieldName)}`);
    }
  }
  for (const workflowResource of workflowResources) {
    const stateField = workflowStateField(model, workflowResource);
    imports.add(`from app.models.${toSnakeCase(model.name)} import ${enumClassName(model.name, stateField.name)}`);
    const nestedCreate = nestedCreateResources.find((entry) => entry.resource.id === workflowResource.id);
    if (nestedCreate) {
      imports.add(`from app.schemas.${resourceCreateSchemaModuleName(workflowResource)} import ${resourceCreateSchemaClassName(workflowResource)}`);
    }
    const nestedUpdate = nestedUpdateResources.find((entry) => entry.resource.id === workflowResource.id);
    if (nestedUpdate) {
      imports.add(`from app.schemas.${resourceUpdateSchemaModuleName(workflowResource)} import ${resourceUpdateSchemaClassName(workflowResource)}`);
    }
  }
  const editableFields = editableModelFields(model);
  const applyLines = editableFields.map((field) => `  entity.${field.name} = payload.${field.name}`);
  const nestedCreateFunctions = nestedCreateResources
    .map((analysis) => generateNestedCreateServiceFunction(analysis))
    .join('\n');
  const nestedUpdateFunctions = nestedUpdateResources
    .map((analysis) => generateNestedUpdateServiceFunction(analysis))
    .join('\n');
  const workflowFunctions = workflowResources
    .map((resource) => generateWorkflowServiceFunctions(
      model,
      resource,
      nestedCreateResources.find((entry) => entry.resource.id === resource.id) ?? null,
      nestedUpdateResources.find((entry) => entry.resource.id === resource.id) ?? null,
    ))
    .join('\n');

  return `${Array.from(imports).join('\n')}


def list_${toSnakeCase(model.name)}_records(db: Session) -> list[${model.name}]:
  return list(db.scalars(select(${model.name}).order_by(${model.name}.id)).all())


def get_${toSnakeCase(model.name)}_or_404(db: Session, item_id: int) -> ${model.name}:
  entity = db.get(${model.name}, item_id)
  if entity is None:
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="${model.name} not found")
  return entity


def create_${toSnakeCase(model.name)}(db: Session, payload: ${model.name}Create) -> ${model.name}:
  entity = ${model.name}()
  _apply_${toSnakeCase(model.name)}_payload(entity, payload)
  db.add(entity)
  _commit_and_refresh(db, entity)
  return entity

${nestedCreateFunctions ? `${nestedCreateFunctions}\n` : ''}
${nestedUpdateFunctions ? `${nestedUpdateFunctions}\n` : ''}
${workflowFunctions ? `${workflowFunctions}\n` : ''}


def update_${toSnakeCase(model.name)}(db: Session, item_id: int, payload: ${model.name}Update) -> ${model.name}:
  entity = get_${toSnakeCase(model.name)}_or_404(db, item_id)
  _apply_${toSnakeCase(model.name)}_payload(entity, payload)
  _commit_and_refresh(db, entity)
  return entity


def delete_${toSnakeCase(model.name)}(db: Session, item_id: int) -> None:
  entity = get_${toSnakeCase(model.name)}_or_404(db, item_id)
  db.delete(entity)
  try:
    db.commit()
  except IntegrityError as error:
    db.rollback()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data integrity violation") from error


def _apply_${toSnakeCase(model.name)}_payload(entity: ${model.name}, payload: ${model.name}Create | ${model.name}Update) -> None:
${applyLines.length > 0 ? applyLines.join('\n') : '  pass'}


def _commit_and_refresh(db: Session, entity: ${model.name}) -> None:
  try:
    db.commit()
  except IntegrityError as error:
    db.rollback()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data integrity violation") from error
  db.refresh(entity)
`;
}

function generateWorkflowServiceFunctions(
  model: IRModel,
  resource: IRResource & { workflow: NonNullable<IRResource['workflow']> },
  nestedCreate: NestedCreateResourceAnalysis | null,
  nestedUpdate: NestedUpdateResourceAnalysis | null,
): string {
  const stateField = workflowStateField(model, resource);
  const stateEnum = enumClassName(model.name, stateField.name);
  const initialState = workflowInitialState(resource);
  const createFunction = nestedCreate
    ? `
def ${workflowCreateServiceFunctionName(resource)}(db: Session, payload: ${resourceCreateSchemaClassName(resource)}) -> ${model.name}:
  entity = ${model.name}()
  _apply_${toSnakeCase(model.name)}_payload(entity, payload)
  entity.${stateField.name} = ${stateEnum}.${initialState}
  db.add(entity)
  try:
    db.flush()
${nestedCreate.includes.map((include) => `    _persist_${toSnakeCase(resource.name)}_${toSnakeCase(include.fieldName)}_items(db, entity, payload.${include.fieldName})`).join('\n')}
    db.commit()
  except IntegrityError as error:
    db.rollback()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data integrity violation") from error
  db.refresh(entity)
  return entity
`
    : `
def ${workflowCreateServiceFunctionName(resource)}(db: Session, payload: ${model.name}Create) -> ${model.name}:
  entity = ${model.name}()
  _apply_${toSnakeCase(model.name)}_payload(entity, payload)
  entity.${stateField.name} = ${stateEnum}.${initialState}
  db.add(entity)
  _commit_and_refresh(db, entity)
  return entity
`;

  const updateFunction = nestedUpdate
    ? `
def ${workflowUpdateServiceFunctionName(resource)}(db: Session, item_id: int, payload: ${resourceUpdateSchemaClassName(resource)}) -> ${model.name}:
  entity = get_${toSnakeCase(model.name)}_or_404(db, item_id)
  current_state = entity.${stateField.name}
  _apply_${toSnakeCase(model.name)}_payload(entity, payload)
  try:
${nestedUpdate.includes.map((include) => `    _sync_${toSnakeCase(resource.name)}_${toSnakeCase(include.fieldName)}_items(db, entity, payload.${include.fieldName})`).join('\n')}
    entity.${stateField.name} = current_state
    db.commit()
  except IntegrityError as error:
    db.rollback()
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Data integrity violation") from error
  db.refresh(entity)
  return entity
`
    : `
def ${workflowUpdateServiceFunctionName(resource)}(db: Session, item_id: int, payload: ${model.name}Update) -> ${model.name}:
  entity = get_${toSnakeCase(model.name)}_or_404(db, item_id)
  current_state = entity.${stateField.name}
  _apply_${toSnakeCase(model.name)}_payload(entity, payload)
  entity.${stateField.name} = current_state
  _commit_and_refresh(db, entity)
  return entity
`;

  return `${createFunction}
${updateFunction}


def ${workflowTransitionServiceFunctionName(resource)}(db: Session, item_id: int, target_state: str) -> ${model.name}:
  entity = get_${toSnakeCase(model.name)}_or_404(db, item_id)
  try:
    entity.${stateField.name} = ${stateEnum}[target_state]
  except KeyError as error:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid workflow state: {target_state}") from error
  _commit_and_refresh(db, entity)
  return entity
`;
}

function generateWorkflowModule(
  resource: IRResource & { workflow: NonNullable<IRResource['workflow']> },
  model: IRModel,
): string {
  const manifestJson = escapePythonTripleQuoted(JSON.stringify(resource.workflow.manifest, null, 2));
  const stateField = workflowStateField(model, resource);
  const initialState = workflowInitialState(resource);
  return `from __future__ import annotations

import json
from collections.abc import Collection, Mapping
from decimal import Decimal
from enum import Enum

from fastapi import status

from app.security import AuthenticatedUser


MANIFEST = json.loads(
  r'''${manifestJson}'''
)
STATE_FIELD = "${stateField.name}"
INITIAL_STATE = "${initialState}"
TRANSITIONS = MANIFEST.get("transitions", [])


def initial_state() -> str:
  return INITIAL_STATE


def decide_transition(
  transition_name: str,
  principal: AuthenticatedUser | None,
  record: object | None,
) -> tuple[bool, int, str | None, str | None]:
  transition = _find_transition(transition_name)
  if transition is None:
    return False, status.HTTP_400_BAD_REQUEST, f"Unknown transition: {transition_name}", None
  current_state = _current_state(record)
  from_states = _as_string_list(transition.get("from"))
  if current_state not in from_states:
    return False, status.HTTP_400_BAD_REQUEST, f'Transition "{transition_name}" is not allowed from current state {current_state}', None
  if "allow" in transition and not _eval_boolean(transition.get("allow"), principal, record):
    return False, status.HTTP_403_FORBIDDEN, "Forbidden", None
  return True, status.HTTP_200_OK, None, _as_string(transition.get("to"))


def _find_transition(transition_name: str) -> Mapping[str, object] | None:
  for transition in TRANSITIONS:
    if isinstance(transition, Mapping) and transition.get("name") == transition_name:
      return transition
  return None


def _current_state(record: object | None) -> str:
  value = _read_property(record, STATE_FIELD)
  normalized = _normalize_value(value)
  return "" if normalized is None else str(normalized)


def _as_string_list(value: object) -> list[str]:
  if not isinstance(value, list):
    return []
  return [item for item in value if isinstance(item, str)]


def _eval_boolean(node: object, principal: AuthenticatedUser | None, record: object | None) -> bool:
  return _truthy(_eval_expr(node, principal, record))


def _eval_expr(node: object, principal: AuthenticatedUser | None, record: object | None) -> object:
  if not isinstance(node, dict):
    return None
  node_type = node.get("type")
  if node_type == "literal":
    return node.get("value")
  if node_type == "identifier":
    return _resolve_path(node.get("path"), principal, record)
  if node_type == "binary":
    return _eval_binary(node, principal, record)
  if node_type == "unary":
    return not _eval_boolean(node.get("operand"), principal, record) if node.get("op") == "not" else None
  if node_type == "call":
    return _eval_call(node, principal, record)
  if node_type == "member":
    return _read_property(_eval_expr(node.get("object"), principal, record), _as_string(node.get("property")))
  if node_type == "in":
    value = _eval_expr(node.get("value"), principal, record)
    return any(_values_equal(value, _eval_expr(item, principal, record)) for item in node.get("list", []))
  return None


def _eval_binary(node: Mapping[str, object], principal: AuthenticatedUser | None, record: object | None) -> object:
  op = _as_string(node.get("op"))
  left = _eval_expr(node.get("left"), principal, record)
  right = _eval_expr(node.get("right"), principal, record)
  if op == "&&":
    return _truthy(left) and _truthy(right)
  if op == "||":
    return _truthy(left) or _truthy(right)
  if op == "==":
    return _values_equal(left, right)
  if op == "!=":
    return not _values_equal(left, right)
  if op == ">":
    return _compare_values(left, right) > 0
  if op == "<":
    return _compare_values(left, right) < 0
  if op == ">=":
    return _compare_values(left, right) >= 0
  if op == "<=":
    return _compare_values(left, right) <= 0
  if op == "+":
    return _add_values(left, right)
  if op == "-":
    return _subtract_values(left, right)
  if op == "*":
    return _multiply_values(left, right)
  if op == "/":
    return _divide_values(left, right)
  return None


def _eval_call(node: Mapping[str, object], principal: AuthenticatedUser | None, record: object | None) -> object:
  fn = _as_string(node.get("fn"))
  args = node.get("args") if isinstance(node.get("args"), list) else []
  if fn == "hasRole" and len(args) >= 2:
    return _has_role(_eval_expr(args[0], principal, record), _eval_expr(args[1], principal, record))
  if fn == "isEmpty" and len(args) >= 1:
    return _is_empty(_eval_expr(args[0], principal, record))
  if fn == "isNotEmpty" and len(args) >= 1:
    return not _is_empty(_eval_expr(args[0], principal, record))
  if fn == "count" and len(args) >= 1:
    return _count(_eval_expr(args[0], principal, record))
  return False


def _resolve_path(candidate: object, principal: AuthenticatedUser | None, record: object | None) -> object:
  if not isinstance(candidate, list) or not candidate:
    return None
  root = _as_string(candidate[0])
  if len(candidate) == 1 and isinstance(root, str) and root.isupper():
    return root
  if root == "currentUser" and len(candidate) >= 2:
    return _resolve_current_user(principal, _as_string(candidate[1]))
  if root == "currentUser":
    current: object | None = principal
  elif root == "record":
    current = record
  else:
    return None
  for segment in candidate[1:]:
    current = _read_property(current, _as_string(segment))
  return current


def _resolve_current_user(principal: AuthenticatedUser | None, property_name: str | None) -> object:
  if principal is None:
    if property_name == "roles":
      return []
    return None
  if property_name in {"id", "username"}:
    return principal.username
  if property_name == "role":
    return principal.roles[0] if principal.roles else None
  if property_name == "roles":
    return principal.roles
  return _read_property(principal, property_name)


def _read_property(target: object, property_name: str | None) -> object:
  if target is None or not property_name:
    return None
  if isinstance(target, Mapping):
    return target.get(property_name)
  if hasattr(target, property_name):
    return getattr(target, property_name)
  getter_name = f"get{property_name[:1].upper()}{property_name[1:]}"
  getter = getattr(target, getter_name, None)
  if callable(getter):
    return getter()
  return None


def _truthy(value: object) -> bool:
  if isinstance(value, bool):
    return value
  if value is None:
    return False
  if isinstance(value, (int, float, Decimal)):
    return value != 0
  if isinstance(value, str):
    return bool(value.strip())
  if isinstance(value, Collection):
    return len(value) > 0
  if isinstance(value, Mapping):
    return len(value) > 0
  return True


def _values_equal(left: object, right: object) -> bool:
  normalized_left = _normalize_value(left)
  normalized_right = _normalize_value(right)
  if isinstance(normalized_left, (int, float, Decimal)) and isinstance(normalized_right, (int, float, Decimal)):
    return Decimal(str(normalized_left)) == Decimal(str(normalized_right))
  return normalized_left == normalized_right


def _compare_values(left: object, right: object) -> int:
  normalized_left = _normalize_value(left)
  normalized_right = _normalize_value(right)
  if isinstance(normalized_left, (int, float, Decimal)) and isinstance(normalized_right, (int, float, Decimal)):
    left_decimal = Decimal(str(normalized_left))
    right_decimal = Decimal(str(normalized_right))
    return (left_decimal > right_decimal) - (left_decimal < right_decimal)
  left_text = "" if normalized_left is None else str(normalized_left)
  right_text = "" if normalized_right is None else str(normalized_right)
  return (left_text > right_text) - (left_text < right_text)


def _normalize_value(value: object) -> object:
  if isinstance(value, Enum):
    return value.name
  return value


def _has_role(current_user: object, role: object) -> bool:
  expected_role = str(role) if role is not None else ""
  if not expected_role:
    return False
  roles = _read_property(current_user, "roles")
  if isinstance(roles, Collection):
    return any(str(candidate) == expected_role for candidate in roles)
  primary_role = _read_property(current_user, "role")
  return str(primary_role) == expected_role


def _is_empty(value: object) -> bool:
  if value is None:
    return True
  if isinstance(value, str):
    return not value.strip()
  if isinstance(value, Collection):
    return len(value) == 0
  if isinstance(value, Mapping):
    return len(value) == 0
  return False


def _count(value: object) -> int:
  if value is None:
    return 0
  if isinstance(value, (Collection, Mapping, str)):
    return len(value)
  return 0


def _as_string(value: object) -> str | None:
  return value if isinstance(value, str) else None


def _add_values(left: object, right: object) -> object:
  if isinstance(left, str) or isinstance(right, str):
    return f"{'' if left is None else left}{'' if right is None else right}"
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    return Decimal(str(left)) + Decimal(str(right))
  return None


def _subtract_values(left: object, right: object) -> object:
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    return Decimal(str(left)) - Decimal(str(right))
  return None


def _multiply_values(left: object, right: object) -> object:
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    return Decimal(str(left)) * Decimal(str(right))
  return None


def _divide_values(left: object, right: object) -> object:
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    divisor = Decimal(str(right))
    if divisor == 0:
      return None
    return Decimal(str(left)) / divisor
  return None
`;
}

function generateRouteModule(ir: IRSdslProgram, resource: IRResource, model: IRModel): string {
  const nestedCreate = analyzeNestedCreateResource(ir, resource, model);
  const nestedUpdate = analyzeNestedUpdateResource(ir, resource, model);
  const createSchemaName = nestedCreate ? resourceCreateSchemaClassName(resource) : `${model.name}Create`;
  const updateSchemaName = nestedUpdate ? resourceUpdateSchemaClassName(resource) : `${model.name}Update`;
  const hasWorkflow = Boolean(resource.workflow);
  const createServiceName = hasWorkflow
    ? workflowCreateServiceFunctionName(resource)
    : nestedCreate
      ? resourceCreateServiceFunctionName(resource)
      : `create_${toSnakeCase(model.name)}`;
  const updateServiceName = hasWorkflow
    ? workflowUpdateServiceFunctionName(resource)
    : nestedUpdate
      ? resourceUpdateServiceFunctionName(resource)
      : `update_${toSnakeCase(model.name)}`;
  const authDependency = buildFastApiAuthDependency(resource);
  const authImport = authDependency.importLine;
  const authArgument = authDependency.argumentLine;
  const authArgumentWithComma = authArgument ? `, ${authArgument}` : '';
  const principalValue = authArgument ? 'principal' : 'None';
  const hasPolicy = Boolean(resource.auth.policy);
  const hasRulesPolicy = resource.auth.policy?.source === 'rules';
  const hasCreateRules = Boolean(resource.create?.rules);
  const operations = resource.operations;

  const methodBlocks: string[] = [];
  if (operations.list) {
    methodBlocks.push(`@router.get("", response_model=list[${model.name}Response])
async def list_${toSnakeCase(resource.name)}(db: Session = Depends(get_db)${authArgumentWithComma}) -> list[${model.name}Response]:
${hasRulesPolicy
    ? `  records = list_${toSnakeCase(model.name)}_records(db)
  filtered = filter_${toSnakeCase(resource.name)}_policy_list(principal, records)
  if not filtered and not allow_${toSnakeCase(resource.name)}_policy_list(principal):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=denied_message_${toSnakeCase(resource.name)}_policy("list", principal, {}, None, None))
  return filtered`
    : hasPolicy
      ? `  _enforce_policy(principal, "list", {}, None)
  return list_${toSnakeCase(model.name)}_records(db)`
      : `  return list_${toSnakeCase(model.name)}_records(db)`}
`);
  }
  if (operations.get) {
    methodBlocks.push(`@router.get("/{item_id}", response_model=${model.name}Response)
async def get_${toSnakeCase(resource.name)}(item_id: int, db: Session = Depends(get_db)${authArgumentWithComma}) -> ${model.name}Response:
${hasRulesPolicy
    ? `  entity = get_${toSnakeCase(model.name)}_or_404(db, item_id)
  _enforce_rules_policy(principal, "get", {"id": str(item_id)}, None, entity)
  return entity`
    : hasPolicy
      ? `  _enforce_policy(principal, "get", {"id": str(item_id)}, None)
  return get_${toSnakeCase(model.name)}_or_404(db, item_id)`
      : `  return get_${toSnakeCase(model.name)}_or_404(db, item_id)`}
`);
  }
  if (operations.create) {
    methodBlocks.push(`@router.post("", response_model=${model.name}Response, status_code=status.HTTP_201_CREATED)
async def create_${toSnakeCase(resource.name)}(payload: ${createSchemaName}, db: Session = Depends(get_db)${authArgumentWithComma}) -> ${model.name}Response:
${hasRulesPolicy
    ? `  _enforce_rules_policy(${principalValue}, "create", {}, payload.model_dump(), None)
${hasCreateRules ? `  _enforce_create_rules(${principalValue}, {}, payload)\n` : ''}  return ${createServiceName}(db, payload)`
    : hasPolicy
      ? `  _enforce_policy(${principalValue}, "create", {}, payload.model_dump())
${hasCreateRules ? `  _enforce_create_rules(${principalValue}, {}, payload)\n` : ''}  return ${createServiceName}(db, payload)`
      : hasCreateRules
        ? `  _enforce_create_rules(${principalValue}, {}, payload)
  return ${createServiceName}(db, payload)`
        : `  return ${createServiceName}(db, payload)`}
`);
  }
  if (operations.update) {
    methodBlocks.push(`@router.put("/{item_id}", response_model=${model.name}Response)
async def update_${toSnakeCase(resource.name)}(item_id: int, payload: ${updateSchemaName}, db: Session = Depends(get_db)${authArgumentWithComma}) -> ${model.name}Response:
${hasRulesPolicy
    ? `  entity = get_${toSnakeCase(model.name)}_or_404(db, item_id)
  _enforce_rules_policy(principal, "update", {"id": str(item_id)}, payload.model_dump(), entity)
  return ${updateServiceName}(db, item_id, payload)`
    : hasPolicy
      ? `  _enforce_policy(principal, "update", {"id": str(item_id)}, payload.model_dump())
  return ${updateServiceName}(db, item_id, payload)`
      : `  return ${updateServiceName}(db, item_id, payload)`}
`);
  }
  if (operations.delete) {
    methodBlocks.push(`@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_${toSnakeCase(resource.name)}(item_id: int, db: Session = Depends(get_db)${authArgumentWithComma}) -> Response:
${hasRulesPolicy
    ? `  entity = get_${toSnakeCase(model.name)}_or_404(db, item_id)
  _enforce_rules_policy(principal, "delete", {"id": str(item_id)}, None, entity)
  delete_${toSnakeCase(model.name)}(db, item_id)`
    : hasPolicy
      ? `  _enforce_policy(principal, "delete", {"id": str(item_id)}, None)
  delete_${toSnakeCase(model.name)}(db, item_id)`
      : `  delete_${toSnakeCase(model.name)}(db, item_id)`}
  return Response(status_code=status.HTTP_204_NO_CONTENT)
`);
  }
  if (hasWorkflow) {
    methodBlocks.push(`@router.post("/{item_id}/transitions/{transition_name}", response_model=${model.name}Response)
async def transition_${toSnakeCase(resource.name)}(item_id: int, transition_name: str, db: Session = Depends(get_db)${authArgumentWithComma}) -> ${model.name}Response:
  entity = get_${toSnakeCase(model.name)}_or_404(db, item_id)
  allowed, status_code, message, target_state = decide_${toSnakeCase(resource.name)}_transition(transition_name, ${principalValue}, entity)
  if not allowed or target_state is None:
    raise HTTPException(status_code=status_code, detail=message or "Forbidden")
${hasRulesPolicy
    ? `  _enforce_rules_policy(${principalValue}, "update", {"id": str(item_id)}, _transition_payload(target_state), entity)
  return ${workflowTransitionServiceFunctionName(resource)}(db, item_id, target_state)`
    : hasPolicy
      ? `  _enforce_policy(${principalValue}, "update", {"id": str(item_id)}, _transition_payload(target_state))
  return ${workflowTransitionServiceFunctionName(resource)}(db, item_id, target_state)`
      : `  return ${workflowTransitionServiceFunctionName(resource)}(db, item_id, target_state)`}
`);
  }

  return `from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.orm import Session

from app.db import get_db
${authImport ? `${authImport}\n` : ''}from app.schemas.${toSnakeCase(model.name)} import ${model.name}Create, ${model.name}Response, ${model.name}Update
${nestedCreate ? `from app.schemas.${resourceCreateSchemaModuleName(resource)} import ${resourceCreateSchemaClassName(resource)}
` : ''}${nestedUpdate ? `from app.schemas.${resourceUpdateSchemaModuleName(resource)} import ${resourceUpdateSchemaClassName(resource)}
` : ''}from app.services.${toSnakeCase(model.name)} import ${Array.from(new Set([createServiceName, `delete_${toSnakeCase(model.name)}`, `get_${toSnakeCase(model.name)}_or_404`, `list_${toSnakeCase(model.name)}_records`, updateServiceName, ...(hasWorkflow ? [workflowTransitionServiceFunctionName(resource)] : [])])).join(', ')}
${hasRulesPolicy
    ? `from app.custom.policies.${toSnakeCase(resource.name)}_policy import allow as allow_${toSnakeCase(resource.name)}_policy, allow_list as allow_${toSnakeCase(resource.name)}_policy_list, denied_message as denied_message_${toSnakeCase(resource.name)}_policy, filter_list as filter_${toSnakeCase(resource.name)}_policy_list\n`
    : hasPolicy
      ? `from app.custom.policies.${toSnakeCase(resource.name)}_policy import allow as allow_${toSnakeCase(resource.name)}_policy\n`
      : ''}${hasCreateRules ? `from app.custom.rules.${toSnakeCase(resource.name)}_create_rules import first_eligibility_failure as first_${toSnakeCase(resource.name)}_create_eligibility_failure, first_validation_failure as first_${toSnakeCase(resource.name)}_create_validation_failure\n` : ''}${hasWorkflow ? `from app.custom.workflows.${toSnakeCase(resource.name)}_workflow import decide_transition as decide_${toSnakeCase(resource.name)}_transition\n` : ''}


router = APIRouter(prefix="${resource.api}", tags=["${resource.name}"])

${hasPolicy && !hasRulesPolicy ? `
def _enforce_policy(principal: AuthenticatedUser, operation: str, params: dict[str, str], payload: dict[str, object] | None) -> None:
  if not allow_${toSnakeCase(resource.name)}_policy(principal, operation, params, payload):
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
` : ''}
${hasRulesPolicy ? `
def _enforce_rules_policy(principal: AuthenticatedUser, operation: str, params: dict[str, str], payload: dict[str, object] | None, record: object | None) -> None:
  if not allow_${toSnakeCase(resource.name)}_policy(principal, operation, params, payload, record):
    raise HTTPException(
      status_code=status.HTTP_403_FORBIDDEN,
      detail=denied_message_${toSnakeCase(resource.name)}_policy(operation, principal, params, payload, record),
    )
` : ''}
${hasCreateRules ? `
def _enforce_create_rules(principal: object | None, params: dict[str, str], payload: ${createSchemaName}) -> None:
  eligibility_failure = first_${toSnakeCase(resource.name)}_create_eligibility_failure(principal, params, payload)
  if eligibility_failure is not None:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=eligibility_failure)
  validation_failure = first_${toSnakeCase(resource.name)}_create_validation_failure(principal, params, payload)
  if validation_failure is not None:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=validation_failure)
` : ''}
${hasWorkflow ? `
def _transition_payload(target_state: str) -> dict[str, object]:
  return {"${resource.workflow!.program.field}": target_state}
` : ''}

${methodBlocks.join('\n')}
`;
}

function generateReadModelSchemaModule(readModel: IRReadModel): string {
  const imports = new Set<string>([
    'from pydantic import BaseModel',
  ]);

  for (const field of [...readModel.inputs, ...readModel.result]) {
    if (field.fieldType.type !== 'scalar') {
      continue;
    }
    if (field.fieldType.name === 'datetime') {
      imports.add('from datetime import datetime');
    }
    if (field.fieldType.name === 'date') {
      imports.add('from datetime import date');
    }
    if (field.fieldType.name === 'decimal') {
      imports.add('from decimal import Decimal');
    }
  }

  const inputFields = readModel.inputs.map((field) => `  ${field.name}: ${readModelPythonType(field)}${hasDecorator(field, 'required') ? '' : ' | None = None'}`);
  const resultFields = readModel.result.map((field) => `  ${field.name}: ${readModelPythonType(field)}`);

  return `from __future__ import annotations

${Array.from(imports).sort().join('\n')}


class ${readModelInputClassName(readModel)}(BaseModel):
${inputFields.length > 0 ? inputFields.join('\n') : '  pass'}


class ${readModelResultClassName(readModel)}(BaseModel):
${resultFields.join('\n')}
`;
}

function generateReadModelHandlerModule(
  readModel: IRReadModel,
  readFile?: (fileName: string) => string,
): string {
  if (readModel.handler.source === 'sql') {
    return generateSqlReadModelHandlerModule(readModel, readFile);
  }
  const snippet = readBackendPolicySnippet(readModel.handler.resolvedPath, readFile, 'return []');
  const scalarImports = new Set<string>();
  for (const field of [...readModel.inputs, ...readModel.result]) {
    addReadModelPythonScalarImports(scalarImports, field);
  }
  return `from __future__ import annotations

${Array.from(scalarImports).sort().join('\n')}${scalarImports.size > 0 ? '\n' : ''}from sqlalchemy.orm import Session

from app.schemas.${toSnakeCase(readModel.name)}_read_model import ${readModelInputClassName(readModel)}, ${readModelResultClassName(readModel)}
from app.security import AuthenticatedUser


def execute(db: Session, input: ${readModelInputClassName(readModel)}, principal: AuthenticatedUser | None) -> list[${readModelResultClassName(readModel)}]:
${indentSnippet(snippet, '  ')}
`;
}

function generateSqlReadModelHandlerModule(
  readModel: IRReadModel,
  readFile?: (fileName: string) => string,
): string {
  const sqlSource = readSqlSource(readModel.handler.resolvedPath, readFile, 'select 1');
  const scalarImports = new Set<string>();
  for (const field of [...readModel.inputs, ...readModel.result]) {
    addReadModelPythonScalarImports(scalarImports, field);
  }
  const parameterEntries = readModel.inputs.map((field) => `    "${field.name}": input.${field.name},`);
  const resultEntries = readModel.result.map((field) => `        ${field.name}=row.get("${field.name}"),`);
  return `from __future__ import annotations

${Array.from(scalarImports).sort().join('\n')}${scalarImports.size > 0 ? '\n' : ''}from sqlalchemy import text
from sqlalchemy.orm import Session

from app.schemas.${toSnakeCase(readModel.name)}_read_model import ${readModelInputClassName(readModel)}, ${readModelResultClassName(readModel)}
from app.security import AuthenticatedUser


def execute(db: Session, input: ${readModelInputClassName(readModel)}, principal: AuthenticatedUser | None) -> list[${readModelResultClassName(readModel)}]:
  statement = text("""
${escapePythonTripleQuotedString(sqlSource)}
""")
  params = {
${parameterEntries.length > 0 ? `${parameterEntries.join('\n')}\n` : ''}  }
  rows = db.execute(statement, params).mappings().all()
  return [
    ${readModelResultClassName(readModel)}(
${resultEntries.join('\n')}
    )
    for row in rows
  ]
`;
}

function generateReadModelRouteModule(readModel: IRReadModel): string {
  const authDependency = buildFastApiAuthDependency(readModel);
  const authImport = authDependency.importLine;
  const authArgument = authDependency.argumentLine;
  const hasRules = Boolean(readModel.rules);
  const scalarImports = new Set<string>();
  for (const field of readModel.inputs) {
    addReadModelPythonScalarImports(scalarImports, field);
  }
  const queryArgs = readModel.inputs.map((field) => `${field.name}: ${readModelQueryType(field)}${hasDecorator(field, 'required') ? '' : ' = None'}`);
  const methodArgs = [
    ...queryArgs,
    'db: Session = Depends(get_db)',
    ...(authArgument ? [authArgument] : []),
  ];
  const inputAssignments = readModel.inputs.map((field) => `${field.name}=${field.name}`).join(', ');
  const principalArg = authArgument ? 'principal' : 'None';

  return `from __future__ import annotations

${Array.from(scalarImports).sort().join('\n')}${scalarImports.size > 0 ? '\n' : ''}from fastapi import APIRouter, Depends${hasRules ? ', HTTPException, status' : ''}
from sqlalchemy.orm import Session

from app.db import get_db
${authImport ? `${authImport}\n` : ''}from app.custom.read_models.${toSnakeCase(readModel.name)}_read_model import execute as execute_${toSnakeCase(readModel.name)}_read_model
${hasRules ? `from app.custom.rules.${toSnakeCase(readModel.name)}_read_model_rules import apply_derivations as apply_${toSnakeCase(readModel.name)}_read_model_derivations, first_eligibility_failure as first_${toSnakeCase(readModel.name)}_read_model_eligibility_failure, first_validation_failure as first_${toSnakeCase(readModel.name)}_read_model_validation_failure\n` : ''}from app.schemas.${toSnakeCase(readModel.name)}_read_model import ${readModelInputClassName(readModel)}, ${readModelResultClassName(readModel)}
from app.schemas.${toSnakeCase(readModel.name)}_read_model import ${readModelInputClassName(readModel)}, ${readModelResultClassName(readModel)}


router = APIRouter(prefix="${readModel.api}", tags=["${readModel.name}"])


@router.get("", response_model=list[${readModelResultClassName(readModel)}])
async def run_${toSnakeCase(readModel.name)}(${methodArgs.join(', ')}) -> list[${readModelResultClassName(readModel)}]:
  input = ${readModelInputClassName(readModel)}(${inputAssignments})
${hasRules
    ? `  eligibility_failure = first_${toSnakeCase(readModel.name)}_read_model_eligibility_failure(input, ${principalArg})
  if eligibility_failure is not None:
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=eligibility_failure)
  validation_failure = first_${toSnakeCase(readModel.name)}_read_model_validation_failure(input, ${principalArg})
  if validation_failure is not None:
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=validation_failure)
  return apply_${toSnakeCase(readModel.name)}_read_model_derivations(input, ${principalArg}, execute_${toSnakeCase(readModel.name)}_read_model(db, input, ${principalArg}))`
    : `  return execute_${toSnakeCase(readModel.name)}_read_model(db, input, ${principalArg})`}
`;
}

function generateApiTestModule(ir: IRSdslProgram, resource: IRResource, model: IRModel): string {
  const testDbFile = `test_${toSnakeCase(resource.name)}.db`;
  const extraImports = resource.auth.mode === 'public' ? '' : 'import base64\n';
  const authHeadersHelper = resource.auth.mode === 'public'
    ? ''
    : `

def auth_headers(username: str = "admin", password: str = "admin123") -> dict[str, str]:
  token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("utf-8")
  return {"Authorization": f"Basic {token}"}
`;
  const authHeadersCall = resource.auth.mode === 'public' ? '' : ', headers=auth_headers()';
  const editableFields = editableModelFields(model);
  const primaryPayload = renderPythonDict(editableFields.map((field) => [field.name, samplePythonValue(model, field, 'primary')]));
  const secondaryPayload = renderPythonDict(editableFields.map((field) => [field.name, samplePythonValue(model, field, 'secondary')]));
  const listAssertions = [
    '  assert response.status_code == 200',
    '  body = response.json()',
    '  assert isinstance(body, list)',
    '  assert len(body) == 1',
    ...editableFields.map((field) => `  assert body[0]["${field.name}"] == ${sampleJsonLiteral(model, field, 'primary')}`),
  ];
  const createAssertions = [
    '  assert response.status_code == 201',
    '  body = response.json()',
    '  assert "id" in body',
    ...editableFields.map((field) => `  assert body["${field.name}"] == payload["${field.name}"]`),
  ];
  const getAssertions = [
    '  assert response.status_code == 200',
    '  body = response.json()',
    ...editableFields.map((field) => `  assert body["${field.name}"] == payload["${field.name}"]`),
  ];
  const updateAssertions = [
    '  assert response.status_code == 200',
    '  body = response.json()',
    ...editableFields.map((field) => `  assert body["${field.name}"] == update_payload["${field.name}"]`),
  ];

  const testBlocks: string[] = [];
  if (resource.operations.create) {
    testBlocks.push(`@pytest.mark.anyio
async def test_${toSnakeCase(resource.name)}_create(client: httpx.AsyncClient) -> None:
  payload = primary_payload()
  response = await client.post("${resource.api}", json=payload${authHeadersCall})
${createAssertions.join('\n')}
`);
  }

  if (resource.operations.list && resource.operations.create) {
    testBlocks.push(`@pytest.mark.anyio
async def test_${toSnakeCase(resource.name)}_list(client: httpx.AsyncClient) -> None:
  payload = primary_payload()
  create_response = await client.post("${resource.api}", json=payload${authHeadersCall})
  assert create_response.status_code == 201

  response = await client.get("${resource.api}"${resource.auth.mode === 'public' ? '' : ', headers=auth_headers()'})
${listAssertions.join('\n')}
`);
  }

  if (resource.operations.get && resource.operations.create) {
    testBlocks.push(`@pytest.mark.anyio
async def test_${toSnakeCase(resource.name)}_get(client: httpx.AsyncClient) -> None:
  payload = primary_payload()
  create_response = await client.post("${resource.api}", json=payload${authHeadersCall})
  item_id = create_response.json()["id"]

  response = await client.get(f"${resource.api}/{item_id}"${resource.auth.mode === 'public' ? '' : ', headers=auth_headers()'})
${getAssertions.join('\n')}
`);
  }

  if (resource.operations.update && resource.operations.create) {
    testBlocks.push(`@pytest.mark.anyio
async def test_${toSnakeCase(resource.name)}_update(client: httpx.AsyncClient) -> None:
  payload = primary_payload()
  create_response = await client.post("${resource.api}", json=payload${authHeadersCall})
  item_id = create_response.json()["id"]
  update_payload = secondary_payload()

  response = await client.put(f"${resource.api}/{item_id}", json=update_payload${resource.auth.mode === 'public' ? '' : ', headers=auth_headers()'})
${updateAssertions.join('\n')}
`);
  }

  if (resource.operations.delete && resource.operations.create && resource.operations.get) {
    testBlocks.push(`@pytest.mark.anyio
async def test_${toSnakeCase(resource.name)}_delete(client: httpx.AsyncClient) -> None:
  payload = primary_payload()
  create_response = await client.post("${resource.api}", json=payload${authHeadersCall})
  item_id = create_response.json()["id"]

  response = await client.delete(f"${resource.api}/{item_id}"${resource.auth.mode === 'public' ? '' : ', headers=auth_headers()'})
  assert response.status_code == 204

  missing_response = await client.get(f"${resource.api}/{item_id}"${resource.auth.mode === 'public' ? '' : ', headers=auth_headers()'})
  assert missing_response.status_code == 404
  assert missing_response.json()["message"] == "${model.name} not found"
`);
  }

  const unauthorizedTest = resource.auth.mode === 'public'
    ? ''
    : `

@pytest.mark.anyio
async def test_${toSnakeCase(resource.name)}_requires_auth(client: httpx.AsyncClient) -> None:
  response = await client.get("${resource.api}")
  assert response.status_code == 401
  assert response.json()["message"] == "Not authenticated"
`;

  return `from __future__ import annotations

import os
${extraImports}import pathlib

import httpx
import pytest

TEST_DB_PATH = pathlib.Path(__file__).resolve().parent / "${testDbFile}"
os.environ["LOJ_DATABASE_URL"] = f"sqlite:///{TEST_DB_PATH.as_posix()}"

from app.db import engine
from app.main import app
from app.models import Base

${authHeadersHelper}


@pytest.fixture(autouse=True)
def reset_database():
  engine.dispose()
  if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()
  Base.metadata.create_all(bind=engine)
  yield
  engine.dispose()
  if TEST_DB_PATH.exists():
    TEST_DB_PATH.unlink()


@pytest.fixture
async def client() -> httpx.AsyncClient:
  transport = httpx.ASGITransport(app=app)
  async with httpx.AsyncClient(transport=transport, base_url="http://testserver", trust_env=False) as async_client:
    yield async_client


def primary_payload() -> dict[str, object]:
  return ${primaryPayload}


def secondary_payload() -> dict[str, object]:
  return ${secondaryPayload}

${testBlocks.join('\n')}
${unauthorizedTest}
`;
}

function generateEnumBlock(model: IRModel, field: IRModelField): string {
  if (field.fieldType.type !== 'enum') {
    return '';
  }
  const body = field.fieldType.values
    .map((value) => `  ${sanitizePythonEnumMember(value)} = "${escapePythonString(value)}"`)
    .join('\n');
  return `class ${enumClassName(model.name, field.name)}(str, enum.Enum):
${body}
`;
}

function fieldPythonType(model: IRModel, field: IRModelField): string {
  if (field.fieldType.type === 'enum') {
    return enumClassName(model.name, field.name);
  }
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return 'int';
  }
  if (field.fieldType.type !== 'scalar') {
    return 'str';
  }
  switch (field.fieldType.name) {
    case 'string':
    case 'text':
      return 'str';
    case 'integer':
    case 'long':
      return 'int';
    case 'decimal':
      return 'Decimal';
    case 'boolean':
      return 'bool';
    case 'datetime':
      return 'datetime';
    case 'date':
      return 'date';
  }
}

function schemaFieldType(model: IRModel, field: IRModelField): string {
  if (hasDecorator(field, 'email')) {
    return hasDecorator(field, 'required') ? 'EmailStr' : 'EmailStr | None';
  }
  const baseType = fieldPythonType(model, field);
  return hasDecorator(field, 'required') ? baseType : `${baseType} | None`;
}

function schemaResponseFieldType(model: IRModel, field: IRModelField): string {
  if (hasDecorator(field, 'email')) {
    return 'EmailStr';
  }
  return fieldPythonType(model, field);
}

function schemaFieldDefault(field: IRModelField): string {
  const fieldArgs: string[] = [];
  const minLen = numericDecoratorArg(field, 'minLen');
  const maxLen = numericDecoratorArg(field, 'maxLen');
  if (minLen !== undefined) {
    fieldArgs.push(`min_length=${minLen}`);
  }
  if (maxLen !== undefined) {
    fieldArgs.push(`max_length=${maxLen}`);
  }

  if (fieldArgs.length > 0) {
    return hasDecorator(field, 'required')
      ? ` = Field(..., ${fieldArgs.join(', ')})`
      : ` = Field(default=None, ${fieldArgs.join(', ')})`;
  }
  if (hasDecorator(field, 'required')) {
    return '';
  }
  return ' = None';
}

function mappedColumn(field: IRModelField, model: IRModel): string {
  const args: string[] = [];
  if (field.fieldType.type === 'enum') {
    args.push(`SqlEnum(${enumClassName(model.name, field.name)})`);
  } else if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    args.push('Integer');
    args.push(`ForeignKey("${safeTableName(field.fieldType.target)}.id")`);
  } else if (field.fieldType.type === 'scalar') {
    switch (field.fieldType.name) {
      case 'string':
        args.push('String(255)');
        break;
      case 'text':
        args.push('Text');
        break;
      case 'integer':
        args.push('Integer');
        break;
      case 'long':
        args.push('Integer');
        break;
      case 'decimal':
        args.push('Numeric(18, 2)');
        break;
      case 'boolean':
        args.push('Boolean');
        break;
      case 'datetime':
        args.push('DateTime(timezone=True)');
        break;
      case 'date':
        args.push('Date');
        break;
    }
  }

  const kwargs: string[] = [];
  if (hasDecorator(field, 'required') || hasDecorator(field, 'createdAt') || hasDecorator(field, 'updatedAt')) {
    kwargs.push('nullable=False');
  }
  if (hasDecorator(field, 'unique')) {
    kwargs.push('unique=True');
  }
  if (hasDecorator(field, 'createdAt')) {
    kwargs.push('default=utc_now');
  }
  if (hasDecorator(field, 'updatedAt')) {
    kwargs.push('default=utc_now');
    kwargs.push('onupdate=utc_now');
  }
  return `mapped_column(${[...args, ...kwargs].join(', ')})`;
}

function buildFastApiAuthDependency(surface: { auth: { mode: 'public' | 'authenticated'; roles: string[] } }): { importLine: string; argumentLine: string } {
  if (surface.auth.mode === 'public') {
    return {
      importLine: '',
      argumentLine: '',
    };
  }
  if (surface.auth.roles.length > 0) {
    return {
      importLine: 'from app.security import AuthenticatedUser, require_roles',
      argumentLine: `principal: AuthenticatedUser = Depends(require_roles(${surface.auth.roles.map((role) => `"${role}"`).join(', ')}))`,
    };
  }
  return {
    importLine: 'from app.security import AuthenticatedUser, require_authenticated',
    argumentLine: 'principal: AuthenticatedUser = Depends(require_authenticated)',
  };
}

function collectProtectedRoles(ir: IRSdslProgram): string[] {
  return Array.from(new Set(
    [
      ...ir.resources
        .filter((resource) => resource.auth.mode === 'authenticated')
        .flatMap((resource) => resource.auth.roles),
      ...ir.readModels
        .filter((readModel) => readModel.auth.mode === 'authenticated')
        .flatMap((readModel) => readModel.auth.roles),
    ],
  ));
}

function editableModelFields(model: IRModel): IRModelField[] {
  return persistedModelFields(model)
    .filter((field) => !hasDecorator(field, 'createdAt') && !hasDecorator(field, 'updatedAt'));
}

function persistedModelFields(model: IRModel): IRModelField[] {
  return model.fields.filter((field) => !(field.fieldType.type === 'relation' && field.fieldType.kind === 'hasMany'));
}

function enumClassName(modelName: string, fieldName: string): string {
  return `${modelName}${toPascalCase(fieldName)}`;
}

function readModelInputClassName(readModel: IRReadModel): string {
  return `${toPascalCase(readModel.name)}ReadModelInput`;
}

function readModelResultClassName(readModel: IRReadModel): string {
  return `${toPascalCase(readModel.name)}ReadModelResult`;
}

function readModelPythonType(field: IRReadModelField): string {
  if (field.fieldType.type !== 'scalar') {
    return 'str';
  }
  switch (field.fieldType.name) {
    case 'string':
    case 'text':
      return 'str';
    case 'integer':
    case 'long':
      return 'int';
    case 'decimal':
      return 'Decimal';
    case 'boolean':
      return 'bool';
    case 'datetime':
      return 'datetime';
    case 'date':
      return 'date';
  }
}

function pythonDerivationValueExpression(
  field: IRReadModelField,
  valueExpr: string,
  fallbackExpr: string,
): string {
  if (field.fieldType.type !== 'scalar') {
    return fallbackExpr;
  }
  switch (field.fieldType.name) {
    case 'string':
    case 'text':
      return `_as_string_value(${valueExpr}, ${fallbackExpr})`;
    case 'integer':
    case 'long':
      return `_as_int_value(${valueExpr}, ${fallbackExpr})`;
    case 'decimal':
      return `_as_decimal_value(${valueExpr}, ${fallbackExpr})`;
    case 'boolean':
      return `_as_bool_value(${valueExpr}, ${fallbackExpr})`;
    default:
      return fallbackExpr;
  }
}

function readModelQueryType(field: IRReadModelField): string {
  return hasDecorator(field, 'required')
    ? readModelPythonType(field)
    : `${readModelPythonType(field)} | None`;
}

function addReadModelPythonScalarImports(imports: Set<string>, field: IRReadModelField): void {
  if (field.fieldType.type !== 'scalar') {
    return;
  }
  if (field.fieldType.name === 'datetime') {
    imports.add('from datetime import datetime');
  }
  if (field.fieldType.name === 'date') {
    imports.add('from datetime import date');
  }
  if (field.fieldType.name === 'decimal') {
    imports.add('from decimal import Decimal');
  }
}

function hasDecorator(field: { decorators: IRFieldDecorator[] }, decoratorName: string): boolean {
  return field.decorators.some((decorator) => decorator.name === decoratorName);
}

function numericDecoratorArg(field: IRModelField, decoratorName: string): number | undefined {
  const decorator = field.decorators.find((candidate) => candidate.name === decoratorName);
  if (!decorator || !decorator.args || decorator.args.length === 0) {
    return undefined;
  }
  const value = decorator.args[0];
  return typeof value === 'number' ? value : undefined;
}

type SampleVariant = 'primary' | 'secondary';

function samplePythonValue(model: IRModel, field: IRModelField, variant: SampleVariant): string {
  const prefix = `${toSnakeCase(model.name)}_${toSnakeCase(field.name)}`;
  const isPrimary = variant === 'primary';
  if (hasDecorator(field, 'email')) {
    return `"${isPrimary ? 'primary' : 'secondary'}.${toKebabCase(model.name)}.${field.name}@example.com"`;
  }
  if (field.fieldType.type === 'enum') {
    const values = field.fieldType.values;
    const selected = isPrimary ? values[0] : values[Math.min(1, values.length - 1)];
    return `"${escapePythonString(selected)}"`;
  }
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return isPrimary ? '1' : '2';
  }
  if (field.fieldType.type !== 'scalar') {
    return '""';
  }
  switch (field.fieldType.name) {
    case 'string':
      return `"${escapePythonString(`${prefix}-${isPrimary ? 'alpha' : 'beta'}`)}"`;
    case 'text':
      return `"${escapePythonString(`${prefix} ${isPrimary ? 'alpha body' : 'beta body'}`)}"`;
    case 'integer':
      return isPrimary ? '7' : '11';
    case 'long':
      return isPrimary ? '7001' : '7002';
    case 'decimal':
      return `"${isPrimary ? '12.50' : '18.75'}"`;
    case 'boolean':
      return isPrimary ? 'True' : 'False';
    case 'datetime':
      return `"${isPrimary ? '2026-01-15T10:15:30Z' : '2026-02-20T12:00:00Z'}"`;
    case 'date':
      return `"${isPrimary ? '2026-01-15' : '2026-02-20'}"`;
  }
}

function generatePolicyModule(
  resource: IRResource,
  readFile?: (fileName: string) => string,
): string {
  if (resource.auth.policy?.source === 'rules') {
    return generateRulesPolicyModule(resource);
  }
  const snippet = readBackendPolicySnippet(resource.auth.policy?.resolvedPath, readFile, 'return True');
  return `from __future__ import annotations

from app.security import AuthenticatedUser


def allow(principal: AuthenticatedUser, operation: str, params: dict[str, str], payload: dict[str, object] | None) -> bool:
${indentSnippet(snippet, '  ')}
`;
}

function generateRulesPolicyModule(resource: IRResource): string {
  const manifestJson = escapePythonTripleQuoted(JSON.stringify(resource.auth.policy?.manifest ?? { rules: [] }, null, 2));
  return `from __future__ import annotations

import json
from collections.abc import Collection, Mapping, Sequence
from enum import Enum

from app.security import AuthenticatedUser


RULES = json.loads(
  r'''${manifestJson}'''
).get("rules", [])


def allow(principal: AuthenticatedUser, operation: str, params: dict[str, str], payload: dict[str, object] | None, record: object | None = None) -> bool:
  return _decide(principal, operation, params, payload, record)[0]


def allow_list(principal: AuthenticatedUser) -> bool:
  return allow(principal, "list", {}, None, None)


def denied_message(operation: str, principal: AuthenticatedUser, params: dict[str, str], payload: dict[str, object] | None, record: object | None = None) -> str:
  message = _decide(principal, operation, params, payload, record)[1]
  return message or "Forbidden"


def filter_list(principal: AuthenticatedUser, items: Sequence[object]) -> list[object]:
  return [item for item in items if allow(principal, "list", {}, None, item)]


def _decide(principal: AuthenticatedUser, operation: str, params: dict[str, str], payload: dict[str, object] | None, record: object | None) -> tuple[bool, str | None]:
  for rule in RULES:
    if _matches_operation(rule, operation) and rule.get("effect") == "deny" and _matches_rule(rule, principal, params, payload, record):
      return False, _message_for(rule)
  for rule in RULES:
    if _matches_operation(rule, operation) and rule.get("effect") == "allow" and _matches_rule(rule, principal, params, payload, record):
      return True, None
  return False, "Forbidden"


def _matches_rule(rule: Mapping[str, object], principal: AuthenticatedUser, params: dict[str, str], payload: dict[str, object] | None, record: object | None) -> bool:
  if not _eval_boolean(rule.get("when"), principal, params, payload, record) and not _any_matches(rule.get("or"), principal, params, payload, record):
    return False
  if rule.get("operation") == "list" and "scopeWhen" in rule and _eval_boolean(rule.get("scopeWhen"), principal, params, payload, record):
    return _eval_boolean(rule.get("scope"), principal, params, payload, record)
  return True


def _any_matches(candidate: object, principal: AuthenticatedUser, params: dict[str, str], payload: dict[str, object] | None, record: object | None) -> bool:
  return isinstance(candidate, list) and any(_eval_boolean(item, principal, params, payload, record) for item in candidate)


def _eval_boolean(node: object, principal: AuthenticatedUser, params: dict[str, str], payload: dict[str, object] | None, record: object | None) -> bool:
  return _truthy(_eval_expr(node, principal, params, payload, record))


def _eval_expr(node: object, principal: AuthenticatedUser, params: dict[str, str], payload: dict[str, object] | None, record: object | None) -> object:
  if not isinstance(node, dict):
    return None
  node_type = node.get("type")
  if node_type == "literal":
    return node.get("value")
  if node_type == "identifier":
    return _resolve_path(node.get("path"), principal, params, payload, record)
  if node_type == "binary":
    return _eval_binary(node, principal, params, payload, record)
  if node_type == "unary":
    return not _eval_boolean(node.get("operand"), principal, params, payload, record) if node.get("op") == "not" else None
  if node_type == "call":
    return _eval_call(node, principal, params, payload, record)
  if node_type == "member":
    return _read_property(_eval_expr(node.get("object"), principal, params, payload, record), _as_string(node.get("property")))
  if node_type == "in":
    value = _eval_expr(node.get("value"), principal, params, payload, record)
    return any(_values_equal(value, _eval_expr(item, principal, params, payload, record)) for item in node.get("list", []))
  return None


def _eval_binary(node: Mapping[str, object], principal: AuthenticatedUser, params: dict[str, str], payload: dict[str, object] | None, record: object | None) -> object:
  op = _as_string(node.get("op"))
  left = _eval_expr(node.get("left"), principal, params, payload, record)
  right = _eval_expr(node.get("right"), principal, params, payload, record)
  if op == "&&":
    return _truthy(left) and _truthy(right)
  if op == "||":
    return _truthy(left) or _truthy(right)
  if op == "==":
    return _values_equal(left, right)
  if op == "!=":
    return not _values_equal(left, right)
  if op == ">":
    return _compare_values(left, right) > 0
  if op == "<":
    return _compare_values(left, right) < 0
  if op == ">=":
    return _compare_values(left, right) >= 0
  if op == "<=":
    return _compare_values(left, right) <= 0
  return None


def _eval_call(node: Mapping[str, object], principal: AuthenticatedUser, params: dict[str, str], payload: dict[str, object] | None, record: object | None) -> object:
  fn = _as_string(node.get("fn"))
  args = node.get("args") if isinstance(node.get("args"), list) else []
  if fn == "hasRole" and len(args) >= 2:
    return _has_role(_eval_expr(args[0], principal, params, payload, record), _eval_expr(args[1], principal, params, payload, record))
  if fn == "isEmpty" and len(args) >= 1:
    return _is_empty(_eval_expr(args[0], principal, params, payload, record))
  if fn == "isNotEmpty" and len(args) >= 1:
    return not _is_empty(_eval_expr(args[0], principal, params, payload, record))
  if fn == "count" and len(args) >= 1:
    return _count(_eval_expr(args[0], principal, params, payload, record))
  return False


def _resolve_path(candidate: object, principal: AuthenticatedUser, params: dict[str, str], payload: dict[str, object] | None, record: object | None) -> object:
  if not isinstance(candidate, list) or not candidate:
    return None
  root = _as_string(candidate[0])
  if len(candidate) == 1 and isinstance(root, str) and root.isupper():
    return root
  if root == "currentUser" and len(candidate) >= 2:
    return _resolve_current_user(principal, _as_string(candidate[1]))
  if root == "currentUser":
    current: object | None = principal
  elif root == "record":
    current = record
  elif root == "payload":
    current = payload
  elif root == "params":
    current = params
  else:
    return None
  for segment in candidate[1:]:
    current = _read_property(current, _as_string(segment))
  return current


def _resolve_current_user(principal: AuthenticatedUser, property_name: str | None) -> object:
  if property_name in {"id", "username"}:
    return principal.username
  if property_name == "role":
    return principal.roles[0] if principal.roles else None
  if property_name == "roles":
    return principal.roles
  return _read_property(principal, property_name)


def _read_property(target: object, property_name: str | None) -> object:
  if target is None or not property_name:
    return None
  if isinstance(target, Mapping):
    return target.get(property_name)
  if hasattr(target, property_name):
    return getattr(target, property_name)
  getter_name = f"get{property_name[:1].upper()}{property_name[1:]}"
  getter = getattr(target, getter_name, None)
  if callable(getter):
    return getter()
  return None


def _matches_operation(rule: Mapping[str, object], operation: str) -> bool:
  return rule.get("operation") == operation


def _message_for(rule: Mapping[str, object]) -> str:
  message = rule.get("message")
  if isinstance(message, str) and message.strip():
    return message
  if isinstance(message, Mapping):
    default_message = message.get("defaultMessage")
    if isinstance(default_message, str) and default_message.strip():
      return default_message
    key = message.get("key")
    if isinstance(key, str) and key.strip():
      return key
  return "Forbidden"


def _truthy(value: object) -> bool:
  if isinstance(value, bool):
    return value
  if value is None:
    return False
  if isinstance(value, (int, float)):
    return value != 0
  if isinstance(value, str):
    return bool(value.strip())
  if isinstance(value, Collection):
    return len(value) > 0
  if isinstance(value, Mapping):
    return len(value) > 0
  return True


def _values_equal(left: object, right: object) -> bool:
  normalized_left = _normalize_value(left)
  normalized_right = _normalize_value(right)
  if isinstance(normalized_left, (int, float)) and isinstance(normalized_right, (int, float)):
    return float(normalized_left) == float(normalized_right)
  return normalized_left == normalized_right


def _compare_values(left: object, right: object) -> int:
  normalized_left = _normalize_value(left)
  normalized_right = _normalize_value(right)
  if isinstance(normalized_left, (int, float)) and isinstance(normalized_right, (int, float)):
    return (float(normalized_left) > float(normalized_right)) - (float(normalized_left) < float(normalized_right))
  left_text = "" if normalized_left is None else str(normalized_left)
  right_text = "" if normalized_right is None else str(normalized_right)
  return (left_text > right_text) - (left_text < right_text)


def _normalize_value(value: object) -> object:
  if isinstance(value, Enum):
    return value.name
  return value


def _has_role(current_user: object, role: object) -> bool:
  expected_role = str(role) if role is not None else ""
  if not expected_role:
    return False
  roles = _read_property(current_user, "roles")
  if isinstance(roles, Collection):
    return any(str(candidate) == expected_role for candidate in roles)
  primary_role = _read_property(current_user, "role")
  return str(primary_role) == expected_role


def _is_empty(value: object) -> bool:
  if value is None:
    return True
  if isinstance(value, str):
    return not value.strip()
  if isinstance(value, Collection):
    return len(value) == 0
  if isinstance(value, Mapping):
    return len(value) == 0
  return False


def _count(value: object) -> int:
  if value is None:
    return 0
  if isinstance(value, (Collection, Mapping, str)):
    return len(value)
  return 0


def _as_string(value: object) -> str | None:
  return value if isinstance(value, str) else None
`;
}

function generateCreateRulesModule(resource: IRResource): string {
  const manifestJson = escapePythonTripleQuoted(JSON.stringify(resource.create?.rules?.manifest ?? {
    eligibility: [],
    validation: [],
  }, null, 2));
  return `from __future__ import annotations

import json
from collections.abc import Collection, Mapping
from decimal import Decimal
from enum import Enum

from app.security import AuthenticatedUser


MANIFEST = json.loads(
  r'''${manifestJson}'''
)
ELIGIBILITY = MANIFEST.get("eligibility", [])
VALIDATION = MANIFEST.get("validation", [])


def first_eligibility_failure(principal: AuthenticatedUser | None, params: dict[str, str], payload: object) -> str | None:
  for rule in ELIGIBILITY:
    if not _matches_rule(rule, principal, params, payload):
      return _message_for(rule, "Forbidden")
  return None


def first_validation_failure(principal: AuthenticatedUser | None, params: dict[str, str], payload: object) -> str | None:
  for rule in VALIDATION:
    if not _matches_rule(rule, principal, params, payload):
      return _message_for(rule, "Validation failed")
  return None


def _matches_rule(rule: Mapping[str, object], principal: AuthenticatedUser | None, params: dict[str, str], payload: object) -> bool:
  return _eval_boolean(rule.get("when"), principal, params, payload) or _any_matches(rule.get("or"), principal, params, payload)


def _any_matches(candidate: object, principal: AuthenticatedUser | None, params: dict[str, str], payload: object) -> bool:
  return isinstance(candidate, list) and any(_eval_boolean(item, principal, params, payload) for item in candidate)


def _eval_boolean(node: object, principal: AuthenticatedUser | None, params: dict[str, str], payload: object) -> bool:
  return _truthy(_eval_expr(node, principal, params, payload))


def _eval_expr(node: object, principal: AuthenticatedUser | None, params: dict[str, str], payload: object) -> object:
  if not isinstance(node, dict):
    return None
  node_type = node.get("type")
  if node_type == "literal":
    return node.get("value")
  if node_type == "identifier":
    return _resolve_path(node.get("path"), principal, params, payload)
  if node_type == "binary":
    return _eval_binary(node, principal, params, payload)
  if node_type == "unary":
    return not _eval_boolean(node.get("operand"), principal, params, payload) if node.get("op") == "not" else None
  if node_type == "call":
    return _eval_call(node, principal, params, payload)
  if node_type == "member":
    return _read_property(_eval_expr(node.get("object"), principal, params, payload), _as_string(node.get("property")))
  if node_type == "in":
    value = _eval_expr(node.get("value"), principal, params, payload)
    return any(_values_equal(value, _eval_expr(item, principal, params, payload)) for item in node.get("list", []))
  return None


def _eval_binary(node: Mapping[str, object], principal: AuthenticatedUser | None, params: dict[str, str], payload: object) -> object:
  op = _as_string(node.get("op"))
  left = _eval_expr(node.get("left"), principal, params, payload)
  right = _eval_expr(node.get("right"), principal, params, payload)
  if op == "&&":
    return _truthy(left) and _truthy(right)
  if op == "||":
    return _truthy(left) or _truthy(right)
  if op == "==":
    return _values_equal(left, right)
  if op == "!=":
    return not _values_equal(left, right)
  if op == ">":
    return _compare_values(left, right) > 0
  if op == "<":
    return _compare_values(left, right) < 0
  if op == ">=":
    return _compare_values(left, right) >= 0
  if op == "<=":
    return _compare_values(left, right) <= 0
  if op == "+":
    return _add_values(left, right)
  if op == "-":
    return _subtract_values(left, right)
  if op == "*":
    return _multiply_values(left, right)
  if op == "/":
    return _divide_values(left, right)
  return None


def _eval_call(node: Mapping[str, object], principal: AuthenticatedUser | None, params: dict[str, str], payload: object) -> object:
  fn = _as_string(node.get("fn"))
  args = node.get("args") if isinstance(node.get("args"), list) else []
  if fn == "hasRole" and len(args) >= 2:
    return _has_role(_eval_expr(args[0], principal, params, payload), _eval_expr(args[1], principal, params, payload))
  if fn == "isEmpty" and len(args) >= 1:
    return _is_empty(_eval_expr(args[0], principal, params, payload))
  if fn == "isNotEmpty" and len(args) >= 1:
    return not _is_empty(_eval_expr(args[0], principal, params, payload))
  if fn == "count" and len(args) >= 1:
    return _count(_eval_expr(args[0], principal, params, payload))
  return False


def _resolve_path(candidate: object, principal: AuthenticatedUser | None, params: dict[str, str], payload: object) -> object:
  if not isinstance(candidate, list) or not candidate:
    return None
  root = _as_string(candidate[0])
  if len(candidate) == 1 and isinstance(root, str) and root.isupper():
    return root
  if root == "currentUser" and len(candidate) >= 2:
    return _resolve_current_user(principal, _as_string(candidate[1]))
  if root == "currentUser":
    current: object | None = principal
  elif root == "payload":
    current = payload
  elif root == "params":
    current = params
  else:
    return None
  for segment in candidate[1:]:
    current = _read_property(current, _as_string(segment))
  return current


def _resolve_current_user(principal: AuthenticatedUser | None, property_name: str | None) -> object:
  if principal is None:
    if property_name == "roles":
      return []
    return None
  if property_name in {"id", "username"}:
    return principal.username
  if property_name == "role":
    return principal.roles[0] if principal.roles else None
  if property_name == "roles":
    return principal.roles
  return _read_property(principal, property_name)


def _read_property(target: object, property_name: str | None) -> object:
  if target is None or not property_name:
    return None
  if isinstance(target, Mapping):
    return target.get(property_name)
  if hasattr(target, property_name):
    return getattr(target, property_name)
  getter_name = f"get{property_name[:1].upper()}{property_name[1:]}"
  getter = getattr(target, getter_name, None)
  if callable(getter):
    return getter()
  return None


def _message_for(rule: Mapping[str, object], fallback: str) -> str:
  message = rule.get("message")
  if isinstance(message, str) and message.strip():
    return message
  if isinstance(message, Mapping):
    default_message = message.get("defaultMessage")
    if isinstance(default_message, str) and default_message.strip():
      return default_message
    key = message.get("key")
    if isinstance(key, str) and key.strip():
      return key
  return fallback


def _truthy(value: object) -> bool:
  if isinstance(value, bool):
    return value
  if value is None:
    return False
  if isinstance(value, (int, float, Decimal)):
    return value != 0
  if isinstance(value, str):
    return bool(value.strip())
  if isinstance(value, Collection):
    return len(value) > 0
  if isinstance(value, Mapping):
    return len(value) > 0
  return True


def _values_equal(left: object, right: object) -> bool:
  normalized_left = _normalize_value(left)
  normalized_right = _normalize_value(right)
  if isinstance(normalized_left, (int, float, Decimal)) and isinstance(normalized_right, (int, float, Decimal)):
    return Decimal(str(normalized_left)) == Decimal(str(normalized_right))
  return normalized_left == normalized_right


def _compare_values(left: object, right: object) -> int:
  normalized_left = _normalize_value(left)
  normalized_right = _normalize_value(right)
  if isinstance(normalized_left, (int, float, Decimal)) and isinstance(normalized_right, (int, float, Decimal)):
    left_decimal = Decimal(str(normalized_left))
    right_decimal = Decimal(str(normalized_right))
    return (left_decimal > right_decimal) - (left_decimal < right_decimal)
  left_text = "" if normalized_left is None else str(normalized_left)
  right_text = "" if normalized_right is None else str(normalized_right)
  return (left_text > right_text) - (left_text < right_text)


def _normalize_value(value: object) -> object:
  if isinstance(value, Enum):
    return value.name
  return value


def _has_role(current_user: object, role: object) -> bool:
  expected_role = str(role) if role is not None else ""
  if not expected_role:
    return False
  roles = _read_property(current_user, "roles")
  if isinstance(roles, Collection):
    return any(str(candidate) == expected_role for candidate in roles)
  primary_role = _read_property(current_user, "role")
  return str(primary_role) == expected_role


def _is_empty(value: object) -> bool:
  if value is None:
    return True
  if isinstance(value, str):
    return not value.strip()
  if isinstance(value, Collection):
    return len(value) == 0
  if isinstance(value, Mapping):
    return len(value) == 0
  return False


def _count(value: object) -> int:
  if value is None:
    return 0
  if isinstance(value, (Collection, Mapping, str)):
    return len(value)
  return 0


def _as_string(value: object) -> str | None:
  return value if isinstance(value, str) else None


def _add_values(left: object, right: object) -> object:
  if isinstance(left, str) or isinstance(right, str):
    return f"{'' if left is None else left}{'' if right is None else right}"
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    return Decimal(str(left)) + Decimal(str(right))
  return None


def _subtract_values(left: object, right: object) -> object:
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    return Decimal(str(left)) - Decimal(str(right))
  return None


def _multiply_values(left: object, right: object) -> object:
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    return Decimal(str(left)) * Decimal(str(right))
  return None


def _divide_values(left: object, right: object) -> object:
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    divisor = Decimal(str(right))
    if divisor == 0:
      return None
    return Decimal(str(left)) / divisor
  return None
`;
}

function generateReadModelRulesModule(readModel: IRReadModel): string {
  const manifestJson = escapePythonTripleQuoted(JSON.stringify(readModel.rules?.manifest ?? {
    eligibility: [],
    validation: [],
    derivations: [],
  }, null, 2));
  const derivationHelpers = readModel.result
    .map((field) => {
      const derivation = readModel.rules?.program.derivations.find((entry) => entry.field === field.name);
      if (!derivation) {
        return '';
      }
      return `
def _apply_${toSnakeCase(field.name)}_derivation(input: ${readModelInputClassName(readModel)}, principal: AuthenticatedUser | None, item: ${readModelResultClassName(readModel)}) -> ${readModelPythonType(field)}:
  rule = _find_derivation("${field.name}")
  if rule is None:
    return item.${field.name}
  if rule.get("when") is not None and not _eval_boolean(rule.get("when"), principal, input, item):
    return item.${field.name}
  return ${pythonDerivationValueExpression(field, '_eval_expr(rule.get("value"), principal, input, item)', `item.${field.name}`)}
`;
    })
    .filter(Boolean)
    .join('\n');
  const resultAssignments = readModel.result
    .map((field) => {
      const derivation = readModel.rules?.program.derivations.find((entry) => entry.field === field.name);
      return `      ${field.name}=${derivation ? `_apply_${toSnakeCase(field.name)}_derivation(input, principal, item)` : `item.${field.name}`},`;
    })
    .join('\n');

  return `from __future__ import annotations

import json
from collections.abc import Collection, Mapping, Sequence
from decimal import Decimal
from enum import Enum

from app.schemas.${toSnakeCase(readModel.name)}_read_model import ${readModelInputClassName(readModel)}, ${readModelResultClassName(readModel)}
from app.security import AuthenticatedUser


MANIFEST = json.loads(
  r'''${manifestJson}'''
)
ELIGIBILITY = MANIFEST.get("eligibility", [])
VALIDATION = MANIFEST.get("validation", [])
DERIVATIONS = MANIFEST.get("derivations", [])


def first_eligibility_failure(input: ${readModelInputClassName(readModel)}, principal: AuthenticatedUser | None) -> str | None:
  for rule in ELIGIBILITY:
    if not _matches_rule(rule, principal, input):
      return _message_for(rule, "Forbidden")
  return None


def first_validation_failure(input: ${readModelInputClassName(readModel)}, principal: AuthenticatedUser | None) -> str | None:
  for rule in VALIDATION:
    if not _matches_rule(rule, principal, input):
      return _message_for(rule, "Invalid request")
  return None


def apply_derivations(
  input: ${readModelInputClassName(readModel)},
  principal: AuthenticatedUser | None,
  items: Sequence[${readModelResultClassName(readModel)}],
) -> list[${readModelResultClassName(readModel)}]:
  if not DERIVATIONS:
    return list(items)
  return [
    ${readModelResultClassName(readModel)}(
${resultAssignments}
    )
    for item in items
  ]
${derivationHelpers ? `\n${derivationHelpers}` : ''}

def _matches_rule(rule: Mapping[str, object], principal: AuthenticatedUser | None, input: ${readModelInputClassName(readModel)}) -> bool:
  return _eval_boolean(rule.get("when"), principal, input, None) or _any_matches(rule.get("or"), principal, input, None)


def _find_derivation(field: str) -> Mapping[str, object] | None:
  for entry in DERIVATIONS:
    if isinstance(entry, Mapping) and entry.get("field") == field:
      return entry
  return None


def _any_matches(candidate: object, principal: AuthenticatedUser | None, input: ${readModelInputClassName(readModel)}, item: ${readModelResultClassName(readModel)} | None) -> bool:
  return isinstance(candidate, list) and any(_eval_boolean(rule, principal, input, item) for rule in candidate)


def _eval_boolean(node: object, principal: AuthenticatedUser | None, input: ${readModelInputClassName(readModel)}, item: ${readModelResultClassName(readModel)} | None) -> bool:
  return _truthy(_eval_expr(node, principal, input, item))


def _eval_expr(node: object, principal: AuthenticatedUser | None, input: ${readModelInputClassName(readModel)}, item: ${readModelResultClassName(readModel)} | None) -> object:
  if not isinstance(node, dict):
    return None
  node_type = node.get("type")
  if node_type == "literal":
    return node.get("value")
  if node_type == "identifier":
    return _resolve_path(node.get("path"), principal, input, item)
  if node_type == "binary":
    return _eval_binary(node, principal, input, item)
  if node_type == "unary":
    return not _eval_boolean(node.get("operand"), principal, input, item) if node.get("op") == "not" else None
  if node_type == "call":
    return _eval_call(node, principal, input, item)
  if node_type == "member":
    return _read_property(_eval_expr(node.get("object"), principal, input, item), _as_string(node.get("property")))
  if node_type == "in":
    value = _eval_expr(node.get("value"), principal, input, item)
    return any(_values_equal(value, _eval_expr(candidate, principal, input, item)) for candidate in node.get("list", []))
  return None


def _eval_binary(node: Mapping[str, object], principal: AuthenticatedUser | None, input: ${readModelInputClassName(readModel)}, item: ${readModelResultClassName(readModel)} | None) -> object:
  op = _as_string(node.get("op"))
  left = _eval_expr(node.get("left"), principal, input, item)
  right = _eval_expr(node.get("right"), principal, input, item)
  if op == "&&":
    return _truthy(left) and _truthy(right)
  if op == "||":
    return _truthy(left) or _truthy(right)
  if op == "==":
    return _values_equal(left, right)
  if op == "!=":
    return not _values_equal(left, right)
  if op == ">":
    return _compare_values(left, right) > 0
  if op == "<":
    return _compare_values(left, right) < 0
  if op == ">=":
    return _compare_values(left, right) >= 0
  if op == "<=":
    return _compare_values(left, right) <= 0
  if op == "+":
    return _add_values(left, right)
  if op == "-":
    return _subtract_values(left, right)
  if op == "*":
    return _multiply_values(left, right)
  if op == "/":
    return _divide_values(left, right)
  return None


def _eval_call(node: Mapping[str, object], principal: AuthenticatedUser | None, input: ${readModelInputClassName(readModel)}, item: ${readModelResultClassName(readModel)} | None) -> object:
  fn = _as_string(node.get("fn"))
  args = node.get("args") if isinstance(node.get("args"), list) else []
  if fn == "hasRole" and len(args) >= 2:
    return _has_role(_eval_expr(args[0], principal, input, item), _eval_expr(args[1], principal, input, item))
  if fn == "isEmpty" and len(args) >= 1:
    return _is_empty(_eval_expr(args[0], principal, input, item))
  if fn == "isNotEmpty" and len(args) >= 1:
    return not _is_empty(_eval_expr(args[0], principal, input, item))
  if fn == "count" and len(args) >= 1:
    return _count(_eval_expr(args[0], principal, input, item))
  return False


def _resolve_path(candidate: object, principal: AuthenticatedUser | None, input: ${readModelInputClassName(readModel)}, item: ${readModelResultClassName(readModel)} | None) -> object:
  if not isinstance(candidate, list) or not candidate:
    return None
  root = _as_string(candidate[0])
  if len(candidate) == 1 and isinstance(root, str) and root.isupper():
    return root
  if root == "currentUser" and len(candidate) >= 2:
    return _resolve_current_user(principal, _as_string(candidate[1]))
  if root == "currentUser":
    current: object | None = principal
  elif root == "input":
    current = input
  elif root == "item":
    current = item
  else:
    return None
  for segment in candidate[1:]:
    current = _read_property(current, _as_string(segment))
  return current


def _resolve_current_user(principal: AuthenticatedUser | None, property_name: str | None) -> object:
  if principal is None:
    if property_name == "roles":
      return []
    return None
  if property_name in {"id", "username"}:
    return principal.username
  if property_name == "role":
    return principal.roles[0] if principal.roles else None
  if property_name == "roles":
    return principal.roles
  return _read_property(principal, property_name)


def _read_property(target: object, property_name: str | None) -> object:
  if target is None or not property_name:
    return None
  if isinstance(target, Mapping):
    return target.get(property_name)
  if hasattr(target, property_name):
    return getattr(target, property_name)
  getter_name = f"get{property_name[:1].upper()}{property_name[1:]}"
  getter = getattr(target, getter_name, None)
  if callable(getter):
    return getter()
  return None


def _message_for(rule: Mapping[str, object], fallback: str) -> str:
  message = rule.get("message")
  if isinstance(message, str) and message.strip():
    return message
  if isinstance(message, Mapping):
    default_message = message.get("defaultMessage")
    if isinstance(default_message, str) and default_message.strip():
      return default_message
    key = message.get("key")
    if isinstance(key, str) and key.strip():
      return key
  return fallback


def _truthy(value: object) -> bool:
  if isinstance(value, bool):
    return value
  if value is None:
    return False
  if isinstance(value, (int, float, Decimal)):
    return value != 0
  if isinstance(value, str):
    return bool(value.strip())
  if isinstance(value, Collection):
    return len(value) > 0
  if isinstance(value, Mapping):
    return len(value) > 0
  return True


def _values_equal(left: object, right: object) -> bool:
  normalized_left = _normalize_value(left)
  normalized_right = _normalize_value(right)
  if isinstance(normalized_left, (int, float, Decimal)) and isinstance(normalized_right, (int, float, Decimal)):
    return Decimal(str(normalized_left)) == Decimal(str(normalized_right))
  return normalized_left == normalized_right


def _compare_values(left: object, right: object) -> int:
  normalized_left = _normalize_value(left)
  normalized_right = _normalize_value(right)
  if isinstance(normalized_left, (int, float, Decimal)) and isinstance(normalized_right, (int, float, Decimal)):
    left_decimal = Decimal(str(normalized_left))
    right_decimal = Decimal(str(normalized_right))
    return (left_decimal > right_decimal) - (left_decimal < right_decimal)
  left_text = "" if normalized_left is None else str(normalized_left)
  right_text = "" if normalized_right is None else str(normalized_right)
  return (left_text > right_text) - (left_text < right_text)


def _normalize_value(value: object) -> object:
  if isinstance(value, Enum):
    return value.name
  return value


def _has_role(current_user: object, role: object) -> bool:
  expected_role = str(role) if role is not None else ""
  if not expected_role:
    return False
  roles = _read_property(current_user, "roles")
  if isinstance(roles, Collection):
    return any(str(candidate) == expected_role for candidate in roles)
  primary_role = _read_property(current_user, "role")
  return str(primary_role) == expected_role


def _is_empty(value: object) -> bool:
  if value is None:
    return True
  if isinstance(value, str):
    return not value.strip()
  if isinstance(value, Collection):
    return len(value) == 0
  if isinstance(value, Mapping):
    return len(value) == 0
  return False


def _count(value: object) -> int:
  if value is None:
    return 0
  if isinstance(value, (Collection, Mapping, str)):
    return len(value)
  return 0


def _as_string(value: object) -> str | None:
  return value if isinstance(value, str) else None


def _add_values(left: object, right: object) -> object:
  if isinstance(left, str) or isinstance(right, str):
    return f"{'' if left is None else left}{'' if right is None else right}"
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    return Decimal(str(left)) + Decimal(str(right))
  return None


def _subtract_values(left: object, right: object) -> object:
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    return Decimal(str(left)) - Decimal(str(right))
  return None


def _multiply_values(left: object, right: object) -> object:
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    return Decimal(str(left)) * Decimal(str(right))
  return None


def _divide_values(left: object, right: object) -> object:
  if isinstance(left, (int, float, Decimal)) and isinstance(right, (int, float, Decimal)):
    divisor = Decimal(str(right))
    if divisor == 0:
      return None
    return Decimal(str(left)) / divisor
  return None


def _as_string_value(value: object, fallback: str) -> str:
  return fallback if value is None else str(value)


def _as_int_value(value: object, fallback: int) -> int:
  if isinstance(value, bool):
    return int(value)
  if isinstance(value, (int, float, Decimal)):
    return int(value)
  return fallback


def _as_decimal_value(value: object, fallback: Decimal) -> Decimal:
  if isinstance(value, Decimal):
    return value
  if isinstance(value, (int, float)):
    return Decimal(str(value))
  return fallback


def _as_bool_value(value: object, fallback: bool) -> bool:
  if isinstance(value, bool):
    return value
  return fallback
`;
}

function readBackendPolicySnippet(
  resolvedPath: string | undefined,
  readFile: ((fileName: string) => string) | undefined,
  fallback: string,
): string {
  if (!resolvedPath || !readFile) {
    return fallback;
  }
  try {
    const source = readFile(resolvedPath).trim();
    return source.length > 0 ? source : fallback;
  } catch {
    return fallback;
  }
}

function readSqlSource(
  resolvedPath: string | undefined,
  readFile: ((fileName: string) => string) | undefined,
  fallback: string,
): string {
  if (!resolvedPath || !readFile) {
    return fallback;
  }
  try {
    const source = readFile(resolvedPath).trim();
    return source.length > 0 ? source : fallback;
  } catch {
    return fallback;
  }
}

function indentSnippet(source: string, indent: string): string {
  return source
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => `${indent}${line}`)
    .join('\n');
}

function escapePythonTripleQuotedString(source: string): string {
  return source.replace(/\r\n/g, '\n').replaceAll('"""', '\\"\\"\\"');
}

function sampleJsonLiteral(model: IRModel, field: IRModelField, variant: SampleVariant): string {
  const value = samplePythonValue(model, field, variant);
  return value === 'True' ? 'True'
    : value === 'False' ? 'False'
      : value;
}

function renderPythonDict(entries: Array<[string, string]>): string {
  if (entries.length === 0) {
    return '{}';
  }
  return `{\n${entries.map(([key, value]) => `    "${key}": ${value},`).join('\n')}\n  }`;
}

function sanitizePythonEnumMember(value: string): string {
  const normalized = value
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/^([0-9])/, '_$1');
  return normalized || 'UNKNOWN';
}

function safeTableName(modelName: string): string {
  const baseName = toSnakeCase(modelName);
  if (SQL_RESERVED_IDENTIFIERS.has(baseName.toLowerCase())) {
    return `${baseName}_records`;
  }
  return baseName;
}

function toPascalCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function toKebabCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase())
    .join('-');
}

function toSnakeCase(input: string): string {
  return input
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part.toLowerCase())
    .join('_');
}

function pythonTuple(items: string[]): string {
  if (items.length === 1) {
    return `(${items[0]},)`;
  }
  return `(${items.join(', ')})`;
}

function escapePythonString(input: string): string {
  return input.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function escapePythonTripleQuoted(input: string): string {
  return input.replace(/\r\n/g, '\n').replaceAll("'''", "\\'\\'\\'");
}

const SQL_RESERVED_IDENTIFIERS = new Set([
  'group',
  'order',
  'select',
  'table',
  'user',
  'where',
]);
