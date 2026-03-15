export type BackendTarget = 'spring-boot' | 'fastapi';
export type BackendLanguage = 'java' | 'python';
export type BackendProfile = 'mvc-jpa-security' | 'rest-sqlalchemy-auth';
export type BackendTargetKey = `${BackendTarget}/${BackendLanguage}/${BackendProfile}`;

export interface BackendCompilerInput {
  target?: string;
  language?: string;
  profile?: string;
}

export interface BackendTargetDescriptor {
  key: BackendTargetKey;
  target: BackendTarget;
  language: BackendLanguage;
  profile: BackendProfile;
  status: 'implemented' | 'planned';
  label: string;
}

export interface ResolvedBackendCompilerInput {
  target: string;
  language: string;
  profile: string;
  descriptor?: BackendTargetDescriptor;
  targetDescriptor?: BackendTargetDescriptor;
}

export const BACKEND_TARGET_DESCRIPTORS: BackendTargetDescriptor[] = [
  {
    key: 'spring-boot/java/mvc-jpa-security',
    target: 'spring-boot',
    language: 'java',
    profile: 'mvc-jpa-security',
    status: 'implemented',
    label: 'Spring Boot + Java + MVC/JPA/Security',
  },
  {
    key: 'fastapi/python/rest-sqlalchemy-auth',
    target: 'fastapi',
    language: 'python',
    profile: 'rest-sqlalchemy-auth',
    status: 'implemented',
    label: 'FastAPI + Python + REST/SQLAlchemy/Auth',
  },
];

export const DEFAULT_BACKEND_TARGET = BACKEND_TARGET_DESCRIPTORS[0];

const backendTargetDescriptorByKey = new Map(
  BACKEND_TARGET_DESCRIPTORS.map((descriptor) => [descriptor.key, descriptor]),
);

export function composeBackendTargetKey(target: string, language: string, profile: string): string {
  return `${target}/${language}/${profile}`;
}

export function formatBackendTargetTriple(
  value:
    | Pick<BackendTargetDescriptor, 'target' | 'language' | 'profile'>
    | Pick<ResolvedBackendCompilerInput, 'target' | 'language' | 'profile'>,
): string {
  return composeBackendTargetKey(value.target, value.language, value.profile);
}

export function describeBackendTargetDescriptor(descriptor: BackendTargetDescriptor): string {
  return `"${descriptor.key}" (${descriptor.status})`;
}

export function listKnownBackendTargets(): string[] {
  return Array.from(new Set(BACKEND_TARGET_DESCRIPTORS.map((descriptor) => descriptor.target)));
}

export function listKnownBackendTargetTriples(): string[] {
  return BACKEND_TARGET_DESCRIPTORS.map(describeBackendTargetDescriptor);
}

export function listImplementedBackendTargetTriples(): string[] {
  return BACKEND_TARGET_DESCRIPTORS
    .filter((descriptor) => descriptor.status === 'implemented')
    .map((descriptor) => `"${descriptor.key}"`);
}

export function getBackendTargetDescriptor(target: string, language: string, profile: string): BackendTargetDescriptor | undefined {
  return backendTargetDescriptorByKey.get(composeBackendTargetKey(target, language, profile) as BackendTargetKey);
}

export function isImplementedBackendTargetDescriptor(descriptor: BackendTargetDescriptor): boolean {
  return descriptor.status === 'implemented';
}

export function resolveBackendCompilerInput(input?: BackendCompilerInput): ResolvedBackendCompilerInput {
  const targetDescriptor = input?.target
    ? BACKEND_TARGET_DESCRIPTORS.find((descriptor) => descriptor.target === input.target)
    : DEFAULT_BACKEND_TARGET;
  const target = input?.target ?? DEFAULT_BACKEND_TARGET.target;
  const language = input?.language ?? targetDescriptor?.language ?? DEFAULT_BACKEND_TARGET.language;
  const profile = input?.profile
    ?? BACKEND_TARGET_DESCRIPTORS.find((descriptor) => descriptor.target === target && descriptor.language === language)?.profile
    ?? targetDescriptor?.profile
    ?? DEFAULT_BACKEND_TARGET.profile;
  const descriptor = getBackendTargetDescriptor(target, language, profile);

  return {
    target,
    language,
    profile,
    descriptor,
    targetDescriptor,
  };
}
