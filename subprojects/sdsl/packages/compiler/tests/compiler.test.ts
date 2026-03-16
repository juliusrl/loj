import { describe, expect, it } from 'vitest';
import { compile, compileProject, normalize, parse, parseDecorators } from '../src/index.js';

function createVfs(files: Record<string, string>) {
  return (fileName: string) => {
    const normalized = fileName.replace(/\\/g, '/');
    const source = files[normalized];
    if (source === undefined) {
      throw new Error(`ENOENT: ${normalized}`);
    }
    return source;
  };
}

function createDirectoryAwareVfs(files: Record<string, string>) {
  return {
    readFile: createVfs(files),
    listFiles(directory: string) {
      const normalizedDirectory = directory.replace(/\\/g, '/').replace(/\/+$/, '');
      return Object.keys(files)
        .map((fileName) => fileName.replace(/\\/g, '/'))
        .filter((fileName) => fileName.startsWith(`${normalizedDirectory}/`))
        .sort((left, right) => left.localeCompare(right));
    },
  };
}

describe('parseDecorators', () => {
  it('splits type expressions from decorators', () => {
    const parsed = parseDecorators('string @required @minLen(2)');
    expect(parsed.baseName).toBe('string');
    expect(parsed.decorators.map((decorator) => decorator.name)).toEqual(['required', 'minLen']);
    expect(parsed.decorators[1].args).toBe('2');
  });
});

describe('parse', () => {
  it('parses a minimal sdsl app', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.users"

model User:
  name: string @required

resource users:
  model: User
  api: /api/users
`;
    const result = parse(source, 'app.sdsl');
    expect(result.errors).toHaveLength(0);
    expect(result.ast.app?.name).toBe('User Service');
    expect(result.ast.app?.packageName).toBe('com.example.users');
    expect(result.ast.models[0].fields[0].typeExpr).toBe('string');
    expect(result.ast.resources[0].api).toBe('/api/users');
  });

  it('parses hasMany relation type expressions with inline by metadata', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.users"

model Team:
  members: hasMany(User, by: team)

model User:
  team: belongsTo(Team)

resource teams:
  model: Team
  api: /api/teams
`;
    const result = parse(source, 'app.sdsl');
    expect(result.errors).toHaveLength(0);
    expect(result.ast.models[0].fields[0].typeExpr).toBe('hasMany(User, by: team)');
  });

  it('parses named readModel blocks with inputs, result, and handler', () => {
    const source = `
app:
  name: "Flight Service"
  package: "com.example.flights"

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    departureAirport: string @required
    departureDate: date @required
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@fn("./read-models/flightAvailability")'
`;
    const result = parse(source, 'app.api.loj');
    expect(result.errors).toHaveLength(0);
    expect(result.ast.readModels).toHaveLength(1);
    expect(result.ast.readModels[0].inputs.map((field) => field.name)).toEqual(['departureAirport', 'departureDate']);
    expect(result.ast.readModels[0].result.map((field) => field.name)).toEqual(['flightNumber', 'quotedPrice']);
    expect(result.ast.readModels[0].handler).toBe('@fn("./read-models/flightAvailability")');
  });

  it('rejects yaml aliases', () => {
    const source = `
app: &app
  name: "User Service"
  package: "com.example.users"

model User:
  name: string

resource users:
  model: User
  api: /api/users

imports:
  - *app
`;
    const result = parse(source, 'app.sdsl');
    expect(result.errors.some((error) => error.message.includes('aliases'))).toBe(true);
  });
});

describe('normalize', () => {
  it('applies compiler defaults and resource defaults', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.users"

model User:
  email: string @required @email

resource users:
  model: User
  api: /api/users
`;
    const parsed = parse(source, 'app.sdsl');
    expect(parsed.errors).toHaveLength(0);
    const normalized = normalize(parsed.ast, { entryFile: 'app.sdsl' });
    expect(normalized.errors).toHaveLength(0);
    expect(normalized.ir?.compiler.target).toBe('spring-boot');
    expect(normalized.ir?.compiler.language).toBe('java');
    expect(normalized.ir?.resources[0].auth.mode).toBe('authenticated');
    expect(normalized.ir?.resources[0].operations.delete).toBe(true);
  });

  it('recognizes the implemented fastapi backend target triple', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.users"

compiler:
  target: fastapi

model User:
  email: string @required @email

resource users:
  model: User
  api: /api/users
`;
    const parsed = parse(source, 'app.sdsl');
    expect(parsed.errors).toHaveLength(0);
    const normalized = normalize(parsed.ast, { entryFile: 'app.sdsl' });
    expect(normalized.errors).toHaveLength(0);
    expect(normalized.ir?.compiler.target).toBe('fastapi');
    expect(normalized.ir?.compiler.language).toBe('python');
    expect(normalized.ir?.compiler.profile).toBe('rest-sqlalchemy-auth');
  });

  it('rejects unsupported backend target combinations with known triple guidance', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.users"

compiler:
  target: spring-boot
  language: python

model User:
  email: string @required @email

resource users:
  model: User
  api: /api/users
`;
    const parsed = parse(source, 'app.sdsl');
    expect(parsed.errors).toHaveLength(0);
    const normalized = normalize(parsed.ast, { entryFile: 'app.sdsl' });
    expect(normalized.ir).toBeUndefined();
    expect(normalized.errors.map((error) => error.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('Unsupported compiler combination'),
        expect.stringContaining('spring-boot/python/mvc-jpa-security'),
        expect.stringContaining('spring-boot/java/mvc-jpa-security'),
        expect.stringContaining('fastapi/python/rest-sqlalchemy-auth'),
      ]),
    );
  });

  it('rejects invalid create-time constraints', () => {
    const source = `
app:
  name: "Broken Service"
  package: "not a package"

model User:
  createdAt: string @createdAt

resource users:
  model: Missing
  api: api/users
  auth:
    mode: public
    roles: [ADMIN]
`;
    const parsed = parse(source, 'app.sdsl');
    const normalized = normalize(parsed.ast, { entryFile: 'app.sdsl' });
    expect(normalized.errors.map((error) => error.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('valid dotted Java package'),
        expect.stringContaining('@createdAt only applies to datetime fields'),
        expect.stringContaining('references unknown model "Missing"'),
      ]),
    );
  });

  it('normalizes narrow named readModels and rejects unsupported readModel auth.policy', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Flight Service"
  package: "com.example.flights"

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: authenticated
    roles: [AGENT]
  inputs:
    departureAirport: string @required
    departureDate: date @required
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@fn("./read-models/flightAvailability")'
`,
      'read-models/flightAvailability.java': `
return List.of();
`,
    };
    const parsed = parse(files['app.api.loj'], 'app.api.loj');
    expect(parsed.errors).toHaveLength(0);
    const normalized = normalize(parsed.ast, {
      entryFile: 'app.api.loj',
      projectRoot: '.',
      readFile: createVfs(files),
    });
    expect(normalized.errors).toHaveLength(0);
    expect(normalized.ir?.readModels).toHaveLength(1);
    expect(normalized.ir?.readModels[0].handler.logicalPath).toBe('./read-models/flightAvailability');
    expect(normalized.ir?.readModels[0].handler.resolvedPath).toBe('read-models/flightAvailability.java');
    expect(normalized.ir?.readModels[0].auth.roles).toEqual(['AGENT']);

    const invalidSource = `
app:
  name: "Flight Service"
  package: "com.example.flights"

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    policy: '@fn("./policies/canSearch")'
  result:
    flightNumber: string
  handler: '@fn("./read-models/flightAvailability")'
`;
    const invalidParsed = parse(invalidSource, 'app.api.loj');
    const invalidNormalized = normalize(invalidParsed.ast, {
      entryFile: 'app.api.loj',
      projectRoot: '.',
      readFile: createVfs({
        'app.api.loj': invalidSource,
        'read-models/flightAvailability.java': 'return List.of();',
        'policies/canSearch.java': 'return true;',
      }),
    });
    expect(invalidNormalized.errors.map((error) => error.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('readModel auth.policy is not supported yet'),
      ]),
    );
  });

  it('normalizes readModel sql handlers and rejects procedure-style sql escapes', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Flight Service"
  package: "com.example.flights"

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    departureDate: date @required
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@sql("./queries/flightAvailability")'
`,
      'queries/flightAvailability.sql': `
select flight_number as flightNumber, quoted_price as quotedPrice
from flights
where departure_date = :departureDate
`,
    };
    const parsed = parse(files['app.api.loj'], 'app.api.loj');
    const normalized = normalize(parsed.ast, {
      entryFile: 'app.api.loj',
      projectRoot: '.',
      readFile: createVfs(files),
    });
    expect(normalized.errors).toHaveLength(0);
    expect(normalized.ir?.readModels[0].handler.source).toBe('sql');
    expect(normalized.ir?.readModels[0].handler.logicalPath).toBe('./queries/flightAvailability');
    expect(normalized.ir?.readModels[0].handler.resolvedPath).toBe('queries/flightAvailability.sql');

    const invalidParsed = parse(files['app.api.loj'], 'app.api.loj');
    const invalidNormalized = normalize(invalidParsed.ast, {
      entryFile: 'app.api.loj',
      projectRoot: '.',
      readFile: createVfs({
        ...files,
        'queries/flightAvailability.sql': 'call refresh_flight_cache(:departureDate)',
      }),
    });
    expect(invalidNormalized.errors.map((error) => error.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('currently supports only SELECT/WITH queries'),
      ]),
    );
  });
});

describe('compile', () => {
  it('compiles a single-file app into IR', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.users"

compiler:
  target: spring-boot

model User:
  role: enum(ADMIN, SUPPORT, VIEWER)

resource users:
  model: User
  api: /api/users
  operations:
    delete: false
`;
    const result = compile(source, 'app.sdsl');
    expect(result.success).toBe(true);
    expect(result.files.some((file) => file.path === 'pom.xml')).toBe(true);
    expect(result.ir?.models[0].fields[0].fieldType).toEqual({
      type: 'enum',
      values: ['ADMIN', 'SUPPORT', 'VIEWER'],
    });
    expect(result.ir?.resources[0].operations.delete).toBe(false);
  });

  it('compiles a fastapi backend target from the same backend-family source shape', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.users"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

model User:
  email: string @required @email

resource users:
  model: User
  api: /api/users
`;
    const result = compile(source, 'app.sdsl');
    expect(result.success).toBe(true);
    expect(result.ir?.compiler.target).toBe('fastapi');
    expect(result.files.some((file) => file.path === 'pyproject.toml')).toBe(true);
    expect(result.files.some((file) => file.path === 'app/main.py')).toBe(true);
    expect(result.files.some((file) => file.path === 'tests/test_users_api.py')).toBe(true);
  });

  it('compiles a spring named readModel surface without resources', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Flight Service"
  package: "com.example.flights"

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    departureAirport: string @required
    departureDate: date @required
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@fn("./read-models/flightAvailability")'
`,
      'read-models/flightAvailability.java': `
return List.of(
  new FlightAvailabilityReadModelResult("JL123", new BigDecimal("120.50"))
);
`,
    };
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: createVfs(files),
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['read-models/flightAvailability.java']);
    const handler = result.files.find((file) => file.path.endsWith('/readmodel/FlightAvailabilityReadModelHandler.java'));
    const controller = result.files.find((file) => file.path.endsWith('/controller/FlightAvailabilityReadModelController.java'));
    const inputDto = result.files.find((file) => file.path.endsWith('/dto/FlightAvailabilityReadModelInput.java'));
    const resultDto = result.files.find((file) => file.path.endsWith('/dto/FlightAvailabilityReadModelResult.java'));

    expect(handler?.content).toContain('EntityManager entityManager');
    expect(handler?.content).toContain('new FlightAvailabilityReadModelResult("JL123", new BigDecimal("120.50"))');
    expect(handler?.content).toContain('import java.math.BigDecimal;');
    expect(handler?.content).toContain('import java.time.LocalDate;');
    expect(handler?.content).not.toContain('\njava.math.BigDecimal\n');
    expect(handler?.content).not.toContain('\njava.time.LocalDate\n');
    expect(controller?.content).toContain('@RequestMapping("/api/flight-availability")');
    expect(controller?.content).toContain('@DateTimeFormat(iso = DateTimeFormat.ISO.DATE)');
    expect(controller?.content).toContain('import java.time.LocalDate;');
    expect(controller?.content).not.toContain('\njava.time.LocalDate\n');
    expect(controller?.content).toContain('PolicyPrincipal principal = PolicyPrincipal.fromAuthentication(authentication);');
    expect(controller?.content).toContain('return new ListEnvelope<>(handler.execute(input, principal));');
    expect(inputDto?.content).toContain('import java.time.LocalDate;');
    expect(inputDto?.content).toContain('String departureAirport');
    expect(resultDto?.content).toContain('import java.math.BigDecimal;');
    expect(resultDto?.content).toContain('BigDecimal quotedPrice');
  });

  it('compiles a fastapi named readModel surface without resources', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Flight Service"
  package: "com.example.flights"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: authenticated
    roles: [AGENT]
  inputs:
    departureAirport: string @required
    returnDate: date
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@fn("./read-models/flight_availability")'
`,
      'read-models/flight_availability.py': `
return [FlightAvailabilityReadModelResult(flightNumber="JL123", quotedPrice=Decimal("120.50"))]
`,
    };
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: createVfs(files),
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['read-models/flight_availability.py']);
    const route = result.files.find((file) => file.path === 'app/routes/flight_availability_read_model.py');
    const handler = result.files.find((file) => file.path === 'app/custom/read_models/flight_availability_read_model.py');
    const schema = result.files.find((file) => file.path === 'app/schemas/flight_availability_read_model.py');
    const main = result.files.find((file) => file.path === 'app/main.py');

    expect(route?.content).toContain('require_roles("AGENT")');
    expect(route?.content).toContain('returnDate: date | None = None');
    expect(route?.content).toContain('input = FlightAvailabilityReadModelInput(departureAirport=departureAirport, returnDate=returnDate)');
    expect(handler?.content).toContain('principal: AuthenticatedUser | None');
    expect(handler?.content).toContain('Decimal("120.50")');
    expect(schema?.content).toContain('quotedPrice: Decimal');
    expect(main?.content).toContain('from app.routes.flight_availability_read_model import router as flight_availability_read_model_router');
  });

  it('compiles a spring sql-backed readModel surface without resources', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Flight Service"
  package: "com.example.flights"

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    departureDate: date @required
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@sql("./queries/flightAvailability")'
`,
      'queries/flightAvailability.sql': `
select flight_number as flightNumber, quoted_price as quotedPrice
from flights
where departure_date = :departureDate
`,
    };
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: createVfs(files),
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['queries/flightAvailability.sql']);
    const handler = result.files.find((file) => file.path.endsWith('/readmodel/FlightAvailabilityReadModelHandler.java'));
    expect(handler?.content).toContain('NamedParameterJdbcTemplate jdbcTemplate');
    expect(handler?.content).toContain('String sql = """');
    expect(handler?.content).toContain('where departure_date = :departureDate');
    expect(handler?.content).toContain('params.addValue("departureDate", input.departureDate());');
    expect(handler?.content).toContain('rs.getString("flightNumber")');
    expect(handler?.content).toContain('rs.getBigDecimal("quotedPrice")');
    expect(handler?.content).not.toContain('EntityManager entityManager');
  });

  it('compiles a fastapi sql-backed readModel surface without resources', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Flight Service"
  package: "com.example.flights"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    departureDate: date @required
  result:
    flightNumber: string
    quotedPrice: decimal
  handler: '@sql("./queries/flight_availability")'
`,
      'queries/flight_availability.sql': `
select flight_number as flightNumber, quoted_price as quotedPrice
from flights
where departure_date = :departureDate
`,
    };
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: createVfs(files),
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['queries/flight_availability.sql']);
    const handler = result.files.find((file) => file.path === 'app/custom/read_models/flight_availability_read_model.py');
    expect(handler?.content).toContain('from sqlalchemy import text');
    expect(handler?.content).toContain('statement = text("""');
    expect(handler?.content).toContain('where departure_date = :departureDate');
    expect(handler?.content).toContain('"departureDate": input.departureDate');
    expect(handler?.content).toContain('rows = db.execute(statement, params).mappings().all()');
    expect(handler?.content).toContain('flightNumber=row.get("flightNumber")');
    expect(handler?.content).toContain('quotedPrice=row.get("quotedPrice")');
  });

  it('links resource workflow into spring backend transition enforcement', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Booking Service"
  package: "com.example.bookings"

model Booking:
  reference: string @required
  status: enum(DRAFT, READY, TICKETED) @required

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
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
  transitions:
    confirm:
      from: DRAFT
      to: READY
      allow: currentUser.role == ADMIN
    ticket:
      from: READY
      to: TICKETED
      allow: currentUser.role in [ADMIN, OPS]
`,
    };
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: createVfs(files),
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['workflows/booking-lifecycle.flow.loj']);
    expect(result.ir?.resources[0].workflow?.resolvedPath).toBe('workflows/booking-lifecycle.flow.loj');

    const controller = result.files.find((file) => file.path.endsWith('/controller/BookingsController.java'));
    const service = result.files.find((file) => file.path.endsWith('/service/BookingService.java'));
    const workflowAdapter = result.files.find((file) => file.path.endsWith('/workflow/BookingsWorkflow.java'));

    expect(controller?.content).toContain('@PostMapping("/{id}/transitions/{transition}")');
    expect(controller?.content).toContain('BookingsWorkflow.TransitionDecision decision = workflow.decide(transition, principal, current);');
    expect(controller?.content).toContain('return new ItemEnvelope<>(service.transitionBookings(id, decision.targetState()));');
    expect(service?.content).toContain('public BookingResponse createBookingsWithWorkflow(BookingRequest request)');
    expect(service?.content).toContain('entity.setStatus(BookingStatus.DRAFT);');
    expect(service?.content).toContain('public BookingResponse updateBookingsWithWorkflow(Long id, BookingRequest request)');
    expect(service?.content).toContain('public BookingResponse transitionBookings(Long id, String targetState)');
    expect(workflowAdapter?.content).toContain('public static record TransitionDecision');
    expect(workflowAdapter?.content).toContain('private static final List<Map<String, Object>> TRANSITIONS = loadTransitions();');
  });

  it('links resource workflow into fastapi backend transition enforcement', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Booking Service"
  package: "com.example.bookings"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

model Booking:
  reference: string @required
  status: enum(DRAFT, READY, TICKETED) @required

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
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
  transitions:
    confirm:
      from: DRAFT
      to: READY
      allow: currentUser.role == ADMIN
    ticket:
      from: READY
      to: TICKETED
      allow: currentUser.role in [ADMIN, OPS]
`,
    };
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: createVfs(files),
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['workflows/booking-lifecycle.flow.loj']);

    const routeModule = result.files.find((file) => file.path === 'app/routes/bookings.py');
    const workflowModule = result.files.find((file) => file.path === 'app/custom/workflows/bookings_workflow.py');
    const serviceModule = result.files.find((file) => file.path === 'app/services/booking.py');

    expect(routeModule?.content).toContain('from app.custom.workflows.bookings_workflow import decide_transition as decide_bookings_transition');
    expect(routeModule?.content).toContain('@router.post("/{item_id}/transitions/{transition_name}", response_model=BookingResponse)');
    expect(routeModule?.content).toContain('return transition_bookings(db, item_id, target_state)');
    expect(serviceModule?.content).toContain('def create_bookings_with_workflow(db: Session, payload: BookingCreate) -> Booking:');
    expect(serviceModule?.content).toContain('entity.status = BookingStatus.DRAFT');
    expect(serviceModule?.content).toContain('def transition_bookings(db: Session, item_id: int, target_state: str) -> Booking:');
    expect(workflowModule?.content).toContain('def decide_transition(');
    expect(workflowModule?.content).toContain('TRANSITIONS = MANIFEST.get("transitions", [])');
  });

  it('rejects invalid resource workflow enum alignment', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Booking Service"
  package: "com.example.bookings"

model Booking:
  status: enum(DRAFT, READY, TICKETED) @required

resource bookings:
  model: Booking
  api: /api/bookings
  workflow: '@flow("./workflows/booking-lifecycle")'
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
  transitions:
    confirm:
      from: DRAFT
      to: READY
`,
    };
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: createVfs(files),
    });

    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'resource bookings workflow must declare enum state "TICKETED" from model Booking.status',
    ]));
  });

  it('compiles nested imports and directory imports', () => {
    const files = {
      'app.sdsl': `
app:
  name: "User Service"
  package: "com.example.users"

imports:
  - ./models/
  - ./resources/users.sdsl
`,
      'models/user.sdsl': `
imports:
  - ../shared/audit.sdsl

model User:
  name: string @required
  createdAt: datetime @createdAt
`,
      'shared/audit.sdsl': `
model AuditLog:
  event: string @required
`,
      'resources/users.sdsl': `
resource users:
  model: User
  api: /api/users
  auth:
    roles: [ADMIN]
`,
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.sdsl',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });
    expect(result.success).toBe(true);
    expect(result.files.some((file) => file.path.endsWith('UserService.java'))).toBe(true);
    expect(result.sourceFiles).toEqual(['app.sdsl', 'models/user.sdsl', 'shared/audit.sdsl', 'resources/users.sdsl']);
    expect(result.moduleGraph['app.sdsl']).toEqual(['models/user.sdsl', 'resources/users.sdsl']);
    expect(result.ir?.models.map((model) => model.name)).toEqual(['User', 'AuditLog']);
  });

  it('resolves backend auth.policy logical ids and generates spring policy adapters', () => {
    const files = {
      'app.api.loj': `
app:
  name: "User Service"
  package: "com.example.users"

imports:
  - ./models/
  - ./resources/
`,
      'models/user.api.loj': `
model User:
  name: string @required
`,
      'resources/users.api.loj': `
resource users:
  model: User
  api: /api/users
  auth:
    roles: [ADMIN]
    policy: '@fn("./policies/canManageUsers")'
`,
      'resources/policies/canManageUsers.java': `
return principal.hasRole("ADMIN") && !"delete".equals(operation);
`,
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['resources/policies/canManageUsers.java']);
    expect(result.ir?.resources[0].auth.policy).toEqual({
      kind: 'auth.policy',
      source: 'fn',
      logicalPath: './policies/canManageUsers',
      resolvedPath: 'resources/policies/canManageUsers.java',
      lockIn: 'neutral',
    });

    const policyPrincipal = result.files.find((file) => file.path.endsWith('/security/PolicyPrincipal.java'));
    const policyAdapter = result.files.find((file) => file.path.endsWith('/security/UsersPolicy.java'));
    const controller = result.files.find((file) => file.path.endsWith('/controller/UsersController.java'));

    expect(policyPrincipal?.content).toContain('record PolicyPrincipal');
    expect(policyPrincipal?.content).toContain('hasRole(String role)');
    expect(policyAdapter?.content).toContain('public class UsersPolicy');
    expect(policyAdapter?.content).toContain('return principal.hasRole("ADMIN")');
    expect(controller?.content).toContain('private final UsersPolicy policy;');
    expect(controller?.content).toContain('policy.allow(PolicyPrincipal.fromAuthentication(authentication), operation, params, payload)');
  });

  it('resolves backend auth.policy logical ids and generates fastapi policy modules', () => {
    const files = {
      'app.api.loj': `
app:
  name: "User Service"
  package: "com.example.users"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

imports:
  - ./models/
  - ./resources/
`,
      'models/user.api.loj': `
model User:
  name: string @required
`,
      'resources/users.api.loj': `
resource users:
  model: User
  api: /api/users
  auth:
    roles: [ADMIN]
    policy: '@fn("./policies/can_manage_users")'
`,
      'resources/policies/can_manage_users.py': `
return "ADMIN" in principal.roles and operation != "delete"
`,
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['resources/policies/can_manage_users.py']);
    const policyModule = result.files.find((file) => file.path === 'app/custom/policies/users_policy.py');
    const routeModule = result.files.find((file) => file.path === 'app/routes/users.py');

    expect(policyModule?.content).toContain('def allow(principal: AuthenticatedUser, operation: str');
    expect(policyModule?.content).toContain('return "ADMIN" in principal.roles');
    expect(routeModule?.content).toContain('from app.custom.policies.users_policy import allow as allow_users_policy');
    expect(routeModule?.content).toContain('_enforce_policy(principal, "create", {}, payload.model_dump())');
  });

  it('links @rules auth.policy into spring backend enforcement', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Invoice Service"
  package: "com.example.invoices"

imports:
  - ./models/
  - ./resources/
`,
      'models/invoice.api.loj': `
model Invoice:
  status: enum(DRAFT, COMPLETED) @required
  accountManagerId: string @required
`,
      'resources/invoices.api.loj': `
resource invoices:
  model: Invoice
  api: /api/invoices
  auth:
    roles: [ADMIN, SALES]
    policy: '@rules("./policies/invoice-access")'
`,
      'resources/policies/invoice-access.rules.loj': `
rules invoice-access:
  allow list:
    when: currentUser.role in [ADMIN, SALES]
    scopeWhen: currentUser.role == SALES
    scope: record.accountManagerId == currentUser.id

  allow get:
    when: currentUser.role in [ADMIN, SALES]

  allow update:
    when: currentUser.role == ADMIN
    or:
      - currentUser.id == record.accountManagerId

  deny delete:
    when: record.status == COMPLETED
    message:
      defaultMessage: "Completed invoices cannot be deleted."
`,
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['resources/policies/invoice-access.rules.loj']);
    expect(result.ir?.resources[0].auth.policy?.source).toBe('rules');
    expect(result.ir?.resources[0].auth.policy?.logicalPath).toBe('./policies/invoice-access');
    expect(result.ir?.resources[0].auth.policy?.manifest?.ruleSet).toBe('invoice-access');

    const policyAdapter = result.files.find((file) => file.path.endsWith('/security/InvoicesPolicy.java'));
    const policyPrincipal = result.files.find((file) => file.path.endsWith('/security/PolicyPrincipal.java'));
    const controller = result.files.find((file) => file.path.endsWith('/controller/InvoicesController.java'));

    expect(policyAdapter?.content).toContain('private static final List<Map<String, Object>> RULES = loadRules();');
    expect(policyAdapter?.content).toContain('public <T> List<T> filterList(PolicyPrincipal principal, List<T> items)');
    expect(policyAdapter?.content).toContain('Completed invoices cannot be deleted.');
    expect(policyPrincipal?.content).toContain('Set<String> resolvedRoles = new LinkedHashSet<>();');
    expect(policyPrincipal?.content).toContain('return new PolicyPrincipal(authentication.getName(), Collections.unmodifiableSet(resolvedRoles));');
    expect(controller?.content).toContain('List<InvoiceResponse> items = policy.filterList(principal, service.list());');
    expect(controller?.content).toContain('policy.deniedMessage("list", principal, Map.of(), null, null)');
    expect(controller?.content).toContain('InvoiceResponse current = service.get(id);');
  });

  it('resolves linked rules policies for nested backend entry roots', () => {
    const files = {
      'backend/app.api.loj': `
app:
  name: "Invoice Service"
  package: "com.example.invoices"

imports:
  - ./models/
  - ./resources/
`,
      'backend/models/invoice.api.loj': `
model Invoice:
  status: enum(DRAFT, COMPLETED) @required
  salesOwnerUsername: string @required
`,
      'backend/resources/invoices.api.loj': `
resource invoices:
  model: Invoice
  api: /api/invoices
  auth:
    roles: [ADMIN, SALES]
    policy: '@rules("./policies/invoice-access")'
`,
      'backend/resources/policies/invoice-access.rules.loj': `
rules invoice-access:
  allow list:
    when: currentUser.role in [ADMIN, SALES]
    scopeWhen: currentUser.role == SALES
    scope: record.salesOwnerUsername == currentUser.id
`,
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'backend/app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['backend/resources/policies/invoice-access.rules.loj']);
    expect(result.ir?.resources[0].auth.policy?.resolvedPath).toBe('backend/resources/policies/invoice-access.rules.loj');
  });

  it('links @rules auth.policy into fastapi backend enforcement', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Invoice Service"
  package: "com.example.invoices"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

imports:
  - ./models/
  - ./resources/
`,
      'models/invoice.api.loj': `
model Invoice:
  status: enum(DRAFT, COMPLETED) @required
  accountManagerId: string @required
`,
      'resources/invoices.api.loj': `
resource invoices:
  model: Invoice
  api: /api/invoices
  auth:
    roles: [ADMIN, SALES]
    policy: '@rules("./policies/invoice-access")'
`,
      'resources/policies/invoice-access.rules.loj': `
rules invoice-access:
  allow list:
    when: currentUser.role in [ADMIN, SALES]
    scopeWhen: currentUser.role == SALES
    scope: record.accountManagerId == currentUser.id

  allow create:
    when: currentUser.role == ADMIN

  deny delete:
    when: record.status == COMPLETED
    message:
      defaultMessage: "Completed invoices cannot be deleted."
`,
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['resources/policies/invoice-access.rules.loj']);
    const policyModule = result.files.find((file) => file.path === 'app/custom/policies/invoices_policy.py');
    const routeModule = result.files.find((file) => file.path === 'app/routes/invoices.py');

    expect(policyModule?.content).toContain('RULES = json.loads(');
    expect(policyModule?.content).toContain('def filter_list(principal: AuthenticatedUser, items: Sequence[object]) -> list[object]:');
    expect(policyModule?.content).toContain('Completed invoices cannot be deleted.');
    expect(routeModule?.content).toContain('filter_list as filter_invoices_policy_list');
    expect(routeModule?.content).toContain('_enforce_rules_policy(principal, "create", {}, payload.model_dump(), None)');
    expect(routeModule?.content).toContain('filtered = filter_invoices_policy_list(principal, records)');
  });

  it('links create.rules into spring create eligibility and validation enforcement', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Booking Service"
  package: "com.example.booking"

imports:
  - ./models/
  - ./resources/
`,
      'models/booking.api.loj': `
model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required
`,
      'resources/bookings.api.loj': `
resource bookings:
  model: Booking
  api: /api/bookings
  create:
    rules: '@rules("./rules/booking-create")'
    includes:
      - field: passengers
        fields: [name]
`,
      'resources/rules/booking-create.rules.loj': `
rules booking-create:
  eligibility create-booking:
    when: currentUser.role in [ADMIN, AGENT]
    message:
      defaultMessage: "Booking create is not allowed."

  validate passengers-present:
    when: count(payload.passengers) > 0
    message:
      defaultMessage: "At least one passenger is required."
`,
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['resources/rules/booking-create.rules.loj']);
    const rulesAdapter = result.files.find((file) => file.path.endsWith('/rules/BookingsCreateRules.java'));
    const controller = result.files.find((file) => file.path.endsWith('/controller/BookingsController.java'));

    expect(rulesAdapter?.content).toContain('private static final List<Map<String, Object>> ELIGIBILITY = loadEntries("eligibility");');
    expect(rulesAdapter?.content).toContain('private static final List<Map<String, Object>> VALIDATION = loadEntries("validation");');
    expect(rulesAdapter?.content).toContain('At least one passenger is required.');
    expect(controller?.content).toContain('private final BookingsCreateRules createRules;');
    expect(controller?.content).toContain('String validationFailure = createRules.firstValidationFailure(principal, params, request);');
    expect(controller?.content).toContain('throw new ResponseStatusException(HttpStatus.BAD_REQUEST, validationFailure);');
  });

  it('links readModel rules into spring read-model eligibility, validation, and derivation', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Flight Service"
  package: "com.example.flights"

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    passengerCount: integer @required
  result:
    basePrice: decimal
    quotedPrice: decimal
  handler: '@fn("./read-models/flightAvailability")'
  rules: '@rules("./rules/flight-availability")'
`,
      'rules/flight-availability.rules.loj': `
rules flight-availability:
  eligibility search-window:
    when: input.passengerCount > 0
    message:
      defaultMessage: "Passenger count must be positive."

  validate search-limit:
    when: input.passengerCount <= 9
    message:
      defaultMessage: "Passenger count must stay under ten."

  derive quotedPrice:
    value: item.basePrice * input.passengerCount
`,
      'read-models/flightAvailability.java': 'return List.of();',
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual(['read-models/flightAvailability.java', 'rules/flight-availability.rules.loj']);
    const rulesAdapter = result.files.find((file) => file.path.endsWith('/rules/FlightAvailabilityReadModelRules.java'));
    const controller = result.files.find((file) => file.path.endsWith('/controller/FlightAvailabilityReadModelController.java'));

    expect(rulesAdapter?.content).toContain('private static final List<Map<String, Object>> VALIDATION = loadEntries("validation");');
    expect(rulesAdapter?.content).toContain('private static final List<Map<String, Object>> DERIVATIONS = loadEntries("derivations");');
    expect(rulesAdapter?.content).toContain('public String firstValidationFailure');
    expect(rulesAdapter?.content).toContain('private BigDecimal applyQuotedPriceDerivation');
    expect(controller?.content).toContain('enforceEligibility(input, principal);');
    expect(controller?.content).toContain('enforceValidation(input, principal);');
    expect(controller?.content).toContain('rules.applyDerivations(input, principal, handler.execute(input, principal))');
  });

  it('links create.rules and readModel rules into fastapi target codegen', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Booking Service"
  package: "com.example.booking"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    rules: '@rules("./rules/booking-create")'
    includes:
      - field: passengers
        fields: [name]

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  inputs:
    passengerCount: integer @required
  result:
    basePrice: decimal
    quotedPrice: decimal
  handler: '@fn("./read-models/flightAvailability")'
  rules: '@rules("./rules/flight-availability")'
`,
      'rules/booking-create.rules.loj': `
rules booking-create:
  eligibility create-booking:
    when: currentUser.role in [ADMIN, AGENT]
  validate passengers-present:
    when: count(payload.passengers) > 0
`,
      'rules/flight-availability.rules.loj': `
rules flight-availability:
  eligibility search-window:
    when: input.passengerCount > 0
  validate search-limit:
    when: input.passengerCount <= 9
  derive quotedPrice:
    value: item.basePrice * input.passengerCount
`,
      'read-models/flightAvailability.py': 'return []',
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(true);
    expect(result.hostFiles).toEqual([
      'read-models/flightAvailability.py',
      'rules/booking-create.rules.loj',
      'rules/flight-availability.rules.loj',
    ]);
    const createRulesModule = result.files.find((file) => file.path === 'app/custom/rules/bookings_create_rules.py');
    const routeModule = result.files.find((file) => file.path === 'app/routes/bookings.py');
    const readModelRulesModule = result.files.find((file) => file.path === 'app/custom/rules/flight_availability_read_model_rules.py');
    const readModelRoute = result.files.find((file) => file.path === 'app/routes/flight_availability_read_model.py');

    expect(createRulesModule?.content).toContain('ELIGIBILITY = MANIFEST.get("eligibility", [])');
    expect(createRulesModule?.content).toContain('VALIDATION = MANIFEST.get("validation", [])');
    expect(routeModule?.content).toContain('from app.custom.rules.bookings_create_rules import first_eligibility_failure');
    expect(routeModule?.content).toContain('_enforce_create_rules(');
    expect(readModelRulesModule?.content).toContain('VALIDATION = MANIFEST.get("validation", [])');
    expect(readModelRulesModule?.content).toContain('def first_validation_failure');
    expect(readModelRulesModule?.content).toContain('DERIVATIONS = MANIFEST.get("derivations", [])');
    expect(readModelRulesModule?.content).toContain('def _apply_quoted_price_derivation');
    expect(readModelRoute?.content).toContain('first_flight_availability_read_model_validation_failure');
    expect(readModelRoute?.content).toContain('status.HTTP_400_BAD_REQUEST');
    expect(readModelRoute?.content).toContain('apply_flight_availability_read_model_derivations');
  });

  it('rejects invalid linked create/readModel rules usage', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Booking Service"
  package: "com.example.booking"

model Booking:
  reference: string @required

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    rules: '@rules("./rules/booking-create")'

readModel flightAvailability:
  api: /api/flight-availability
  auth:
    mode: public
  result:
    quotedPrice: decimal
  handler: '@fn("./read-models/flightAvailability")'
  rules: '@rules("./rules/flight-availability")'
`,
      'rules/booking-create.rules.loj': `
rules booking-create:
  derive quotedPrice:
    value: 10
`,
      'rules/flight-availability.rules.loj': `
rules flight-availability:
  allow list:
    when: true
`,
      'read-models/flightAvailability.java': 'return List.of();',
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'resource bookings create.rules does not support derive entries in the current slice',
      'resource bookings create.rules must define at least one eligibility or validate entry',
      'readModel flightAvailability rules does not support allow/deny auth entries; keep readModel auth at mode/roles in the current slice',
      'readModel flightAvailability rules must define at least one eligibility, validate, or derive entry',
    ]));
  });

  it('rejects backend-linked rules policies that use unsupported builtins', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Invoice Service"
  package: "com.example.invoices"

imports:
  - ./models/
  - ./resources/
`,
      'models/invoice.api.loj': `
model Invoice:
  ownerId: string @required
`,
      'resources/invoices.api.loj': `
resource invoices:
  model: Invoice
  api: /api/invoices
  auth:
    roles: [ADMIN]
    policy: '@rules("./policies/invoice-access")'
`,
      'resources/policies/invoice-access.rules.loj': `
rules invoice-access:
  allow get:
    when: isOwner(currentUser, record)
`,
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.message.includes('does not support builtin isOwner'))).toBe(true);
  });

  it('rejects module files with app blocks', () => {
    const files = {
      'app.sdsl': `
app:
  name: "User Service"
  package: "com.example.users"

imports:
  - ./models/user.sdsl

model AuditLog:
  event: string

resource audits:
  model: AuditLog
  api: /api/audits
`,
      'models/user.sdsl': `
app:
  name: "Nested App"
  package: "com.example.nested"

model User:
  name: string
`,
    };
    const result = compileProject({
      entryFile: 'app.sdsl',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('may not define app or compiler blocks');
  });

  it('reports import cycles with a chain', () => {
    const files = {
      'app.sdsl': `
app:
  name: "User Service"
  package: "com.example.users"

imports:
  - ./a.sdsl

model User:
  name: string

resource users:
  model: User
  api: /api/users
`,
      'a.sdsl': `
imports:
  - ./b.sdsl
`,
      'b.sdsl': `
imports:
  - ./a.sdsl
`,
    };
    const result = compileProject({
      entryFile: 'app.sdsl',
      readFile: createVfs(files),
    });
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toContain('Import cycle detected');
    expect(result.errors[0].message).toContain('a.sdsl -> b.sdsl -> a.sdsl');
  });

  it('generates a Spring Boot project skeleton with transport envelopes and security', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.userservice"

model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(ADMIN, SUPPORT, VIEWER) @required
  active: boolean
  createdAt: datetime @createdAt
  updatedAt: datetime @updatedAt

resource users:
  model: User
  api: /api/users
  auth:
    roles: [ADMIN]
  operations:
    delete: false

resource publicAnnouncements:
  model: User
  api: /api/public-announcements
  auth:
    mode: public
  operations:
    get: false
    create: false
    update: false
    delete: false
`;
    const result = compile(source, 'app.sdsl');
    expect(result.success).toBe(true);

    const generatedNotice = result.files.find((file) => file.path === 'GENERATED.md');
    const pom = result.files.find((file) => file.path === 'pom.xml');
    const applicationClass = result.files.find((file) => file.path.endsWith('UserServiceApplication.java'));
    const securityConfig = result.files.find((file) => file.path.endsWith('/config/SecurityConfig.java'));
    const controller = result.files.find((file) => file.path.endsWith('/controller/UsersController.java'));
    const entity = result.files.find((file) => file.path.endsWith('/domain/User.java'));
    const requestDto = result.files.find((file) => file.path.endsWith('/dto/UserRequest.java'));
    const responseDto = result.files.find((file) => file.path.endsWith('/dto/UserResponse.java'));
    const listEnvelope = result.files.find((file) => file.path.endsWith('/api/ListEnvelope.java'));
    const applicationProperties = result.files.find((file) => file.path === 'src/main/resources/application.properties');
    const contextTest = result.files.find((file) => file.path.endsWith('UserServiceApplicationTests.java'));
    const usersIntegrationTest = result.files.find((file) => file.path.endsWith('/controller/UsersControllerIntegrationTests.java'));
    const publicIntegrationTest = result.files.find((file) => file.path.endsWith('/controller/PublicAnnouncementsControllerIntegrationTests.java'));

    expect(generatedNotice?.content).toContain('This directory is generated by Loj.');
    expect(applicationClass?.content).toContain('Prefer editing source .api.loj files, linked files, or documented escape hatches instead of this generated file.');
    expect(pom?.content).toContain('spring-boot-starter-web');
    expect(pom?.content).toContain('spring-boot-starter-security');
    expect(pom?.content).toContain('spring-boot-test-autoconfigure');
    expect(securityConfig?.content).toContain('requestMatchers("/api/public-announcements", "/api/public-announcements/**").permitAll()');
    expect(securityConfig?.content).toContain('roles("ADMIN")');
    expect(controller?.content).toContain('@RequestMapping("/api/users")');
    expect(controller?.content).toContain('@PreAuthorize("hasAnyRole(\'ADMIN\')")');
    expect(controller?.content).toContain('new ListEnvelope<>(service.list())');
    expect(controller?.content).not.toContain('import com.example.userservice.security.PolicyPrincipal;');
    expect(entity?.content).toContain('@Entity');
    expect(entity?.content).toContain('@Table(name = "user_records"');
    expect(entity?.content).toContain('@Enumerated(EnumType.STRING)');
    expect(entity?.content).toContain('@PrePersist');
    expect(requestDto?.content).toContain('import com.example.userservice.domain.UserRole;');
    expect(requestDto?.content).toContain('@NotBlank');
    expect(requestDto?.content).toContain('@Email');
    expect(requestDto?.content).toContain('@Size(min = 2)');
    expect(responseDto?.content).toContain('import com.example.userservice.domain.UserRole;');
    expect(listEnvelope?.content).toContain('record ListEnvelope<T>');
    expect(applicationProperties?.content).toContain('spring.h2.console.enabled=true');
    expect(contextTest?.content).toContain('@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)');
    expect(usersIntegrationTest?.content).toContain('@AutoConfigureMockMvc');
    expect(usersIntegrationTest?.content).toContain('.header("Authorization", adminAuthorizationHeader())');
    expect(usersIntegrationTest?.content).toContain('void createPersistsAndReturnsItem() throws Exception');
    expect(usersIntegrationTest?.content).toContain('void updatePersistsAndReturnsItem() throws Exception');
    expect(usersIntegrationTest?.content).not.toContain('void deleteRemovesItem() throws Exception');
    expect(publicIntegrationTest?.content).toContain('void listReturnsItems() throws Exception');
    expect(publicIntegrationTest?.content).not.toContain('adminAuthorizationHeader');
  });

  it('generates belongsTo relations for spring and fastapi targets', () => {
    const springSource = `
app:
  name: "User Service"
  package: "com.example.userservice"

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
`;
    const springResult = compile(springSource, 'app.api.loj');
    expect(springResult.success).toBe(true);
    const springEntity = springResult.files.find((file) => file.path.endsWith('/domain/User.java'));
    const springRequest = springResult.files.find((file) => file.path.endsWith('/dto/UserRequest.java'));
    const springResponse = springResult.files.find((file) => file.path.endsWith('/dto/UserResponse.java'));
    const springService = springResult.files.find((file) => file.path.endsWith('/service/UserService.java'));
    expect(springEntity?.content).toContain('@ManyToOne(fetch = FetchType.LAZY)');
    expect(springEntity?.content).toContain('@JoinColumn(name = "team_id", nullable = false)');
    expect(springRequest?.content).toContain('Long team');
    expect(springResponse?.content).toContain('Long team');
    expect(springService?.content).toContain('private final TeamRepository teamRepository;');
    expect(springService?.content).toContain('teamRepository.findById(request.team())');
    expect(springService?.content).toContain('entity.getTeam() != null ? entity.getTeam().getId() : null');

    const fastapiSource = `
app:
  name: "User Service"
  package: "com.example.userservice"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

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
`;
    const fastapiResult = compile(fastapiSource, 'app.api.loj');
    expect(fastapiResult.success).toBe(true);
    const fastapiModel = fastapiResult.files.find((file) => file.path === 'app/models/user.py');
    const fastapiSchema = fastapiResult.files.find((file) => file.path === 'app/schemas/user.py');
    const fastapiService = fastapiResult.files.find((file) => file.path === 'app/services/user.py');
    expect(fastapiModel?.content).toContain('ForeignKey("team.id")');
    expect(fastapiModel?.content).toContain('team: Mapped[int]');
    expect(fastapiSchema?.content).toContain('team: int');
    expect(fastapiService?.content).toContain('entity.team = payload.team');
  });

  it('generates relation-aware Spring integration-test seeding for belongsTo chains', () => {
    const source = `
app:
  name: "Invoice Service"
  package: "com.example.invoiceservice"

model Team:
  name: string @required @unique

model Customer:
  name: string @required @unique
  team: belongsTo(Team) @required

model Invoice:
  number: string @required @unique
  customer: belongsTo(Customer) @required

resource teams:
  model: Team
  api: /api/teams

resource customers:
  model: Customer
  api: /api/customers

resource invoices:
  model: Invoice
  api: /api/invoices
`;
    const result = compile(source, 'app.api.loj');
    expect(result.success).toBe(true);

    const invoiceIntegrationTest = result.files.find((file) => file.path.endsWith('/controller/InvoicesControllerIntegrationTests.java'));
    const teamsIntegrationTest = result.files.find((file) => file.path.endsWith('/controller/TeamsControllerIntegrationTests.java'));

    expect(invoiceIntegrationTest?.content).toContain('private CustomerRepository customerRepository;');
    expect(invoiceIntegrationTest?.content).toContain('private TeamRepository teamRepository;');
    expect(invoiceIntegrationTest?.content).toContain('private Customer primarySampleCustomer;');
    expect(invoiceIntegrationTest?.content).toContain('private Team primarySampleTeam;');
    expect(invoiceIntegrationTest?.content).toContain('customerRepository.deleteAll();');
    expect(invoiceIntegrationTest?.content).toContain('teamRepository.deleteAll();');
    expect(invoiceIntegrationTest?.content).toContain('seedSampleCustomerPrimary().getId()');
    expect(invoiceIntegrationTest?.content).toContain('seedSampleCustomerSecondary().getId()');
    expect(invoiceIntegrationTest?.content).toContain('entity.setCustomer(request.customer() != null ? customerRepository.findById(request.customer()).orElseThrow() : null);');
    expect(invoiceIntegrationTest?.content).toContain('entity.setTeam(seedSampleTeamPrimary());');
    expect(invoiceIntegrationTest?.content).toContain('entity.setTeam(seedSampleTeamSecondary());');
    expect(teamsIntegrationTest?.content).toContain('invoiceRepository.deleteAll();');
    expect(teamsIntegrationTest?.content).toContain('customerRepository.deleteAll();');
    expect(teamsIntegrationTest?.content).toContain('repository.deleteAll();');
  });

  it('supports hasMany inverse metadata without generating storage fields', () => {
    const springSource = `
app:
  name: "User Service"
  package: "com.example.userservice"

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
    const springResult = compile(springSource, 'app.api.loj');
    expect(springResult.success).toBe(true);

    const membersField = springResult.ir?.models
      .find((model) => model.name === 'Team')
      ?.fields.find((field) => field.name === 'members');
    const teamEntity = springResult.files.find((file) => file.path.endsWith('/domain/Team.java'));
    const teamRequest = springResult.files.find((file) => file.path.endsWith('/dto/TeamRequest.java'));
    const teamResponse = springResult.files.find((file) => file.path.endsWith('/dto/TeamResponse.java'));

    expect(membersField?.fieldType).toEqual({
      type: 'relation',
      kind: 'hasMany',
      target: 'User',
      by: 'team',
    });
    expect(teamEntity?.content).not.toContain('members');
    expect(teamRequest?.content).not.toContain('members');
    expect(teamResponse?.content).not.toContain('members');

    const fastapiSource = `
app:
  name: "User Service"
  package: "com.example.userservice"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

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
    const fastapiResult = compile(fastapiSource, 'app.api.loj');
    expect(fastapiResult.success).toBe(true);
    const fastapiModel = fastapiResult.files.find((file) => file.path === 'app/models/team.py');
    const fastapiSchema = fastapiResult.files.find((file) => file.path === 'app/schemas/team.py');
    expect(fastapiModel?.content).not.toContain('members');
    expect(fastapiSchema?.content).not.toContain('members');
  });

  it('compiles spring aggregate-root nested create resources', () => {
    const source = `
app:
  name: "Booking Service"
  package: "com.example.booking"

model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    includes:
      - field: passengers
        fields:
          - name
`;
    const result = compile(source, 'app.api.loj');
    expect(result.success).toBe(true);

    const requestDto = result.files.find((file) => file.path.endsWith('/dto/BookingsCreateRequest.java'));
    const itemDto = result.files.find((file) => file.path.endsWith('/dto/BookingsPassengersCreateItem.java'));
    const controller = result.files.find((file) => file.path.endsWith('/controller/BookingsController.java'));
    const service = result.files.find((file) => file.path.endsWith('/service/BookingService.java'));
    const integrationTest = result.files.find((file) => file.path.endsWith('/controller/BookingsControllerIntegrationTests.java'));

    expect(requestDto?.content).toContain('List<BookingsPassengersCreateItem> passengers');
    expect(itemDto?.content).toContain('String name');
    expect(controller?.content).toContain('@Valid @RequestBody BookingsCreateRequest request');
    expect(controller?.content).toContain('service.createBookings(request)');
    expect(service?.content).toContain('@Transactional');
    expect(service?.content).toContain('public BookingResponse createBookings(BookingsCreateRequest request)');
    expect(service?.content).toContain('persistBookingsPassengersItems(entity, request.passengers());');
    expect(service?.content).toContain('entity.setBooking(parent);');
    expect(service?.content).toContain('deleteNestedChildren(entity);');
    expect(service?.content).toContain('deleteBookingPassengersItems(entity);');
    expect(integrationTest?.content).toContain('BookingsCreateRequest request = primaryRequest();');
    expect(integrationTest?.content).toContain('List.of(');
    expect(integrationTest?.content).toContain('new BookingsPassengersCreateItem(');
    expect(integrationTest?.content).toContain('assertEquals(request.passengers() != null ? request.passengers().size() : 0');
  });

  it('derives spring nested create integration test samples from create.rules validation equalities', () => {
    const files = {
      'app.api.loj': `
app:
  name: "Booking Service"
  package: "com.example.booking"

imports:
  - ./models/
  - ./resources/
`,
      'models/booking.api.loj': `
model Booking:
  outwardBaseFare: decimal @required
  homewardBaseFare: decimal @required
  baseFare: decimal @required
  serviceFee: decimal @required
  taxAmount: decimal @required
  vacancySurcharge: decimal @required
  quotedFare: decimal @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required
`,
      'resources/bookings.api.loj': `
resource bookings:
  model: Booking
  api: /api/bookings
  create:
    rules: '@rules("./rules/booking-create")'
    includes:
      - field: passengers
        fields: [name]
`,
      'resources/rules/booking-create.rules.loj': `
rules booking-create:
  validate passengers-present:
    when: count(payload.passengers) > 0

  validate base-fare:
    when: payload.baseFare == payload.outwardBaseFare + payload.homewardBaseFare

  validate service-fee:
    when: payload.serviceFee == count(payload.passengers) * 8

  validate tax-amount:
    when: payload.taxAmount == count(payload.passengers) * 12

  validate vacancy-surcharge:
    when: payload.vacancySurcharge == count(payload.passengers) * 5

  validate quoted-fare:
    when: payload.quotedFare == ((payload.outwardBaseFare + payload.homewardBaseFare) * count(payload.passengers)) + payload.serviceFee + payload.taxAmount + payload.vacancySurcharge
`,
    };
    const vfs = createDirectoryAwareVfs(files);
    const result = compileProject({
      entryFile: 'app.api.loj',
      readFile: vfs.readFile,
      listFiles: vfs.listFiles,
    });

    expect(result.success).toBe(true);
    const integrationTest = result.files.find((file) => file.path.endsWith('/controller/BookingsControllerIntegrationTests.java'));

    expect(integrationTest?.content).toContain('new BigDecimal("25.00")');
    expect(integrationTest?.content).toContain('new BigDecimal("8.00")');
    expect(integrationTest?.content).toContain('new BigDecimal("12.00")');
    expect(integrationTest?.content).toContain('new BigDecimal("5.00")');
    expect(integrationTest?.content).toContain('new BigDecimal("50.00")');
  });

  it('compiles fastapi aggregate-root nested create resources', () => {
    const source = `
app:
  name: "Booking Service"
  package: "com.example.booking"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  create:
    includes:
      - field: passengers
        fields:
          - name
`;
    const result = compile(source, 'app.api.loj');
    expect(result.success).toBe(true);

    const schema = result.files.find((file) => file.path === 'app/schemas/bookings_create.py');
    const route = result.files.find((file) => file.path === 'app/routes/bookings.py');
    const service = result.files.find((file) => file.path === 'app/services/booking.py');

    expect(schema?.content).toContain('class BookingsPassengersCreateItem(BaseModel):');
    expect(schema?.content).toContain('class BookingsCreate(BookingBase):');
    expect(schema?.content).toContain('passengers: list[BookingsPassengersCreateItem] | None = None');
    expect(route?.content).toContain('from app.schemas.bookings_create import BookingsCreate');
    expect(route?.content).toContain('payload: BookingsCreate');
    expect(route?.content).toContain('return create_bookings(db, payload)');
    expect(service?.content).toContain('def create_bookings(db: Session, payload: BookingsCreate) -> Booking:');
    expect(service?.content).toContain('db.flush()');
    expect(service?.content).toContain('entity.booking = parent.id');
  });

  it('compiles spring aggregate-root nested update resources', () => {
    const source = `
app:
  name: "Booking Service"
  package: "com.example.booking"

model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  update:
    includes:
      - field: passengers
        fields:
          - name
`;
    const result = compile(source, 'app.api.loj');
    expect(result.success).toBe(true);

    const requestDto = result.files.find((file) => file.path.endsWith('/dto/BookingsUpdateRequest.java'));
    const itemDto = result.files.find((file) => file.path.endsWith('/dto/BookingsPassengersUpdateItem.java'));
    const controller = result.files.find((file) => file.path.endsWith('/controller/BookingsController.java'));
    const service = result.files.find((file) => file.path.endsWith('/service/BookingService.java'));
    const integrationTest = result.files.find((file) => file.path.endsWith('/controller/BookingsControllerIntegrationTests.java'));

    expect(requestDto?.content).toContain('List<BookingsPassengersUpdateItem> passengers');
    expect(itemDto?.content).toContain('Long id');
    expect(controller?.content).toContain('@Valid @RequestBody BookingsUpdateRequest request');
    expect(controller?.content).toContain('service.updateBookings(id, request)');
    expect(service?.content).toContain('@Transactional');
    expect(service?.content).toContain('public BookingResponse updateBookings(Long id, BookingsUpdateRequest request)');
    expect(service?.content).toContain('syncBookingsPassengersItems(entity, request.passengers());');
    expect(service?.content).toContain('Map<Long, Passenger> existing');
    expect(service?.content).toContain('delete(leftover);');
    expect(integrationTest?.content).toContain('BookingsUpdateRequest request = secondaryRequest(entity);');
    expect(integrationTest?.content).toContain('new BookingsPassengersUpdateItem(');
    expect(integrationTest?.content).toContain('existingPassengersId(entity)');
  });

  it('compiles fastapi aggregate-root nested update resources', () => {
    const source = `
app:
  name: "Booking Service"
  package: "com.example.booking"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  update:
    includes:
      - field: passengers
        fields:
          - name
`;
    const result = compile(source, 'app.api.loj');
    expect(result.success).toBe(true);

    const schema = result.files.find((file) => file.path === 'app/schemas/bookings_update.py');
    const route = result.files.find((file) => file.path === 'app/routes/bookings.py');
    const service = result.files.find((file) => file.path === 'app/services/booking.py');

    expect(schema?.content).toContain('class BookingsPassengersUpdateItem(BaseModel):');
    expect(schema?.content).toContain('id: int | None = None');
    expect(schema?.content).toContain('class BookingsUpdate(BookingBaseUpdate):');
    expect(schema?.content).toContain('passengers: list[BookingsPassengersUpdateItem] | None = None');
    expect(route?.content).toContain('from app.schemas.bookings_update import BookingsUpdate');
    expect(route?.content).toContain('payload: BookingsUpdate');
    expect(route?.content).toContain('return update_bookings(db, item_id, payload)');
    expect(service?.content).toContain('def update_bookings(db: Session, item_id: int, payload: BookingsUpdate) -> Booking:');
    expect(service?.content).toContain('_sync_bookings_passengers_items(db, entity, payload.passengers)');
    expect(service?.content).toContain('raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Passenger not found for nested update")');
  });

  it('rejects invalid aggregate-root nested create resources', () => {
    const source = `
app:
  name: "Booking Service"
  package: "com.example.booking"

model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  operations:
    create: false
  create:
    includes:
      - field: reference
        fields:
          - name
      - field: passengers
        fields:
          - booking
`;
    const result = compile(source, 'app.api.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'resource bookings uses create.includes or create.rules but create operation is disabled',
      'resource bookings create include "reference" must reference a hasMany(..., by: ...) field',
      'resource bookings create include field "booking" is the inverse belongsTo(Booking) field and is seeded automatically',
    ]));
  });

  it('rejects invalid aggregate-root nested update resources', () => {
    const source = `
app:
  name: "Booking Service"
  package: "com.example.booking"

model Booking:
  reference: string @required
  passengers: hasMany(Passenger, by: booking)

model Passenger:
  name: string @required
  booking: belongsTo(Booking) @required

resource bookings:
  model: Booking
  api: /api/bookings
  operations:
    update: false
  update:
    includes:
      - field: reference
        fields:
          - name
      - field: passengers
        fields:
          - booking
`;
    const result = compile(source, 'app.api.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'resource bookings uses update.includes but update operation is disabled',
      'resource bookings update include "reference" must reference a hasMany(..., by: ...) field',
      'resource bookings update include field "booking" is the inverse belongsTo(Booking) field and is seeded automatically',
    ]));
  });

  it('rejects invalid hasMany inverse metadata', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.userservice"

model Team:
  name: string @required
  members: hasMany(User, by: company) @required

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
    const result = compile(source, 'app.api.loj');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(expect.arrayContaining([
      'model Team field members is a hasMany() inverse relation and does not support field decorators',
      'model Team field members references missing inverse field "company" on model "User"',
    ]));
  });

  it('generates a FastAPI project skeleton with raw transport responses and generated pytest tests', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.userservice"

compiler:
  target: fastapi
  language: python
  profile: rest-sqlalchemy-auth

model User:
  name: string @required @minLen(2)
  email: string @required @email @unique
  role: enum(admin, editor, viewer) @required
  status: enum(active, suspended) @required
  createdAt: datetime @createdAt
  updatedAt: datetime @updatedAt

resource users:
  model: User
  api: /api/users
  auth:
    roles: [ADMIN]
`;
    const result = compile(source, 'app.sdsl');
    expect(result.success).toBe(true);

    const generatedNotice = result.files.find((file) => file.path === 'GENERATED.md');
    const pyproject = result.files.find((file) => file.path === 'pyproject.toml');
    const main = result.files.find((file) => file.path === 'app/main.py');
    const modelModule = result.files.find((file) => file.path === 'app/models/user.py');
    const schemaModule = result.files.find((file) => file.path === 'app/schemas/user.py');
    const routeModule = result.files.find((file) => file.path === 'app/routes/users.py');
    const serviceModule = result.files.find((file) => file.path === 'app/services/user.py');
    const apiTest = result.files.find((file) => file.path === 'tests/test_users_api.py');

    expect(generatedNotice?.content).toContain('This directory is generated by Loj.');
    expect(main?.content).toContain('Prefer editing source .api.loj files, linked files, or documented escape hatches instead of this generated file.');
    expect(pyproject?.content).toContain('fastapi>=0.115,<1');
    expect(pyproject?.content).toContain('sqlalchemy>=2.0,<3');
    expect(pyproject?.content).toContain('pytest>=8,<9');
    expect(main?.content).toContain('Base.metadata.create_all(bind=engine)');
    expect(main?.content).toContain('async def healthz()');
    expect(main?.content).toContain('content={"message": message}');
    expect(modelModule?.content).toContain('class UserRole(str, enum.Enum):');
    expect(modelModule?.content).toContain('__tablename__ = "user_records"');
    expect(modelModule?.content).toContain('updatedAt: Mapped[datetime]');
    expect(schemaModule?.content).toContain('class UserCreate(UserBase):');
    expect(schemaModule?.content).toContain('model_config = ConfigDict(from_attributes=True)');
    expect(routeModule?.content).toContain('router = APIRouter(prefix="/api/users"');
    expect(routeModule?.content).toContain('response_model=list[UserResponse]');
    expect(routeModule?.content).toContain('async def create_users');
    expect(routeModule?.content).toContain('Depends(require_roles("ADMIN"))');
    expect(serviceModule?.content).toContain('def create_user(db: Session, payload: UserCreate) -> User:');
    expect(serviceModule?.content).toContain('raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")');
    expect(apiTest?.content).toContain('import httpx');
    expect(apiTest?.content).toContain('async with httpx.AsyncClient(transport=transport, base_url="http://testserver", trust_env=False)');
    expect(apiTest?.content).toContain('response = await client.get("/api/users", headers=auth_headers())');
    expect(apiTest?.content).toContain('@pytest.mark.anyio');
    expect(apiTest?.content).toContain('async def test_users_requires_auth(client: httpx.AsyncClient) -> None:');
    expect(apiTest?.content).toContain('engine.dispose()');
    expect(apiTest?.content).toContain('if TEST_DB_PATH.exists():');
    expect(apiTest?.content).toContain('TEST_DB_PATH.unlink()');
  });

  it('fails validation when api paths collide or a resource enables no operations', () => {
    const source = `
app:
  name: "User Service"
  package: "com.example.userservice"

model User:
  name: string
  id: string
  createdAt: datetime @createdAt
  updatedAtA: datetime @updatedAt
  updatedAtB: datetime @updatedAt

resource users:
  model: User
  api: /api/users
  operations:
    list: false
    get: false
    create: false
    update: false
    delete: false

resource auditUsers:
  model: User
  api: /api/users
`;
    const result = compile(source, 'app.sdsl');
    expect(result.success).toBe(false);
    expect(result.errors.map((error) => error.message)).toEqual(
      expect.arrayContaining([
        expect.stringContaining('must not define "id"'),
        expect.stringContaining('at most one @updatedAt field'),
        expect.stringContaining('must enable at least one CRUD operation'),
        expect.stringContaining('Duplicate resource api path "/api/users"'),
      ]),
    );
  });
});
