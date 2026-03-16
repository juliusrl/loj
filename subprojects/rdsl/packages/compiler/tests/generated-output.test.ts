import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { compile, compileProject } from '../src/index.js';

const repoRoot = new URL('../../../../../', import.meta.url).pathname;

const source = `
app:
  name: "User Management"
  theme: dark
  auth: jwt
  navigation:
    - group: "System"
      visibleIf: hasRole(currentUser, "admin")
      items:
        - label: "Overview"
          icon: dashboard
          target: page.dashboard
        - label: "Users"
          icon: users
          target: resource.users.list

page dashboard:
  title: "System Overview"
  type: dashboard
  layout: grid(2)
  blocks:
    - type: metric
      title: "Total Users"
      data: query.users.count

model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(admin, editor, viewer)
  status: enum(active, suspended)

resource users:
  model: User
  api: /api/users

  list:
    title: "User Management"
    filters: [email, role]
    columns:
      - name @sortable
      - role @tag(admin:red, editor:blue, viewer:gray)
    actions:
      - create
      - edit
      - delete @confirm("Delete this user?")

  edit:
    fields:
      - name
      - email @disabled
      - role @select
    rules:
      visibleIf: hasRole(currentUser, "admin")
      enabledIf: hasRole(currentUser, "admin")
      allowIf: hasRole(currentUser, "admin")
    onSuccess:
      - refresh: users
      - toast: "Saved"

  create:
    fields: [name, email, role]
    rules:
      allowIf: hasRole(currentUser, "admin")
    onSuccess:
      - redirect: users.list
      - toast: "Created"
`;

const shimSource = `
declare namespace JSX {
  interface Element {}
  interface ElementChildrenAttribute {
    children: {};
  }
  interface IntrinsicElements {
    [elementName: string]: any;
  }
}

declare namespace React {
  type ReactNode = any;
  type FormEvent = any;
  type ComponentType<P = any> = (props: P) => any;
  interface Context<T> {
    Provider: ComponentType<{ value: T; children?: ReactNode }>;
  }
}

declare module 'react' {
  const React: {
    createElement(type: any, props?: any, ...children: any[]): any;
    memo<T>(component: T): T;
    lazy<T>(factory: () => Promise<{ default: T }>): T;
    Suspense: any;
    createContext<T>(defaultValue: T): React.Context<T>;
    useContext<T>(context: React.Context<T>): T;
    useState<S>(initialState: S | (() => S)): [S, (value: S | ((prev: S) => S)) => void];
    useEffect(effect: () => void | (() => void), deps?: readonly unknown[]): void;
    useCallback<T extends (...args: any[]) => any>(callback: T, deps: readonly unknown[]): T;
    useMemo<T>(factory: () => T, deps: readonly unknown[]): T;
    useRef<T>(initialValue: T): { current: T };
    useDeferredValue<T>(value: T): T;
    startTransition(callback: () => void): void;
  };
  export default React;
  export const createElement: typeof React.createElement;
  export const memo: typeof React.memo;
  export const lazy: typeof React.lazy;
  export const Suspense: typeof React.Suspense;
  export const createContext: typeof React.createContext;
  export const useContext: typeof React.useContext;
  export const useState: typeof React.useState;
  export const useEffect: typeof React.useEffect;
  export const useCallback: typeof React.useCallback;
  export const useMemo: typeof React.useMemo;
  export const useRef: typeof React.useRef;
  export const useDeferredValue: typeof React.useDeferredValue;
  export const startTransition: typeof React.startTransition;
}

`;

function typecheckGeneratedFiles(files: Array<{ path: string; content: string }>): ts.Diagnostic[] {
  const tempRoot = mkdtempSync(join(tmpdir(), 'reactdsl-generated-'));

  const rootNames: string[] = [];
  const writtenFiles = new Set<string>();
  for (const file of files) {
    const absPath = join(tempRoot, file.path);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, file.content, 'utf8');
    if (isCodeFilePath(file.path)) {
      rootNames.push(absPath);
    }
    writtenFiles.add(absPath);
  }

  for (const file of files) {
    const absPath = join(tempRoot, file.path);
    for (const importPath of collectRelativeImportPaths(file.content)) {
      const stubPath = resolveRelativeImportPath(absPath, importPath, writtenFiles);
      if (!stubPath || writtenFiles.has(stubPath)) {
        continue;
      }
      mkdirSync(dirname(stubPath), { recursive: true });
      if (isAssetLikeImportPath(importPath)) {
        writeFileSync(stubPath, '', 'utf8');
      } else {
        writeFileSync(
          stubPath,
          `const Component: React.ComponentType<any> = () => null;\nexport default Component;\n`,
          'utf8',
        );
        rootNames.push(stubPath);
      }
      writtenFiles.add(stubPath);
    }
  }

  const shimPath = join(tempRoot, 'reactdsl-shims.d.ts');
  writeFileSync(shimPath, shimSource, 'utf8');
  rootNames.push(shimPath);
  rootNames.push(join(repoRoot, 'subprojects/rdsl/packages/runtime/src/react-shim.d.ts'));

  const program = ts.createProgram(rootNames, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    jsx: ts.JsxEmit.React,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    strict: true,
    skipLibCheck: true,
    noEmit: true,
    baseUrl: repoRoot,
    paths: {
      '@loj-lang/shared-contracts': ['packages/loj-shared-contracts/src/index.ts'],
      '@loj-lang/rdsl-runtime': ['subprojects/rdsl/packages/runtime/src/index.ts'],
      '@loj-lang/rdsl-runtime/*': ['subprojects/rdsl/packages/runtime/src/*'],
    },
  });

  return ts.getPreEmitDiagnostics(program);
}

function collectRelativeImportPaths(content: string): string[] {
  const matches = content.matchAll(/from ['"](\.{1,2}\/[^'"]+)['"]/g);
  return Array.from(new Set(Array.from(matches, (match) => match[1])));
}

function resolveRelativeImportPath(
  importerPath: string,
  importPath: string,
  writtenFiles: Set<string>,
): string | null {
  const basePath = resolve(dirname(importerPath), importPath);
  const candidates = importPath.match(/\.[A-Za-z0-9]+$/)
    ? [basePath]
    : [
      `${basePath}.ts`,
      `${basePath}.tsx`,
      `${basePath}.js`,
      `${basePath}.jsx`,
      join(basePath, 'index.ts'),
      join(basePath, 'index.tsx'),
      join(basePath, 'index.js'),
      join(basePath, 'index.jsx'),
    ];

  if (candidates.some((candidate) => writtenFiles.has(candidate))) {
    return null;
  }

  return candidates[0] ?? null;
}

function isAssetLikeImportPath(importPath: string): boolean {
  return /\.(css|svg|png|jpg|jpeg|webp|ico)$/.test(importPath);
}

function isCodeFilePath(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx)$/.test(filePath);
}

function formatDiagnostics(diagnostics: ts.Diagnostic[]): string {
  return diagnostics
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'))
    .join('\n');
}

describe('generated output', () => {
  it('typechecks as a generated TSX project with ambient runtime shims', () => {
    const result = compile(source);
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated toast descriptor effects against the real runtime package', () => {
    const descriptorSource = `
model User:
  name: string
  email: string

resource users:
  model: User
  api: /api/users
  edit:
    fields:
      - name
      - email
    onSuccess:
      - toast:
          key: users.saved
          defaultMessage: "User {name} saved by {actor}"
          values:
            name:
              ref: form.name
            actor:
              ref: user.name
            id:
              ref: params.id
`;
    const result = compile(descriptorSource);
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated belongsTo relation form fields against the real runtime package', () => {
    const relationSource = `
model Team:
  name: string @required

model User:
  name: string @required
  team: belongsTo(Team) @required

resource teams:
  model: Team
  api: /api/teams

resource users:
  model: User
  api: /api/users
  create:
    fields:
      - name
      - team
  edit:
    fields:
      - name
      - team
`;
    const result = compile(relationSource, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output when models carry hasMany inverse metadata', () => {
    const relationSource = `
model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team) @required

resource teams:
  model: Team
  api: /api/teams

resource users:
  model: User
  api: /api/users
`;
    const result = compile(relationSource, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for relation-derived list projections', () => {
    const relationSource = `
model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  list:
    filters:
      - members.count
    columns:
      - name
      - members.count @sortable

resource users:
  model: User
  api: /api/users
  list:
    filters:
      - team.name
    columns:
      - name
      - team.name @sortable
  create:
    fields:
      - name
      - team
`;
    const result = compile(relationSource, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for read views with relation-driven panels', () => {
    const relationSource = `
model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  list:
    columns:
      - name
      - members.count
    actions:
      - view
  read:
    fields:
      - name
      - members.count
    related:
      - members

resource users:
  model: User
  api: /api/users
  list:
    filters:
      - name
      - team.name
    columns:
      - name
      - team.name @sortable
    actions:
      - create
      - view
      - delete @confirm("Remove user?")
    pagination:
      size: 10
      style: numbered
  create:
    fields:
      - name
      - team
  read:
    fields:
      - name
      - team.name
`;
    const result = compile(relationSource, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for page table blocks that reuse resource list surfaces', () => {
    const relationSource = `
page dashboard:
  title: "Overview"
  blocks:
    - type: table
      title: "Users"
      data: users.list

model Team:
  name: string @required

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
  list:
    filters:
      - name
      - team.name
    columns:
      - name
      - team.name @sortable
    actions:
      - create
      - view
      - delete @confirm("Remove user?")
    pagination:
      size: 10
      style: numbered
  create:
    fields:
      - name
      - team
  read:
    fields:
      - name
      - team.name
`;
    const result = compile(relationSource, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for workflow-linked resource-backed table consumers', () => {
    const source = `
page dashboard:
  title: "Overview"
  blocks:
    - type: table
      title: "Bookings"
      data: bookings.list

model Team:
  name: string @required
  bookings: hasMany(Booking, by: team)

model Booking:
  reference: string @required
  status: enum(DRAFT, READY, TICKETED)
  team: belongsTo(Team)
  travelers: hasMany(Traveler, by: booking)

model Traveler:
  name: string @required
  booking: belongsTo(Booking)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name
    related:
      - bookings

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  list:
    columns:
      - reference
      - status
    actions:
      - view
      - edit
  edit:
    fields:
      - reference
  read:
    fields:
      - reference
      - status
    related:
      - travelers

resource travelers:
  model: Traveler
  api: /api/travelers
  list:
    columns:
      - name
    actions:
      - view
  read:
    fields:
      - name
`;
    const files = {
      'app.web.loj': source,
      'workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
    TICKETED:
      label: "Ticketed"
  transitions:
    confirm:
      from: DRAFT
      to: READY
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: (fileName: string) => files[fileName as keyof typeof files] ?? null,
    });
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for page table blocks backed by read-model list surfaces', () => {
    const source = `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    from: string @required
    cabin: enum(economy, business)
  result:
    flightNo: string
    fare: number
  list:
    columns:
      - flightNo
      - fare @sortable
    pagination:
      size: 10
      style: numbered
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for grouped read-model table consumers', () => {
    const source = `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    from: string @required
  result:
    flightNo: string
    departureTime: string
    fareBrand: string
    quotedFare: number
  list:
    groupBy: [flightNo, departureTime]
    columns:
      - flightNo
      - departureTime
      - fareBrand
      - quotedFare @sortable
    pagination:
      size: 5
      style: numbered
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for pivoted read-model table consumers', () => {
    const source = `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    from: string @required
  result:
    flightNo: string
    departureTime: string
    fareBrand: string
    quotedFare: number
    seatsRemaining: integer
  list:
    groupBy: [flightNo, departureTime]
    pivotBy: fareBrand
    columns:
      - flightNo
      - departureTime
      - fareBrand
      - quotedFare
      - seatsRemaining
    pagination:
      size: 5
      style: numbered
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for read-model table rowActions that hand off into generated create views', () => {
    const source = `
page availability:
  title: "Flight Availability"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list
      rowActions:
        - create:
            resource: bookings
            label: "Start booking"
            seed:
              travelDate:
                input: travelDate
              routeCode:
                row: flightNo
              cabin:
                row: cabin
              baseFare:
                row: baseFare
              quotedFare:
                row: quotedFare

readModel flightAvailability:
  api: /api/flights/search
  inputs:
    travelDate: string @required
  result:
    flightNo: string
    cabin: enum(ECONOMY, BUSINESS)
    baseFare: number
    quotedFare: number
  list:
    columns:
      - flightNo
      - quotedFare

model Booking:
  travelDate: string
  routeCode: string
  cabin: enum(ECONOMY, BUSINESS)
  baseFare: number
  quotedFare: number

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - travelDate
      - routeCode
      - cabin @select
      - baseFare
      - quotedFare
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for shared read-model queryState and dateNavigation table consumers', () => {
    const source = `
page availability:
  title: "Flight Availability"
  blocks:
    - type: metric
      title: "Matching Outbound Flights"
      data: readModel.outwardFlightAvailability.count
      queryState: availabilitySearch
    - type: table
      title: "Outbound Flights"
      data: readModel.outwardFlightAvailability.list
      queryState: availabilitySearch
      dateNavigation:
        field: outwardDate
    - type: table
      title: "Homeward Flights"
      data: readModel.homewardFlightAvailability.list
      queryState: availabilitySearch
      dateNavigation:
        field: homewardDate

readModel outwardFlightAvailability:
  api: /api/outward-flights
  inputs:
    departureCode: string @required
    arrivalCode: string @required
    outwardDate: string @required
    homewardDate: string @required
  result:
    flightNo: string
    departureTime: string
    fareBrand: string
    quotedFare: number
  list:
    groupBy: [flightNo, departureTime]
    pivotBy: fareBrand
    columns:
      - flightNo
      - departureTime
      - fareBrand
      - quotedFare

readModel homewardFlightAvailability:
  api: /api/homeward-flights
  inputs:
    departureCode: string @required
    arrivalCode: string @required
    outwardDate: string @required
    homewardDate: string @required
  result:
    flightNo: string
    departureTime: string
    fareBrand: string
    quotedFare: number
  list:
    groupBy: [flightNo, departureTime]
    pivotBy: fareBrand
    columns:
      - flightNo
      - departureTime
      - fareBrand
      - quotedFare
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for descriptor-shaped frontend UI copy across page, view, and navigation titles/labels', () => {
    const source = `
app:
  name: "Flights"
  navigation:
    - group:
        key: nav.booking
        defaultMessage: "Booking"
      items:
        - label:
            key: nav.availability
            defaultMessage: "Availability"
          target: availability

page availability:
  title:
    key: flights.availability
    defaultMessage: "Flight Availability"
  actions:
    - create:
        resource: bookings
        label:
          key: flights.bookSelected
          defaultMessage: "Book selected itinerary"
  blocks:
    - type: table
      title:
        key: flights.outbound
        defaultMessage: "Outbound Flights"
      data: readModel.flightAvailability.list
      dateNavigation:
        field: travelDate
        prevLabel:
          key: flights.prev
          defaultMessage: "Previous day"
        nextLabel:
          key: flights.next
          defaultMessage: "Next day"

readModel flightAvailability:
  api: /api/flights
  inputs:
    travelDate: string @required
  result:
    flightNo: string
  list:
    columns:
      - flightNo

model Booking:
  flightNo: string

resource bookings:
  model: Booking
  api: /api/bookings
  list:
    title:
      key: bookings.list
      defaultMessage: "Bookings"
    columns:
      - flightNo
  read:
    title:
      key: bookings.read
      defaultMessage: "Booking Details"
    fields:
      - flightNo
  create:
    fields:
      - flightNo
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);
    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for app/page SEO metadata, asset refs, and linked style authoring on page and resource surfaces', () => {
    const files = {
      'frontend/app.web.loj': `
app:
  name: "Flight Booking Proof"
  style: '@style("./styles/theme")'
  seo:
    siteName: "Flight Booking Proof"
    defaultTitle: "Flight Booking Proof"
    titleTemplate: "{title} · Flight Booking Proof"
    defaultDescription: "Default proof description"
    defaultImage: '@asset("./assets/default-og.svg")'
    favicon: '@asset("./assets/favicon.svg")'

model Booking:
  reference: string
  status: enum(draft, ready)

resource bookings:
  model: Booking
  api: /api/bookings
  workflow:
    source: '@flow("./workflows/booking-lifecycle")'
    style: workflowShell
  list:
    title: "Bookings"
    style: listShell
    columns:
      - reference
  read:
    title: "Booking Detail"
    style: detailShell
    fields:
      - reference
      - status
  create:
    style: formShell
    fields:
      - reference
  edit:
    style: formShell
    fields:
      - reference

page availability:
  title: "Flight Availability"
  style: pageShell
  seo:
    description: "Search and compare outbound and homeward flights."
    canonicalPath: /availability
    image: '@asset("./assets/availability-og.svg")'
  blocks:
    - type: metric
      title: "Matching Flights"
      style: metricCard
`,
      'frontend/styles/theme.style.loj': `
tokens:
  colors:
    surface: "#ffffff"
  spacing:
    md: 16
  borderRadius:
    lg: 24
  elevation:
    card: 2
  typography:
    body:
      fontSize: 16
      fontWeight: 400
      lineHeight: 24

style pageShell:
  display: column
  gap: md
  padding: md
  backgroundColor: surface

style metricCard:
  display: column
  padding: md
  borderRadius: lg
  elevation: card

style listShell:
  extends: metricCard

style detailShell:
  extends: metricCard

style formShell:
  extends: metricCard

style workflowShell:
  extends: metricCard
`,
      'frontend/workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    draft:
      label: "Draft"
    ready:
      label: "Ready"
  wizard:
    steps:
      - name: draft_step
        completesWith: draft
      - name: ready_step
        completesWith: ready
  transitions:
    advance:
      from: draft
      to: ready
`,
      'frontend/assets/default-og.svg': '<svg></svg>',
      'frontend/assets/favicon.svg': '<svg></svg>',
      'frontend/assets/availability-og.svg': '<svg></svg>',
    };
    const result = compileProject({
      entryFile: 'frontend/app.web.loj',
      projectRoot: '.',
      readFile: (fileName: string) => files[fileName as keyof typeof files] ?? null,
    });
    expect(result.success).toBe(true);
    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for shared read-model queryState consumers with per-read-model derivations', () => {
    const files = {
      'app.web.loj': `
page availability:
  title: "Flight Availability"
  blocks:
    - type: table
      title: "Outbound Flights"
      data: readModel.outwardFlightAvailability.list
      queryState: availabilitySearch
    - type: table
      title: "Homeward Flights"
      data: readModel.homewardFlightAvailability.list
      queryState: availabilitySearch

readModel outwardFlightAvailability:
  api: /api/outward-flights
  rules: '@rules("./rules/outward-flights")'
  inputs:
    departureCode: string @required
    outwardDate: string @required
  result:
    flightNo: string
    baseFare: number
    quotedFare: number
  list:
    columns:
      - flightNo
      - quotedFare

readModel homewardFlightAvailability:
  api: /api/homeward-flights
  rules: '@rules("./rules/homeward-flights")'
  inputs:
    departureCode: string @required
    outwardDate: string @required
  result:
    flightNo: string
    baseFare: number
    quotedFare: number
  list:
    columns:
      - flightNo
      - quotedFare
`,
      'rules/outward-flights.rules.loj': `
rules outwardFlights:
  derive quotedFare:
    value: item.baseFare + 10
`,
      'rules/homeward-flights.rules.loj': `
rules homewardFlights:
  derive quotedFare:
    value: item.baseFare + 20
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: (fileName: string) => files[fileName as keyof typeof files] ?? null,
    });
    expect(result.success).toBe(true);

    const pageFile = result.files.find((file) => file.path === 'pages/AvailabilityPage.tsx');
    expect(pageFile?.content).toContain(`const pageAvailabilityBlock0DerivationRules = [`);
    expect(pageFile?.content).toContain(`const pageAvailabilityBlock1DerivationRules = [`);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for page-level create handoff from shared read-model selectionState consumers', () => {
    const source = `
page availability:
  title: "Flight Availability"
  actions:
    - create:
        resource: bookings
        label: "Book selected itinerary"
        seed:
          travelDate:
            input: availabilitySearch.outwardDate
          outwardFlightNo:
            selection: outwardFlight.flightNo
          homewardFlightNo:
            selection: homewardFlight.flightNo
  blocks:
    - type: table
      title: "Outbound Flights"
      data: readModel.outwardFlightAvailability.list
      queryState: availabilitySearch
      selectionState: outwardFlight
    - type: table
      title: "Homeward Flights"
      data: readModel.homewardFlightAvailability.list
      queryState: availabilitySearch
      selectionState: homewardFlight

readModel outwardFlightAvailability:
  api: /api/outward-flights
  inputs:
    departureCode: string @required
    outwardDate: string @required
    homewardDate: string @required
  result:
    id: string
    flightNo: string
  list:
    columns:
      - flightNo

readModel homewardFlightAvailability:
  api: /api/homeward-flights
  inputs:
    departureCode: string @required
    outwardDate: string @required
    homewardDate: string @required
  result:
    id: string
    flightNo: string
  list:
    columns:
      - flightNo

model Booking:
  travelDate: string
  outwardFlightNo: string
  homewardFlightNo: string

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - travelDate
      - outwardFlightNo
      - homewardFlightNo
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for page table blocks backed by read-model rules consumption', () => {
    const files = {
      'app.web.loj': `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: table
      title: "Available Flights"
      data: readModel.flightAvailability.list

readModel flightAvailability:
  api: /api/flights/search
  rules: '@rules("./rules/flight-availability")'
  inputs:
    from: string @required
    cabin: enum(economy, business)
  result:
    flightNo: string
    fare: number
    quotedFare: number
  list:
    columns:
      - flightNo
      - quotedFare @sortable
`,
      'rules/flight-availability.rules.loj': `
rules flightAvailability:
  eligibility business-only:
    when: input.cabin != BUSINESS || currentUser.role == "agent"
    message:
      defaultMessage: "Only agents may search business fares"
  validate origin-open:
    when: input.from != "BLOCKED"
    message: "Blocked route"
  derive quotedFare:
    value: item.fare + 20
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile(fileName) {
        const normalized = fileName.replace(/\\/g, '/');
        const source = files[normalized as keyof typeof files];
        if (source === undefined) {
          throw new Error(`ENOENT: ${normalized}`);
        }
        return source;
      },
    });
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for frontend create and edit views linked to grouped rules', () => {
    const files = {
      'app.web.loj': `
model Booking:
  status: enum(DRAFT, CONFIRMED)
  baseFare: number
  travelerCount: number
  quotedFare: number

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - baseFare
      - travelerCount
      - quotedFare
    rules: '@rules("./rules/booking-create")'
  edit:
    fields:
      - status
      - baseFare
      - travelerCount
      - quotedFare
    rules: '@rules("./rules/booking-edit")'
`,
      'rules/booking-create.rules.loj': `
rules bookingCreate:
  eligibility agent-only:
    when: currentUser.role == "agent"
    message: "Only agents may create bookings"
  validate traveler-count:
    when: formData.travelerCount > 0
    message: "Traveler count must be positive"
  derive quotedFare:
    value: formData.baseFare + 20
`,
      'rules/booking-edit.rules.loj': `
rules bookingEdit:
  eligibility editable:
    when: record.status != CONFIRMED
    message: "Confirmed bookings cannot be edited"
  validate traveler-count:
    when: formData.travelerCount > 0
    message: "Traveler count must be positive"
  derive quotedFare:
    value: formData.baseFare + 10
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile(fileName) {
        const normalized = fileName.replace(/\\/g, '/');
        const source = files[normalized as keyof typeof files];
        if (source === undefined) {
          throw new Error(`ENOENT: ${normalized}`);
        }
        return source;
      },
    });
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for repeated-child include forms linked to grouped rules', () => {
    const files = {
      'app.web.loj': `
model Booking:
  reference: string @required
  status: enum(DRAFT, CONFIRMED)
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  ageGroup: enum(adult, infant)
  seatPreference: string
  booking: belongsTo(Booking) @required

resource passengers:
  model: Passenger
  api: /api/passengers

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - reference
    includes:
      - field: passengers
        minItems: 1
        fields:
          - name
          - ageGroup
          - seatPreference
        rules: '@rules("./rules/passenger-create")'
  edit:
    fields:
      - reference
      - status
    includes:
      - field: passengers
        fields:
          - name
          - ageGroup
          - seatPreference
        rules: '@rules("./rules/passenger-edit")'
`,
      'rules/passenger-create.rules.loj': `
rules passengerCreate:
  eligibility passenger-seat:
    when: item.ageGroup != "infant"
    message: "Infants need manual seat assignment"
  validate passenger-name:
    when: item.name != ""
    message: "Passenger name is required"
  derive seatPreference:
    value: '"auto"'
`,
      'rules/passenger-edit.rules.loj': `
rules passengerEdit:
  eligibility editable:
    when: record.status != CONFIRMED
    message: "Confirmed bookings cannot change passengers"
  validate passenger-name:
    when: item.name != ""
    message: "Passenger name is required"
  derive seatPreference:
    value: '"edited"'
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile(fileName) {
        const normalized = fileName.replace(/\\/g, '/');
        const source = files[normalized as keyof typeof files];
        if (source === undefined) {
          throw new Error(`ENOENT: ${normalized}`);
        }
        return source;
      },
    });
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for record-scoped relation page table blocks', () => {
    const relationSource = `
page teamOverview:
  title: "Team Overview"
  path: /teams/:id/overview
  blocks:
    - type: table
      title: "Members"
      data: teams.members

model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
  list:
    filters:
      - name
      - team.name
    columns:
      - name
      - team.name @sortable
    actions:
      - create
      - view
      - delete @confirm("Remove user?")
    pagination:
      size: 10
      style: numbered
  create:
    fields:
      - name
      - team
  read:
    fields:
      - name
      - team.name
`;
    const result = compile(relationSource, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for record-scoped relation page table block label-list fallbacks', () => {
    const relationSource = `
page teamMembers:
  title: "Team Members"
  path: /teams/:id/members
  blocks:
    - type: table
      title: "Members"
      data: teams.members

model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
  read:
    fields:
      - name
`;
    const result = compile(relationSource, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for record-scoped relation page metric count blocks', () => {
    const relationSource = `
page teamMetrics:
  title: "Team Metrics"
  path: /teams/:id/metrics
  blocks:
    - type: metric
      title: "Member Count"
      data: teams.members.count

model Team:
  name: string @required
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
`;
    const result = compile(relationSource, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for record-scoped relation page custom blocks with route context props', () => {
    const files = {
      'app.web.loj': `
page teamOverview:
  title: "Team Overview"
  path: /teams/:id/overview
  blocks:
    - type: metric
      title: "Member Count"
      data: teams.members.count
    - type: table
      title: "Members"
      data: teams.members
    - type: custom
      title: "Summary"
      custom: "./components/TeamSummary.tsx"

model Team:
  name: string @required
  status: enum(DRAFT, ACTIVE)
  members: hasMany(User, by: team)

model User:
  name: string @required
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
  workflow: '@flow("./workflows/team-lifecycle")'
  read:
    fields:
      - name

resource users:
  model: User
  api: /api/users
  list:
    columns:
      - name
    actions:
      - create
      - view
      - edit
  read:
    fields:
      - name
  edit:
    fields:
      - name
      - team @select
  create:
    fields:
      - name
      - team @select
`,
      'workflows/team-lifecycle.flow.loj': `
workflow team-lifecycle:
  model: Team
  field: status
  states:
    DRAFT:
      label: "Draft"
    ACTIVE:
      label: "Active"
  wizard:
    steps:
      - name: setup_team
        completesWith: DRAFT
      - name: activate_team
        completesWith: ACTIVE
  transitions:
    activate:
      from: DRAFT
      to: ACTIVE
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: (fileName: string) => {
        const normalized = fileName.replace(/\\/g, '/');
        const source = files[normalized];
        if (source === undefined) {
          throw new Error(`ENOENT: ${normalized}`);
        }
        return source;
      },
    });
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for page metric blocks backed by read-model count surfaces', () => {
    const files = {
      'app.web.loj': `
page dashboard:
  title: "Flight Search"
  blocks:
    - type: metric
      title: "Matching Flights"
      data: readModel.flightAvailability.count

readModel flightAvailability:
  api: /api/flights/search
  rules: '@rules("./rules/flight-availability")'
  inputs:
    from: string @required
    cabin: enum(economy, business)
  result:
    flightNo: string
    fare: number
`,
      'rules/flight-availability.rules.loj': `
rules flightAvailability:
  eligibility business-only:
    when: input.cabin != BUSINESS || currentUser.role == "agent"
    message:
      defaultMessage: "Only agents may search business fares"
  validate origin-open:
    when: input.from != "BLOCKED"
    message: "Blocked route"
`,
    };
    const result = compileProject({
      entryFile: 'app.web.loj',
      readFile: (fileName: string) => {
        const normalized = fileName.replace(/\\/g, '/');
        const source = files[normalized as keyof typeof files];
        if (source === undefined) {
          throw new Error(`ENOENT: ${normalized}`);
        }
        return source;
      },
    });
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for create.includes aggregate-root nested create forms', () => {
    const source = `
model Booking:
  reference: string @required
  agentNote: string
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  ageGroup: enum(adult, infant)
  seat: enum(window, aisle)
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    fields:
      - reference
      - field: agentNote
        rules:
          visibleIf: currentUser.role == "admin"
    includes:
      - field: passengers
        minItems: 1
        fields:
          - name
          - ageGroup
          - field: seat
            rules:
              enabledIf: item.ageGroup != "infant"
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for edit.includes aggregate-root nested update forms', () => {
    const source = `
model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  seat: enum(window, aisle)
  booking: belongsTo(Booking) @required

resource passengers:
  model: Passenger
  api: /api/passengers

resource bookings:
  model: Booking
  api: /api/bookings
  edit:
    fields:
      - reference
    includes:
      - field: passengers
        fields:
          - name
          - seat
`;
    const result = compile(source, 'app.web.loj');
    expect(result.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(result.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('typechecks generated output for workflow-linked create/edit/read surfaces', () => {
    const files = {
      'app.web.loj': `
model Booking:
  reference: string @required
  status: enum(DRAFT, READY, TICKETED)

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
  list:
    columns:
      - reference
    actions:
      - view
      - edit
  create:
    fields:
      - reference
  edit:
    fields:
      - reference
  read:
    fields:
      - reference
      - status
`,
      'workflows/booking-lifecycle.flow.loj': `
workflow booking-lifecycle:
  model: Booking
  field: status
  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"
    TICKETED:
      label: "Ticketed"
  wizard:
    steps:
      - name: enter_booking
        completesWith: DRAFT
      - name: confirm_booking
        completesWith: READY
        allow: currentUser.role == "admin"
  transitions:
    confirm:
      from: DRAFT
      to: READY
      allow: currentUser.role == "admin"
    ticket:
      from: READY
      to: TICKETED
`,
    };
    const result = compile(files['app.web.loj'], 'app.web.loj');
    expect(result.success).toBe(false);
    const projectResult = compileProject({
      entryFile: 'app.web.loj',
      readFile: (fileName: string) => {
        const normalized = fileName.replace(/\\/g, '/');
        const source = files[normalized];
        if (source === undefined) {
          throw new Error(`ENOENT: ${normalized}`);
        }
        return source;
      },
    });
    expect(projectResult.success).toBe(true);

    const diagnostics = typecheckGeneratedFiles(projectResult.files);
    expect(diagnostics, formatDiagnostics(diagnostics)).toHaveLength(0);
  });

  it('emits a routable app shell and correct redirect targets', () => {
    const result = compile(source);
    expect(result.success).toBe(true);

    const appFile = result.files.find((file) => file.path === 'App.tsx');
    const generatedNotice = result.files.find((file) => file.path === 'GENERATED.md');
    const routerFile = result.files.find((file) => file.path === 'router.tsx');
    const layoutFile = result.files.find((file) => file.path === 'layout/AdminLayout.tsx');
    const createFile = result.files.find((file) => file.path === 'views/UsersCreate.tsx');
    const pageFile = result.files.find((file) => file.path === 'pages/DashboardPage.tsx');

    expect(appFile?.content).toContain('Prefer editing source .web.loj/.style.loj files or documented escape hatches instead of this generated file.');
    expect(generatedNotice?.content).toContain('This directory is generated by Loj.');
    expect(appFile?.content).toContain('matchRoute');
    expect(appFile?.content).toContain('const defaultRoutePath = React.useMemo(() => {');
    expect(appFile?.content).toContain(`window.history.replaceState(window.history.state, '', prefixAppBasePath(defaultRoutePath));`);
    expect(appFile?.content).toContain('ResolvedRoute');
    expect(routerFile?.content).toContain("import React from 'react';");
    expect(routerFile?.content).toContain("default: m.UsersList");
    expect(layoutFile?.content).toContain('visibleNavigation');
    expect(layoutFile?.content).toContain('href: prefixAppBasePath("/dashboard")');
    expect(layoutFile?.content).toContain('href: prefixAppBasePath("/users")');
    expect(createFile?.content).toContain(`window.location.href = prefixAppBasePath("/users");`);
    expect(createFile?.content).not.toContain('/users/list');
    expect(pageFile?.content).toContain('{/* @source-node');
  });

  it('wires edit permissions into runtime behavior instead of comments only', () => {
    const result = compile(source);
    expect(result.success).toBe(true);

    const editFile = result.files.find((file) => file.path === 'views/UsersEdit.tsx');
    expect(editFile).toBeDefined();
    expect(editFile?.content).toContain('const isVisible =');
    expect(editFile?.content).toContain('const isEnabled =');
    expect(editFile?.content).toContain('const canSubmit =');
    expect(editFile?.content).toContain('if (!isEnabled || !canSubmit || !passesEnforcement)');
    expect(editFile?.content).toContain('disabled={loading || !isEnabled || !canSubmit || !passesEnforcement || Boolean(linkedEligibilityFailure) || Boolean(linkedValidationFailure) || Boolean(linkedIncludeFailure)}');
  });

  it('humanizes camelCase fallback labels across generated list, read, and create surfaces', () => {
    const result = compile(`
model Member:
  membershipNumber: string
  preferredAirport: string

resource members:
  model: Member
  api: /api/members
  list:
    columns:
      - membershipNumber
  read:
    fields:
      - membershipNumber
      - preferredAirport
  create:
    fields:
      - membershipNumber
      - preferredAirport
`);
    expect(result.success).toBe(true);

    const listFile = result.files.find((file) => file.path === 'views/MembersList.tsx');
    const readFile = result.files.find((file) => file.path === 'views/MembersRead.tsx');
    const createFile = result.files.find((file) => file.path === 'views/MembersCreate.tsx');

    expect(listFile?.content).toContain("label: 'Membership Number'");
    expect(readFile?.content).toContain('<dt>Membership Number</dt>');
    expect(readFile?.content).toContain('<dt>Preferred Airport</dt>');
    expect(createFile?.content).toContain('label="Membership Number"');
    expect(createFile?.content).toContain('label="Preferred Airport"');
  });

  it('emits structured semantic and trace manifests', () => {
    const result = compile(source, 'subprojects/rdsl/examples/user-admin/app.rdsl');
    expect(result.success).toBe(true);
    expect(result.semanticManifest?.entryFile).toBe('subprojects/rdsl/examples/user-admin/app.rdsl');
    expect(result.semanticManifest?.sourceFiles).toEqual(['subprojects/rdsl/examples/user-admin/app.rdsl']);
    expect(result.traceManifest?.entryFile).toBe('subprojects/rdsl/examples/user-admin/app.rdsl');
    expect(result.traceManifest?.sourceFiles.map((file) => file.path)).toEqual(['subprojects/rdsl/examples/user-admin/app.rdsl']);
    expect(result.traceManifest?.generatedFiles.some((file) => file.path === 'views/UsersList.tsx')).toBe(true);
    expect(result.traceManifest?.regions.some((region) => region.generatedFile === 'views/UsersList.tsx' && region.role === 'file.root')).toBe(true);
  });
});
