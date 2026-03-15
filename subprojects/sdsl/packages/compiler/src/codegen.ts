import type {
  IRAuthPolicyEscape,
  IRFieldDecorator,
  IRFieldType,
  IRModel,
  IRModelField,
  IRReadModel,
  IRReadModelAuth,
  IRReadModelField,
  IRReadModelHandlerEscape,
  IRResource,
  IRSdslProgram,
} from './ir.js';
import { generateFastApiProject } from './codegen-fastapi.js';
import { formatBackendTargetTriple, getBackendTargetDescriptor } from './targets.js';

export interface GeneratedFile {
  path: string;
  content: string;
  sourceNode: string;
}

export interface CodegenResult {
  files: GeneratedFile[];
}

export interface CodegenOptions {
  readFile?: (fileName: string) => string;
}

export function generate(ir: IRSdslProgram, options: CodegenOptions = {}): CodegenResult {
  const descriptor = getBackendTargetDescriptor(ir.compiler.target, ir.compiler.language, ir.compiler.profile);
  if (!descriptor) {
    throw new Error(`Unknown backend target during code generation: "${formatBackendTargetTriple(ir.compiler)}"`);
  }
  if (descriptor.key === 'spring-boot/java/mvc-jpa-security') {
    return generateSpringBootProject(ir, options);
  }
  if (descriptor.key === 'fastapi/python/rest-sqlalchemy-auth') {
    return generateFastApiProject(ir, options);
  }
  throw new Error(`Code generation is not implemented for backend target "${descriptor.key}"`);
}

function generateSpringBootProject(ir: IRSdslProgram, options: CodegenOptions = {}): CodegenResult {
  const files: GeneratedFile[] = [];
  const packagePath = ir.app.packageName.replace(/\./g, '/');
  const applicationClassName = `${toPascalCase(ir.app.name)}Application`;
  const policyResources = ir.resources.filter((resource) => resource.auth.policy);
  const hasReadModels = ir.readModels.length > 0;
  const hasLinkedRules = ir.resources.some((resource) => resource.create?.rules) || ir.readModels.some((readModel) => readModel.rules);
  const hasWorkflows = ir.resources.some((resource) => resource.workflow);

  files.push({
    path: 'pom.xml',
    content: generatePomXml(ir),
    sourceNode: ir.app.id,
  });
  files.push({
    path: 'GENERATED.md',
    content: generateGeneratedNotice(),
    sourceNode: ir.app.id,
  });
  files.push({
    path: '.gitignore',
    content: ['target/', '.idea/', '*.iml', '.DS_Store', ''].join('\n'),
    sourceNode: ir.app.id,
  });
  files.push({
    path: 'src/main/resources/application.properties',
    content: generateApplicationProperties(ir),
    sourceNode: ir.app.id,
  });
  files.push({
    path: `src/main/java/${packagePath}/${applicationClassName}.java`,
    content: generateApplicationClass(ir, applicationClassName),
    sourceNode: ir.app.id,
  });
  files.push({
    path: `src/main/java/${packagePath}/config/SecurityConfig.java`,
    content: generateSecurityConfig(ir),
    sourceNode: ir.app.id,
  });
  files.push({
    path: `src/main/java/${packagePath}/config/RestExceptionHandler.java`,
    content: generateRestExceptionHandler(ir),
    sourceNode: ir.app.id,
  });
  if (policyResources.length > 0 || hasReadModels || hasLinkedRules || hasWorkflows) {
    files.push({
      path: `src/main/java/${packagePath}/security/PolicyPrincipal.java`,
      content: generatePolicyPrincipal(ir),
      sourceNode: ir.id,
    });
  }
  files.push({
    path: `src/main/java/${packagePath}/api/ListEnvelope.java`,
    content: generateListEnvelope(ir),
    sourceNode: ir.id,
  });
  files.push({
    path: `src/main/java/${packagePath}/api/ItemEnvelope.java`,
    content: generateItemEnvelope(ir),
    sourceNode: ir.id,
  });
  files.push({
    path: `src/main/java/${packagePath}/api/MessageResponse.java`,
    content: generateMessageResponse(ir),
    sourceNode: ir.id,
  });
  files.push({
    path: `src/test/java/${packagePath}/${applicationClassName}Tests.java`,
    content: generateContextTest(ir, applicationClassName),
    sourceNode: ir.app.id,
  });

  for (const model of ir.models) {
    files.push({
      path: `src/main/java/${packagePath}/domain/${model.name}.java`,
      content: generateEntity(ir, model),
      sourceNode: model.id,
    });
    files.push({
      path: `src/main/java/${packagePath}/dto/${model.name}Request.java`,
      content: generateRequestDto(ir, model),
      sourceNode: model.id,
    });
    files.push({
      path: `src/main/java/${packagePath}/dto/${model.name}Response.java`,
      content: generateResponseDto(ir, model),
      sourceNode: model.id,
    });
    files.push({
      path: `src/main/java/${packagePath}/repository/${model.name}Repository.java`,
      content: generateRepository(ir, model),
      sourceNode: model.id,
    });
    files.push({
      path: `src/main/java/${packagePath}/service/${model.name}Service.java`,
      content: generateService(ir, model),
      sourceNode: model.id,
    });

    for (const field of model.fields) {
      if (field.fieldType.type !== 'enum') {
        continue;
      }
      files.push({
        path: `src/main/java/${packagePath}/domain/${enumClassName(model.name, field.name)}.java`,
        content: generateEnum(ir, model, field),
        sourceNode: field.id,
      });
    }
  }

  for (const resource of ir.resources) {
    const model = ir.models.find((candidate) => candidate.name === resource.model);
    if (!model) {
      continue;
    }
    const nestedCreate = analyzeNestedCreateResource(ir, resource, model);
    const nestedUpdate = analyzeNestedUpdateResource(ir, resource, model);
    if (nestedCreate) {
      for (const include of nestedCreate.includes) {
        files.push({
          path: `src/main/java/${packagePath}/dto/${resourceCreateItemClassName(resource, include.fieldName)}.java`,
          content: generateResourceCreateItemDto(ir, resource, include),
          sourceNode: include.include.id,
        });
      }
      files.push({
        path: `src/main/java/${packagePath}/dto/${resourceCreateRequestClassName(resource)}.java`,
        content: generateResourceCreateRequestDto(ir, resource, model, nestedCreate.includes),
        sourceNode: resource.create!.id,
      });
    }
    if (nestedUpdate) {
      for (const include of nestedUpdate.includes) {
        files.push({
          path: `src/main/java/${packagePath}/dto/${resourceUpdateItemClassName(resource, include.fieldName)}.java`,
          content: generateResourceUpdateItemDto(ir, resource, include),
          sourceNode: include.include.id,
        });
      }
      files.push({
        path: `src/main/java/${packagePath}/dto/${resourceUpdateRequestClassName(resource)}.java`,
        content: generateResourceUpdateRequestDto(ir, resource, model, nestedUpdate.includes),
        sourceNode: resource.update!.id,
      });
    }
    if (resource.auth.policy) {
      files.push({
        path: `src/main/java/${packagePath}/security/${policyClassName(resource)}.java`,
        content: generateSpringPolicyAdapter(ir, resource, options.readFile),
        sourceNode: resource.id,
      });
    }
    if (resource.create?.rules) {
      files.push({
        path: `src/main/java/${packagePath}/rules/${resourceCreateRulesClassName(resource)}.java`,
        content: generateSpringCreateRulesAdapter(ir, resource, model),
        sourceNode: resource.create.id,
      });
    }
    if (resource.workflow) {
      files.push({
        path: `src/main/java/${packagePath}/workflow/${resourceWorkflowClassName(resource)}.java`,
        content: generateSpringWorkflowAdapter(ir, resource as IRResource & { workflow: NonNullable<IRResource['workflow']> }, model),
        sourceNode: resource.workflow.id,
      });
    }
    files.push({
      path: `src/main/java/${packagePath}/controller/${toPascalCase(resource.name)}Controller.java`,
      content: generateController(ir, resource, model),
      sourceNode: resource.id,
    });
    files.push({
      path: `src/test/java/${packagePath}/controller/${toPascalCase(resource.name)}ControllerIntegrationTests.java`,
      content: generateControllerIntegrationTest(ir, resource, model),
      sourceNode: resource.id,
    });
  }

  for (const readModel of ir.readModels) {
    files.push({
      path: `src/main/java/${packagePath}/dto/${readModelInputClassName(readModel)}.java`,
      content: generateReadModelInputDto(ir, readModel),
      sourceNode: readModel.id,
    });
    files.push({
      path: `src/main/java/${packagePath}/dto/${readModelResultClassName(readModel)}.java`,
      content: generateReadModelResultDto(ir, readModel),
      sourceNode: readModel.id,
    });
    files.push({
      path: `src/main/java/${packagePath}/readmodel/${readModelHandlerClassName(readModel)}.java`,
      content: generateReadModelHandler(ir, readModel, options.readFile),
      sourceNode: readModel.id,
    });
    if (readModel.rules) {
      files.push({
        path: `src/main/java/${packagePath}/rules/${readModelRulesClassName(readModel)}.java`,
        content: generateSpringReadModelRulesAdapter(ir, readModel),
        sourceNode: readModel.id,
      });
    }
    files.push({
      path: `src/main/java/${packagePath}/controller/${readModelControllerClassName(readModel)}.java`,
      content: generateReadModelController(ir, readModel),
      sourceNode: readModel.id,
    });
  }

  return { files };
}

function generatePomXml(ir: IRSdslProgram): string {
  const artifactId = toKebabCase(ir.app.name);
  return `<?xml version="1.0" encoding="UTF-8"?>
<project xmlns="http://maven.apache.org/POM/4.0.0"
         xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
         xsi:schemaLocation="http://maven.apache.org/POM/4.0.0 https://maven.apache.org/xsd/maven-4.0.0.xsd">
  <modelVersion>4.0.0</modelVersion>

  <parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.3.5</version>
    <relativePath/>
  </parent>

  <groupId>${ir.app.packageName}</groupId>
  <artifactId>${artifactId}</artifactId>
  <version>0.1.0-SNAPSHOT</version>
  <name>${escapeXml(ir.app.name)}</name>
  <description>Generated SpringDSL service</description>

  <properties>
    <java.version>21</java.version>
  </properties>

  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-validation</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-data-jpa</artifactId>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-security</artifactId>
    </dependency>
    <dependency>
      <groupId>com.h2database</groupId>
      <artifactId>h2</artifactId>
      <scope>runtime</scope>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-test</artifactId>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-test-autoconfigure</artifactId>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.springframework</groupId>
      <artifactId>spring-test</artifactId>
      <scope>test</scope>
    </dependency>
    <dependency>
      <groupId>org.junit.jupiter</groupId>
      <artifactId>junit-jupiter</artifactId>
      <scope>test</scope>
    </dependency>
  </dependencies>

  <build>
    <plugins>
      <plugin>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-maven-plugin</artifactId>
      </plugin>
    </plugins>
  </build>
</project>
`;
}

function generateApplicationProperties(ir: IRSdslProgram): string {
  return [
    `spring.application.name=${toKebabCase(ir.app.name)}`,
    'spring.datasource.url=jdbc:h2:mem:loj;DB_CLOSE_DELAY=-1;DB_CLOSE_ON_EXIT=FALSE',
    'spring.datasource.driverClassName=org.h2.Driver',
    'spring.datasource.username=sa',
    'spring.datasource.password=',
    'spring.jpa.hibernate.ddl-auto=update',
    'spring.jpa.open-in-view=false',
    'spring.jpa.show-sql=true',
    'spring.h2.console.enabled=true',
    'spring.h2.console.path=/h2-console',
    '',
  ].join('\n');
}

function generateApplicationClass(ir: IRSdslProgram, applicationClassName: string): string {
  return `package ${ir.app.packageName};

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ${applicationClassName} {

  // Generated by Loj. Prefer editing source .api.loj files, linked files, or documented escape hatches instead of this generated file.
  public static void main(String[] args) {
    SpringApplication.run(${applicationClassName}.class, args);
  }
}
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

function generateSecurityConfig(ir: IRSdslProgram): string {
  const protectedRoles = Array.from(new Set(
    [
      ...ir.resources
        .filter((resource) => resource.auth.mode === 'authenticated')
        .flatMap((resource) => resource.auth.roles),
      ...ir.readModels
        .filter((readModel) => readModel.auth.mode === 'authenticated')
        .flatMap((readModel) => readModel.auth.roles),
    ],
  ));
  const publicMatchers = [
    ...ir.resources
      .filter((resource) => resource.auth.mode === 'public')
      .map((resource) => `"${resource.api}", "${resource.api}/**"`),
    ...ir.readModels
      .filter((readModel) => readModel.auth.mode === 'public')
      .map((readModel) => `"${readModel.api}"`),
  ];
  const matcherLines = publicMatchers.map((entry) => `        .requestMatchers(${entry}).permitAll()`);
  const anyRequestLine = ir.resources.some((resource) => resource.auth.mode === 'authenticated')
    || ir.readModels.some((readModel) => readModel.auth.mode === 'authenticated')
    ? '        .anyRequest().authenticated()'
    : '        .anyRequest().permitAll()';
  const adminRoles = protectedRoles.length > 0 ? protectedRoles.map((role) => `"${role}"`).join(', ') : '"USER"';
  const supportUser = protectedRoles.includes('SUPPORT')
    ? `,
      User.withUsername("support")
        .password("{noop}support123")
        .roles("SUPPORT")
        .build()`
    : '';

  return `package ${ir.app.packageName}.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
@EnableMethodSecurity
public class SecurityConfig {

  @Bean
  SecurityFilterChain securityFilterChain(HttpSecurity http) throws Exception {
    http
      .csrf(csrf -> csrf.disable())
      .headers(headers -> headers.frameOptions(frame -> frame.sameOrigin()))
      .authorizeHttpRequests(authorize -> authorize
        .requestMatchers("/h2-console/**").permitAll()
${matcherLines.join('\n')}
${anyRequestLine}
      )
      .httpBasic(Customizer.withDefaults());
    return http.build();
  }

  @Bean
  UserDetailsService userDetailsService() {
    return new InMemoryUserDetailsManager(
      User.withUsername("admin")
        .password("{noop}admin123")
        .roles(${adminRoles})
        .build()${supportUser}
    );
  }
}
`;
}

function generateRestExceptionHandler(ir: IRSdslProgram): string {
  return `package ${ir.app.packageName}.config;

import ${ir.app.packageName}.api.MessageResponse;
import java.util.stream.Collectors;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

@RestControllerAdvice
public class RestExceptionHandler {

  @ExceptionHandler(MethodArgumentNotValidException.class)
  ResponseEntity<MessageResponse> handleValidation(MethodArgumentNotValidException exception) {
    String message = exception.getBindingResult().getFieldErrors().stream()
      .map(fieldError -> formatFieldError(fieldError))
      .collect(Collectors.joining("; "));
    return ResponseEntity.badRequest().body(new MessageResponse(message.isBlank() ? "Validation failed" : message));
  }

  @ExceptionHandler(ResponseStatusException.class)
  ResponseEntity<MessageResponse> handleResponseStatus(ResponseStatusException exception) {
    return ResponseEntity.status(exception.getStatusCode()).body(new MessageResponse(exception.getReason() == null ? "Request failed" : exception.getReason()));
  }

  @ExceptionHandler(DataIntegrityViolationException.class)
  ResponseEntity<MessageResponse> handleIntegrityViolation(DataIntegrityViolationException exception) {
    return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(new MessageResponse("Data integrity violation"));
  }

  @ExceptionHandler(Exception.class)
  ResponseEntity<MessageResponse> handleGeneric(Exception exception) {
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(new MessageResponse("Internal server error"));
  }

  private String formatFieldError(FieldError fieldError) {
    return fieldError.getField() + ": " + fieldError.getDefaultMessage();
  }
}
`;
}

function generateListEnvelope(ir: IRSdslProgram): string {
  return `package ${ir.app.packageName}.api;

import java.util.List;

public record ListEnvelope<T>(List<T> items) {
}
`;
}

function generateItemEnvelope(ir: IRSdslProgram): string {
  return `package ${ir.app.packageName}.api;

public record ItemEnvelope<T>(T item) {
}
`;
}

function generateMessageResponse(ir: IRSdslProgram): string {
  return `package ${ir.app.packageName}.api;

public record MessageResponse(String message) {
}
`;
}

function generateContextTest(ir: IRSdslProgram, applicationClassName: string): string {
  return `package ${ir.app.packageName};

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
class ${applicationClassName}Tests {

  @Test
  void contextLoads() {
  }
}
`;
}

function generateControllerIntegrationTest(ir: IRSdslProgram, resource: IRResource, model: IRModel): string {
  const nestedCreate = analyzeNestedCreateResource(ir, resource, model);
  const nestedUpdate = analyzeNestedUpdateResource(ir, resource, model);
  const createRequestClass = nestedCreate ? resourceCreateRequestClassName(resource) : `${model.name}Request`;
  const updateRequestClass = nestedUpdate ? resourceUpdateRequestClassName(resource) : `${model.name}Request`;
  const editableFields = editableModelFields(model);
  const relationModels = collectBelongsToDependencyModels(ir, model);
  const cleanupModels = orderModelsForCleanup(ir);
  const auxiliaryRepositoryModels = cleanupModels.filter((candidate) => candidate.name !== model.name);
  const imports = new Set<string>([
    `import com.fasterxml.jackson.databind.JsonNode;`,
    `import com.fasterxml.jackson.databind.ObjectMapper;`,
    `import ${ir.app.packageName}.domain.${model.name};`,
    `import ${ir.app.packageName}.dto.${model.name}Request;`,
    `import ${ir.app.packageName}.repository.${model.name}Repository;`,
    'import org.junit.jupiter.api.BeforeEach;',
    'import org.junit.jupiter.api.Test;',
    'import org.springframework.beans.factory.annotation.Autowired;',
    'import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;',
    'import org.springframework.boot.test.context.SpringBootTest;',
    'import org.springframework.http.MediaType;',
    'import org.springframework.test.web.servlet.MockMvc;',
    'import org.springframework.test.web.servlet.MvcResult;',
    'import static org.junit.jupiter.api.Assertions.assertEquals;',
    'import static org.junit.jupiter.api.Assertions.assertTrue;',
    'import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;',
    'import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;',
    'import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;',
    'import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;',
    'import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;',
  ]);
  if (nestedCreate) {
    imports.add(`import ${ir.app.packageName}.dto.${resourceCreateRequestClassName(resource)};`);
    for (const include of nestedCreate.includes) {
      imports.add(`import ${ir.app.packageName}.dto.${resourceCreateItemClassName(resource, include.fieldName)};`);
    }
    imports.add('import java.util.List;');
    imports.add('import java.util.Objects;');
  }
  if (nestedUpdate) {
    imports.add(`import ${ir.app.packageName}.dto.${resourceUpdateRequestClassName(resource)};`);
    for (const include of nestedUpdate.includes) {
      imports.add(`import ${ir.app.packageName}.dto.${resourceUpdateItemClassName(resource, include.fieldName)};`);
    }
    imports.add('import java.util.List;');
    imports.add('import java.util.Objects;');
  }

  if (resource.auth.mode === 'authenticated') {
    imports.add('import java.nio.charset.StandardCharsets;');
    imports.add('import java.util.Base64;');
  }

  for (const field of model.fields) {
    addJavaTypeImportsFromStatement(imports, ir.app.packageName, fieldJavaType(model, field));
  }
  for (const auxiliaryRepositoryModel of auxiliaryRepositoryModels) {
    imports.add(`import ${ir.app.packageName}.repository.${auxiliaryRepositoryModel.name}Repository;`);
  }
  for (const relationModel of relationModels) {
    imports.add(`import ${ir.app.packageName}.domain.${relationModel.name};`);
    for (const field of relationModel.fields) {
      addJavaTypeImportsFromStatement(imports, ir.app.packageName, fieldJavaType(relationModel, field));
    }
  }
  for (const include of nestedCreate?.includes ?? []) {
    imports.add(`import ${ir.app.packageName}.domain.${include.targetModel.name};`);
    for (const field of include.targetModel.fields) {
      addJavaTypeImportsFromStatement(imports, ir.app.packageName, fieldJavaType(include.targetModel, field));
    }
    imports.add('import org.springframework.http.HttpStatus;');
    imports.add('import org.springframework.web.server.ResponseStatusException;');
  }
  for (const include of nestedUpdate?.includes ?? []) {
    imports.add(`import ${ir.app.packageName}.domain.${include.targetModel.name};`);
    for (const field of include.targetModel.fields) {
      addJavaTypeImportsFromStatement(imports, ir.app.packageName, fieldJavaType(include.targetModel, field));
    }
  }
  if (model.fields.some((field) => field.fieldType.type === 'scalar' && field.fieldType.name === 'datetime')) {
    imports.add('import java.time.Duration;');
  }

  const methods: string[] = [];
  if (resource.operations.list) {
    methods.push(generateListIntegrationTest(resource, model));
  }
  if (resource.operations.get) {
    methods.push(generateGetIntegrationTest(resource, model));
  }
  if (resource.operations.create) {
    methods.push(generateCreateIntegrationTest(resource, model, createRequestClass));
  }
  if (resource.operations.update) {
    methods.push(generateUpdateIntegrationTest(
      resource,
      model,
      updateRequestClass,
      nestedUpdate ? 'secondaryRequest(entity)' : 'secondaryRequest()',
    ));
  }
  if (resource.operations.delete) {
    methods.push(generateDeleteIntegrationTest(resource, model));
  }

  const helperMethods = [
    ...relationModels.flatMap((relationModel) => [
      generateRelationSampleSeedMethod(relationModel, 'primary'),
      generateRelationSampleSeedMethod(relationModel, 'secondary'),
    ]),
    generatePrimaryRequestFactoryMethod(resource, model, nestedCreate),
    generateSecondaryRequestFactoryMethod(resource, model, nestedUpdate),
    generateSeedEntityMethod(resource, model, nestedCreate),
    generateApplyRequestMethod(resource, model, nestedCreate),
    generateAssertEntityMatchesRequestMethod(resource, model, nestedCreate, nestedUpdate),
    generateNestedUpdateIntegrationHelpers(model, nestedUpdate),
    generateAssertNodeMethod(model),
    resource.auth.mode === 'authenticated' ? generateAdminAuthorizationHeaderMethod() : '',
  ].filter(Boolean).join('\n');
  const auxiliaryRepositoryFields = auxiliaryRepositoryModels
    .map((relationModel) => `
  @Autowired
  private ${relationModel.name}Repository ${relationRepositoryFieldName(relationModel.name)};`)
    .join('');
  const relationSampleCacheFields = relationModels
    .flatMap((relationModel) => [
      `
  private ${relationModel.name} ${sampleSeedCacheFieldName(relationModel.name, 'primary')};`,
      `
  private ${relationModel.name} ${sampleSeedCacheFieldName(relationModel.name, 'secondary')};`,
    ])
    .join('');
  const resetLines = [
    ...cleanupModels.map((cleanupModel) => cleanupModel.name === model.name
      ? '    repository.deleteAll();'
      : `    ${relationRepositoryFieldName(cleanupModel.name)}.deleteAll();`),
    ...relationModels.flatMap((relationModel) => [
      `    ${sampleSeedCacheFieldName(relationModel.name, 'primary')} = null;`,
      `    ${sampleSeedCacheFieldName(relationModel.name, 'secondary')} = null;`,
    ]),
  ].join('\n');

  return `package ${ir.app.packageName}.controller;

${Array.from(imports).sort().join('\n')}

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.MOCK)
@AutoConfigureMockMvc
class ${toPascalCase(resource.name)}ControllerIntegrationTests {

  @Autowired
  private MockMvc mockMvc;

  @Autowired
  private ObjectMapper objectMapper;

  @Autowired
  private ${model.name}Repository repository;
${auxiliaryRepositoryFields}
${relationSampleCacheFields}

  @BeforeEach
  void resetDatabase() {
${resetLines}
  }
${methods.join('\n')}
${helperMethods}
}
`;
}

function generateEntity(ir: IRSdslProgram, model: IRModel): string {
  const persistedFields = persistedModelFields(model);
  const imports = new Set<string>([
    'jakarta.persistence.Column',
    'jakarta.persistence.Entity',
    'jakarta.persistence.FetchType',
    'jakarta.persistence.GeneratedValue',
    'jakarta.persistence.GenerationType',
    'jakarta.persistence.Id',
    'jakarta.persistence.JoinColumn',
    'jakarta.persistence.ManyToOne',
    'jakarta.persistence.Table',
  ]);
  const fields = persistedFields.map((field) => generateEntityField(model, field, imports));
  const accessors = persistedFields.flatMap((field) => generateEntityAccessors(model, field));
  const uniqueFields = persistedFields.filter((field) => hasDecorator(field, 'unique'));
  const auditFields = findAuditFields(model);

  if (uniqueFields.length > 0) {
    imports.add('jakarta.persistence.UniqueConstraint');
  }
  if (persistedFields.some((field) => field.fieldType.type === 'enum')) {
    imports.add('jakarta.persistence.EnumType');
    imports.add('jakarta.persistence.Enumerated');
  }
  if (auditFields.createdAt || auditFields.updatedAt) {
    imports.add('jakarta.persistence.PrePersist');
  }
  if (auditFields.updatedAt) {
    imports.add('jakarta.persistence.PreUpdate');
  }
  for (const field of persistedFields) {
    addJavaTypeImports(imports, fieldJavaType(model, field));
  }

  const tableName = safeTableName(model.name);
  const tableAnnotation = uniqueFields.length > 0
    ? `@Table(name = "${tableName}", uniqueConstraints = {\n  ${uniqueFields.map((field) => `@UniqueConstraint(columnNames = "${field.name}")`).join(',\n  ')}\n})`
    : `@Table(name = "${tableName}")`;

  const lifecycleMethods = generateEntityLifecycleMethods(auditFields);

  return `package ${ir.app.packageName}.domain;

${Array.from(imports).sort().map((entry) => `import ${entry};`).join('\n')}

@Entity
${tableAnnotation}
public class ${model.name} {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;
${fields.join('\n')}

  public Long getId() {
    return id;
  }

  public void setId(Long id) {
    this.id = id;
  }
${accessors.join('\n')}
${lifecycleMethods}
}
`;
}

function generateEntityField(model: IRModel, field: IRModelField, imports: Set<string>): string {
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    const joinParts: string[] = [`name = "${field.name}_id"`];
    if (hasDecorator(field, 'required')) {
      joinParts.push('nullable = false');
    }
    const typeName = fieldJavaType(model, field);
    addJavaTypeImports(imports, typeName);
    return `\n  @ManyToOne(fetch = FetchType.LAZY)\n  @JoinColumn(${joinParts.join(', ')})\n  private ${typeName} ${field.name};`;
  }

  const annotations: string[] = [];
  const columnParts: string[] = [];
  if (hasDecorator(field, 'required') || hasDecorator(field, 'createdAt') || hasDecorator(field, 'updatedAt')) {
    columnParts.push('nullable = false');
  }
  if (hasDecorator(field, 'unique')) {
    columnParts.push('unique = true');
  }
  if (hasDecorator(field, 'createdAt')) {
    columnParts.push('updatable = false');
  }
  if (field.fieldType.type === 'scalar' && field.fieldType.name === 'text') {
    columnParts.push('columnDefinition = "TEXT"');
  }
  if (field.fieldType.type === 'enum') {
    annotations.push('@Enumerated(EnumType.STRING)');
  }
  if (columnParts.length > 0) {
    annotations.push(`@Column(${columnParts.join(', ')})`);
  } else {
    annotations.push('@Column');
  }

  const typeName = fieldJavaType(model, field);
  addJavaTypeImports(imports, typeName);
  return `\n  ${annotations.join('\n  ')}
  private ${typeName} ${field.name};`;
}

function generateEntityAccessors(model: IRModel, field: IRModelField): string[] {
  const typeName = fieldJavaType(model, field);
  const accessor = toPascalCase(field.name);
  return [
    `
  public ${typeName} get${accessor}() {
    return ${field.name};
  }
`,
    `
  public void set${accessor}(${typeName} ${field.name}) {
    this.${field.name} = ${field.name};
  }
`,
  ];
}

function generateEntityLifecycleMethods(auditFields: { createdAt?: IRModelField; updatedAt?: IRModelField }): string {
  const lines: string[] = [];
  if (auditFields.createdAt || auditFields.updatedAt) {
    lines.push(`
  @PrePersist
  void prePersist() {`);
    if (auditFields.createdAt) {
      lines.push(`    if (this.${auditFields.createdAt.name} == null) {`);
      lines.push(`      this.${auditFields.createdAt.name} = java.time.Instant.now();`);
      lines.push('    }');
    }
    if (auditFields.updatedAt) {
      lines.push(`    this.${auditFields.updatedAt.name} = java.time.Instant.now();`);
    }
    lines.push('  }');
  }
  if (auditFields.updatedAt) {
    lines.push(`
  @PreUpdate
  void preUpdate() {
    this.${auditFields.updatedAt.name} = java.time.Instant.now();
  }`);
  }
  return lines.join('\n');
}

function generateEnum(ir: IRSdslProgram, model: IRModel, field: IRModelField): string {
  if (field.fieldType.type !== 'enum') {
    return '';
  }
  return `package ${ir.app.packageName}.domain;

public enum ${enumClassName(model.name, field.name)} {
  ${field.fieldType.values.join(', ')}
}
`;
}

function generateRequestDto(ir: IRSdslProgram, model: IRModel): string {
  const editableFields = editableModelFields(model);
  const imports = new Set<string>();
  const components = editableFields.map((field) => generateRequestComponent(ir, model, field, imports));
  return `package ${ir.app.packageName}.dto;

${renderImports(imports)}
public record ${model.name}Request(
${components.length > 0 ? components.join(',\n') : ''}
) {
}
`;
}

function generateResponseDto(ir: IRSdslProgram, model: IRModel): string {
  const persistedFields = persistedModelFields(model);
  const imports = new Set<string>();
  const components = [
    '  Long id',
    ...persistedFields.map((field) => {
      const typeName = responseJavaType(model, field);
      addJavaTypeImports(imports, typeName);
      addDomainTypeImport(imports, ir.app.packageName, typeName);
      return `  ${typeName} ${field.name}`;
    }),
  ];

  return `package ${ir.app.packageName}.dto;

${renderImports(imports)}
public record ${model.name}Response(
${components.join(',\n')}
) {
}
`;
}

function generateResourceCreateRequestDto(
  ir: IRSdslProgram,
  resource: IRResource,
  model: IRModel,
  includes: NestedCreateIncludeAnalysis[],
): string {
  const imports = new Set<string>(['java.util.List', 'jakarta.validation.Valid']);
  const rootComponents = editableModelFields(model).map((field) => generateRequestComponent(ir, model, field, imports));
  const includeComponents = includes.map((include) => {
    imports.add(`${ir.app.packageName}.dto.${resourceCreateItemClassName(resource, include.fieldName)}`);
    return `  @Valid List<${resourceCreateItemClassName(resource, include.fieldName)}> ${include.fieldName}`;
  });
  const components = [...rootComponents, ...includeComponents];
  const declaration = components.length > 0
    ? `public record ${resourceCreateRequestClassName(resource)}(\n${components.join(',\n')}\n) {\n}`
    : `public record ${resourceCreateRequestClassName(resource)}() {\n}`;
  return `package ${ir.app.packageName}.dto;

${renderImports(imports)}${declaration}
`;
}

function generateResourceCreateItemDto(
  ir: IRSdslProgram,
  resource: IRResource,
  include: NestedCreateIncludeAnalysis,
): string {
  const imports = new Set<string>();
  const components = include.childFields.map((field) => generateRequestComponent(ir, include.targetModel, field, imports));
  const declaration = components.length > 0
    ? `public record ${resourceCreateItemClassName(resource, include.fieldName)}(\n${components.join(',\n')}\n) {\n}`
    : `public record ${resourceCreateItemClassName(resource, include.fieldName)}() {\n}`;
  return `package ${ir.app.packageName}.dto;

${renderImports(imports)}${declaration}
`;
}

function generateResourceUpdateRequestDto(
  ir: IRSdslProgram,
  resource: IRResource,
  model: IRModel,
  includes: NestedCreateIncludeAnalysis[],
): string {
  const imports = new Set<string>(['java.util.List', 'jakarta.validation.Valid']);
  const rootComponents = editableModelFields(model).map((field) => generateRequestComponent(ir, model, field, imports));
  const includeComponents = includes.map((include) => {
    imports.add(`${ir.app.packageName}.dto.${resourceUpdateItemClassName(resource, include.fieldName)}`);
    return `  @Valid List<${resourceUpdateItemClassName(resource, include.fieldName)}> ${include.fieldName}`;
  });
  const components = [...rootComponents, ...includeComponents];
  const declaration = components.length > 0
    ? `public record ${resourceUpdateRequestClassName(resource)}(\n${components.join(',\n')}\n) {\n}`
    : `public record ${resourceUpdateRequestClassName(resource)}() {\n}`;
  return `package ${ir.app.packageName}.dto;

${renderImports(imports)}${declaration}
`;
}

function generateResourceUpdateItemDto(
  ir: IRSdslProgram,
  resource: IRResource,
  include: NestedCreateIncludeAnalysis,
): string {
  const imports = new Set<string>();
  const components = ['  Long id', ...include.childFields.map((field) => generateRequestComponent(ir, include.targetModel, field, imports))];
  const declaration = components.length > 0
    ? `public record ${resourceUpdateItemClassName(resource, include.fieldName)}(\n${components.join(',\n')}\n) {\n}`
    : `public record ${resourceUpdateItemClassName(resource, include.fieldName)}() {\n}`;
  return `package ${ir.app.packageName}.dto;

${renderImports(imports)}${declaration}
`;
}

function generateRepository(ir: IRSdslProgram, model: IRModel): string {
  return `package ${ir.app.packageName}.repository;

import ${ir.app.packageName}.domain.${model.name};
import org.springframework.data.jpa.repository.JpaRepository;

public interface ${model.name}Repository extends JpaRepository<${model.name}, Long> {
}
`;
}

function generateService(ir: IRSdslProgram, model: IRModel): string {
  const nestedCreateResources = ir.resources
    .filter((resource) => resource.model === model.name)
    .map((resource) => analyzeNestedCreateResource(ir, resource, model))
    .filter((entry): entry is NestedCreateResourceAnalysis => Boolean(entry));
  const workflowResources = ir.resources
    .filter((resource): resource is IRResource & { workflow: NonNullable<IRResource['workflow']> } => (
      resource.model === model.name && Boolean(resource.workflow)
    ));
  const nestedUpdateResources = ir.resources
    .map((resource) => analyzeNestedUpdateResource(ir, resource, model))
    .filter((entry): entry is NestedUpdateResourceAnalysis => Boolean(entry));
  const imports = new Set<string>([
    `import ${ir.app.packageName}.domain.${model.name};`,
    `import ${ir.app.packageName}.dto.${model.name}Request;`,
    `import ${ir.app.packageName}.dto.${model.name}Response;`,
    `import ${ir.app.packageName}.repository.${model.name}Repository;`,
    'import java.util.List;',
    'import org.springframework.http.HttpStatus;',
    'import org.springframework.stereotype.Service;',
    'import org.springframework.web.server.ResponseStatusException;',
  ]);
  if (nestedCreateResources.length > 0 || nestedUpdateResources.length > 0) {
    imports.add('import jakarta.transaction.Transactional;');
  }
  if (nestedCreateResources.length > 0) {
    imports.add('import java.util.Objects;');
  }
  if (nestedUpdateResources.length > 0) {
    imports.add('import java.util.Map;');
    imports.add('import java.util.Objects;');
    imports.add('import java.util.function.Function;');
    imports.add('import java.util.stream.Collectors;');
  }

  const relationFields = editableModelFields(model)
    .filter((field): field is IRModelField & { fieldType: { type: 'relation'; kind: 'belongsTo'; target: string } } =>
      field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo');
  const repositoryTargets = new Set(relationFields.map((field) => field.fieldType.target));
  const persistedFields = persistedModelFields(model);

  for (const field of persistedFields) {
    const typeName = fieldJavaType(model, field);
    addJavaTypeImportsFromStatement(imports, ir.app.packageName, typeName);
  }

  for (const nestedResource of nestedCreateResources) {
    imports.add(`import ${ir.app.packageName}.dto.${resourceCreateRequestClassName(nestedResource.resource)};`);
    for (const include of nestedResource.includes) {
      repositoryTargets.add(include.targetModel.name);
      imports.add(`import ${ir.app.packageName}.domain.${include.targetModel.name};`);
      imports.add(`import ${ir.app.packageName}.dto.${resourceCreateItemClassName(nestedResource.resource, include.fieldName)};`);
      for (const field of include.childFields) {
        if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
          repositoryTargets.add(field.fieldType.target);
        }
      }
    }
  }
  for (const nestedResource of nestedUpdateResources) {
    imports.add(`import ${ir.app.packageName}.dto.${resourceUpdateRequestClassName(nestedResource.resource)};`);
    for (const include of nestedResource.includes) {
      repositoryTargets.add(include.targetModel.name);
      imports.add(`import ${ir.app.packageName}.domain.${include.targetModel.name};`);
      imports.add(`import ${ir.app.packageName}.dto.${resourceUpdateItemClassName(nestedResource.resource, include.fieldName)};`);
      for (const field of include.childFields) {
        if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
          repositoryTargets.add(field.fieldType.target);
        }
      }
    }
  }

  for (const relationTarget of repositoryTargets) {
    imports.add(`import ${ir.app.packageName}.repository.${relationTarget}Repository;`);
  }

  const editableFields = editableModelFields(model);
  const applyLines = editableFields.map((field) => springRequestAssignmentLine(model, field, 'request'));
  const responseArgs = ['entity.getId()', ...persistedFields.map((field) => responseFieldExpression(model, field))];
  const uniqueRelationTargets = [...repositoryTargets];
  const relationRepositoryFields = uniqueRelationTargets.map((target) => `  private final ${target}Repository ${relationRepositoryFieldName(target)};`);
  const constructorArgs = [
    `${model.name}Repository repository`,
    ...uniqueRelationTargets.map((target) => `${target}Repository ${relationRepositoryFieldName(target)}`),
  ];
  const constructorAssignments = [
    '    this.repository = repository;',
    ...uniqueRelationTargets.map((target) => `    this.${relationRepositoryFieldName(target)} = ${relationRepositoryFieldName(target)};`),
  ];

  const nestedCreateMethods = nestedCreateResources.map((nestedResource) => generateNestedCreateServiceMethod(model, nestedResource)).join('\n');
  const nestedCreateHelpers = nestedCreateResources.map((nestedResource) => generateNestedCreateServiceHelpers(model, nestedResource)).join('\n');
  const nestedUpdateMethods = nestedUpdateResources.map((nestedResource) => generateNestedUpdateServiceMethod(model, nestedResource)).join('\n');
  const nestedUpdateHelpers = nestedUpdateResources.map((nestedResource) => generateNestedUpdateServiceHelpers(model, nestedResource)).join('\n');
  const nestedDeleteHelpers = generateNestedDeleteServiceHelpers(model, nestedCreateResources, nestedUpdateResources);
  const hasNestedDeleteHelpers = nestedDeleteHelpers.trim().length > 0;
  const workflowMethods = workflowResources.map((resource) => generateWorkflowServiceMethods(
    model,
    resource,
    nestedCreateResources.find((entry) => entry.resource.id === resource.id) ?? null,
    nestedUpdateResources.find((entry) => entry.resource.id === resource.id) ?? null,
  )).join('\n');

  return `package ${ir.app.packageName}.service;

${Array.from(imports).sort().join('\n')}

@Service
public class ${model.name}Service {

  private final ${model.name}Repository repository;
${relationRepositoryFields.length > 0 ? `${relationRepositoryFields.join('\n')}\n` : ''}

  public ${model.name}Service(${constructorArgs.join(', ')}) {
${constructorAssignments.join('\n')}
  }

  public List<${model.name}Response> list() {
    return repository.findAll().stream()
      .map(this::toResponse)
      .toList();
  }

  public ${model.name}Response get(Long id) {
    return toResponse(findEntity(id));
  }

  public ${model.name}Response create(${model.name}Request request) {
    ${model.name} entity = new ${model.name}();
    applyRequest(entity, request);
    return toResponse(repository.save(entity));
  }
${nestedCreateMethods ? `\n${nestedCreateMethods}` : ''}
${nestedUpdateMethods ? `\n${nestedUpdateMethods}` : ''}
${workflowMethods ? `\n${workflowMethods}` : ''}

  public ${model.name}Response update(Long id, ${model.name}Request request) {
    ${model.name} entity = findEntity(id);
    applyRequest(entity, request);
    return toResponse(repository.save(entity));
  }

  public void delete(Long id) {
    ${model.name} entity = findEntity(id);
${hasNestedDeleteHelpers ? `    deleteNestedChildren(entity);\n` : ''}    repository.delete(entity);
  }

  private ${model.name} findEntity(Long id) {
    return repository.findById(id)
      .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "${model.name} not found"));
  }

  private void applyRequest(${model.name} entity, ${model.name}Request request) {
${applyLines.length > 0 ? applyLines.join('\n') : '    // No editable fields in v0.1'}
  }
${nestedCreateHelpers ? `\n${nestedCreateHelpers}` : ''}
${nestedUpdateHelpers ? `\n${nestedUpdateHelpers}` : ''}
${nestedDeleteHelpers ? `\n${nestedDeleteHelpers}` : ''}

  private ${model.name}Response toResponse(${model.name} entity) {
    return new ${model.name}Response(${responseArgs.join(', ')});
  }
}
`;
}

function generateController(ir: IRSdslProgram, resource: IRResource, model: IRModel): string {
  const preAuthorize = buildPreAuthorize(resource);
  const hasPolicy = Boolean(resource.auth.policy);
  const hasRulesPolicy = resource.auth.policy?.source === 'rules';
  const hasCreateRules = Boolean(resource.create?.rules);
  const hasWorkflow = Boolean(resource.workflow);
  const nestedCreate = analyzeNestedCreateResource(ir, resource, model);
  const nestedUpdate = analyzeNestedUpdateResource(ir, resource, model);
  const createRequestClass = nestedCreate ? resourceCreateRequestClassName(resource) : `${model.name}Request`;
  const updateRequestClass = nestedUpdate ? resourceUpdateRequestClassName(resource) : `${model.name}Request`;
  const createServiceMethod = hasWorkflow
    ? `${workflowCreateServiceMethodName(resource)}(request)`
    : nestedCreate
      ? `${serviceCreateMethodName(resource)}(request)`
      : `create(request)`;
  const updateServiceMethod = hasWorkflow
    ? `${workflowUpdateServiceMethodName(resource)}(id, request)`
    : nestedUpdate
      ? `${serviceUpdateMethodName(resource)}(id, request)`
      : `update(id, request)`;
  const imports = [
    `import ${ir.app.packageName}.api.ItemEnvelope;`,
    `import ${ir.app.packageName}.api.ListEnvelope;`,
    `import ${ir.app.packageName}.dto.${model.name}Request;`,
    `import ${ir.app.packageName}.dto.${model.name}Response;`,
    `import ${ir.app.packageName}.security.PolicyPrincipal;`,
    `import ${ir.app.packageName}.service.${model.name}Service;`,
    'import jakarta.validation.Valid;',
    'import java.util.List;',
    'import java.util.LinkedHashMap;',
    'import java.util.Map;',
    'import org.springframework.http.HttpStatus;',
    'import org.springframework.security.core.Authentication;',
    'import org.springframework.validation.annotation.Validated;',
    'import org.springframework.web.bind.annotation.DeleteMapping;',
    'import org.springframework.web.bind.annotation.GetMapping;',
    'import org.springframework.web.bind.annotation.PathVariable;',
    'import org.springframework.web.bind.annotation.PostMapping;',
    'import org.springframework.web.bind.annotation.PutMapping;',
    'import org.springframework.web.bind.annotation.RequestBody;',
    'import org.springframework.web.bind.annotation.RequestMapping;',
    'import org.springframework.web.bind.annotation.ResponseStatus;',
    'import org.springframework.web.bind.annotation.RestController;',
    'import org.springframework.web.server.ResponseStatusException;',
  ];
  if (nestedCreate) {
    imports.push(`import ${ir.app.packageName}.dto.${resourceCreateRequestClassName(resource)};`);
  }
  if (nestedUpdate) {
    imports.push(`import ${ir.app.packageName}.dto.${resourceUpdateRequestClassName(resource)};`);
  }
  if (hasPolicy) {
    imports.push(`import ${ir.app.packageName}.security.${policyClassName(resource)};`);
  }
  if (hasCreateRules) {
    imports.push(`import ${ir.app.packageName}.rules.${resourceCreateRulesClassName(resource)};`);
  }
  if (hasWorkflow) {
    imports.push(`import ${ir.app.packageName}.workflow.${resourceWorkflowClassName(resource)};`);
  }
  if (preAuthorize) {
    imports.push('import org.springframework.security.access.prepost.PreAuthorize;');
  }

  const methods: string[] = [];
  if (resource.operations.list) {
    methods.push(`
  @GetMapping
  public ListEnvelope<${model.name}Response> list(Authentication authentication) {
${hasRulesPolicy
    ? `    PolicyPrincipal principal = PolicyPrincipal.fromAuthentication(authentication);
    List<${model.name}Response> items = policy.filterList(principal, service.list());
    if (items.isEmpty() && !policy.allowList(principal)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, policy.deniedMessage("list", principal, Map.of(), null, null));
    }
    return new ListEnvelope<>(items);`
    : hasPolicy
      ? `    enforcePolicy("list", Map.of(), null, authentication);
    return new ListEnvelope<>(service.list());`
      : '    return new ListEnvelope<>(service.list());'}
  }`);
  }
  if (resource.operations.get) {
    methods.push(`
  @GetMapping("/{id}")
  public ItemEnvelope<${model.name}Response> get(@PathVariable Long id, Authentication authentication) {
${hasRulesPolicy
    ? `    PolicyPrincipal principal = PolicyPrincipal.fromAuthentication(authentication);
    ${model.name}Response item = service.get(id);
    enforcePolicy("get", Map.of("id", String.valueOf(id)), null, item, principal);
    return new ItemEnvelope<>(item);`
    : hasPolicy
      ? `    enforcePolicy("get", Map.of("id", String.valueOf(id)), null, authentication);
    return new ItemEnvelope<>(service.get(id));`
      : `    return new ItemEnvelope<>(service.get(id));`}
  }`);
  }
  if (resource.operations.create) {
    methods.push(`
  @PostMapping
  @ResponseStatus(HttpStatus.CREATED)
  public ItemEnvelope<${model.name}Response> create(@Valid @RequestBody ${createRequestClass} request, Authentication authentication) {
${hasRulesPolicy
    ? `    PolicyPrincipal principal = PolicyPrincipal.fromAuthentication(authentication);
    enforcePolicy("create", Map.of(), requestToPolicyPayload(request), null, principal);
${hasCreateRules ? '    enforceCreateRules(principal, Map.of(), request);\n' : ''}    return new ItemEnvelope<>(service.${createServiceMethod});`
    : hasPolicy
      ? `    enforcePolicy("create", Map.of(), requestToPolicyPayload(request), authentication);
${hasCreateRules ? '    enforceCreateRules(PolicyPrincipal.fromAuthentication(authentication), Map.of(), request);\n' : ''}    return new ItemEnvelope<>(service.${createServiceMethod});`
      : hasCreateRules
        ? `    enforceCreateRules(PolicyPrincipal.fromAuthentication(authentication), Map.of(), request);
    return new ItemEnvelope<>(service.${createServiceMethod});`
        : `    return new ItemEnvelope<>(service.${createServiceMethod});`}
  }`);
  }
  if (resource.operations.update) {
    methods.push(`
  @PutMapping("/{id}")
  public ItemEnvelope<${model.name}Response> update(@PathVariable Long id, @Valid @RequestBody ${updateRequestClass} request, Authentication authentication) {
${hasRulesPolicy
    ? `    PolicyPrincipal principal = PolicyPrincipal.fromAuthentication(authentication);
    ${model.name}Response current = service.get(id);
    enforcePolicy("update", Map.of("id", String.valueOf(id)), requestToPolicyPayload(request), current, principal);
    return new ItemEnvelope<>(service.${updateServiceMethod});`
    : hasPolicy
      ? `    enforcePolicy("update", Map.of("id", String.valueOf(id)), requestToPolicyPayload(request), authentication);
    return new ItemEnvelope<>(service.${updateServiceMethod});`
      : `    return new ItemEnvelope<>(service.${updateServiceMethod});`}
  }`);
  }
  if (resource.operations.delete) {
    methods.push(`
  @DeleteMapping("/{id}")
  @ResponseStatus(HttpStatus.NO_CONTENT)
  public void delete(@PathVariable Long id, Authentication authentication) {
${hasRulesPolicy
    ? `    PolicyPrincipal principal = PolicyPrincipal.fromAuthentication(authentication);
    ${model.name}Response current = service.get(id);
    enforcePolicy("delete", Map.of("id", String.valueOf(id)), null, current, principal);
    service.delete(id);`
    : hasPolicy
      ? `    enforcePolicy("delete", Map.of("id", String.valueOf(id)), null, authentication);
    service.delete(id);`
      : '    service.delete(id);'}
  }`);
  }
  if (hasWorkflow) {
    methods.push(`
  @PostMapping("/{id}/transitions/{transition}")
  public ItemEnvelope<${model.name}Response> transition(@PathVariable Long id, @PathVariable String transition, Authentication authentication) {
    PolicyPrincipal principal = PolicyPrincipal.fromAuthentication(authentication);
    ${model.name}Response current = service.get(id);
    ${resourceWorkflowClassName(resource)}.TransitionDecision decision = workflow.decide(transition, principal, current);
    if (!decision.allowed()) {
      throw new ResponseStatusException(decision.status(), decision.message());
    }
${hasRulesPolicy
    ? `    enforcePolicy("update", Map.of("id", String.valueOf(id)), transitionToPolicyPayload(decision.targetState()), current, principal);
    return new ItemEnvelope<>(service.${workflowTransitionServiceMethodName(resource)}(id, decision.targetState()));`
    : hasPolicy
      ? `    enforcePolicy("update", Map.of("id", String.valueOf(id)), transitionToPolicyPayload(decision.targetState()), authentication);
    return new ItemEnvelope<>(service.${workflowTransitionServiceMethodName(resource)}(id, decision.targetState()));`
      : `    return new ItemEnvelope<>(service.${workflowTransitionServiceMethodName(resource)}(id, decision.targetState()));`}
  }`);
  }

  return `package ${ir.app.packageName}.controller;

${imports.sort().join('\n')}

@RestController
@Validated
@RequestMapping("${resource.api}")
${preAuthorize ? `${preAuthorize}\n` : ''}public class ${toPascalCase(resource.name)}Controller {

  private final ${model.name}Service service;
${hasPolicy ? `  private final ${policyClassName(resource)} policy;\n` : ''}${hasCreateRules ? `  private final ${resourceCreateRulesClassName(resource)} createRules;\n` : ''}${hasWorkflow ? `  private final ${resourceWorkflowClassName(resource)} workflow;\n` : ''}

  public ${toPascalCase(resource.name)}Controller(${model.name}Service service${hasPolicy ? `, ${policyClassName(resource)} policy` : ''}${hasCreateRules ? `, ${resourceCreateRulesClassName(resource)} createRules` : ''}${hasWorkflow ? `, ${resourceWorkflowClassName(resource)} workflow` : ''}) {
    this.service = service;
${hasPolicy ? '    this.policy = policy;\n' : ''}${hasCreateRules ? '    this.createRules = createRules;\n' : ''}${hasWorkflow ? '    this.workflow = workflow;\n' : ''}  }
${hasPolicy && !hasRulesPolicy ? `
  private void enforcePolicy(String operation, Map<String, String> params, Map<String, Object> payload, Authentication authentication) {
    if (!policy.allow(PolicyPrincipal.fromAuthentication(authentication), operation, params, payload)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, "Forbidden");
    }
  }
` : ''}
${hasRulesPolicy ? `
  private void enforcePolicy(String operation, Map<String, String> params, Map<String, Object> payload, Object record, PolicyPrincipal principal) {
    if (!policy.allow(operation, principal, params, payload, record)) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, policy.deniedMessage(operation, principal, params, payload, record));
    }
  }
` : ''}
${hasCreateRules ? `
  private void enforceCreateRules(PolicyPrincipal principal, Map<String, String> params, ${createRequestClass} request) {
    String eligibilityFailure = createRules.firstEligibilityFailure(principal, params, request);
    if (eligibilityFailure != null) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, eligibilityFailure);
    }
    String validationFailure = createRules.firstValidationFailure(principal, params, request);
    if (validationFailure != null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, validationFailure);
    }
  }
` : ''}

${hasPolicy ? `
  private Map<String, Object> requestToPolicyPayload(${model.name}Request request) {
    Map<String, Object> payload = new LinkedHashMap<>();
${editableModelFields(model).map((field) => `    payload.put("${field.name}", request.${field.name}());`).join('\n')}
    return payload;
  }
` : ''}
${hasPolicy && nestedCreate ? `
  private Map<String, Object> requestToPolicyPayload(${resourceCreateRequestClassName(resource)} request) {
    Map<String, Object> payload = new LinkedHashMap<>();
${editableModelFields(model).map((field) => `    payload.put("${field.name}", request.${field.name}());`).join('\n')}
${nestedCreate.includes.map((include) => `    payload.put("${include.fieldName}", request.${include.fieldName}());`).join('\n')}
    return payload;
  }
` : ''}
${hasPolicy && nestedUpdate ? `
  private Map<String, Object> requestToPolicyPayload(${resourceUpdateRequestClassName(resource)} request) {
    Map<String, Object> payload = new LinkedHashMap<>();
${editableModelFields(model).map((field) => `    payload.put("${field.name}", request.${field.name}());`).join('\n')}
${nestedUpdate.includes.map((include) => `    payload.put("${include.fieldName}", request.${include.fieldName}());`).join('\n')}
    return payload;
  }
` : ''}
${hasPolicy && hasWorkflow ? `
  private Map<String, Object> transitionToPolicyPayload(String targetState) {
    Map<String, Object> payload = new LinkedHashMap<>();
    payload.put("${resource.workflow!.program.field}", targetState);
    return payload;
  }
` : ''}
${methods.join('\n')}
}
`;
}

function generateReadModelInputDto(ir: IRSdslProgram, readModel: IRReadModel): string {
  const imports = new Set<string>();
  const components = readModel.inputs.map((field) => generateReadModelDtoComponent(field, imports));
  const declaration = components.length > 0
    ? `public record ${readModelInputClassName(readModel)}(\n${components.join(',\n')}\n) {\n}`
    : `public record ${readModelInputClassName(readModel)}() {\n}`;
  return `package ${ir.app.packageName}.dto;

${Array.from(imports).sort().join('\n')}${imports.size > 0 ? '\n\n' : '\n'}${declaration}
`;
}

function generateReadModelResultDto(ir: IRSdslProgram, readModel: IRReadModel): string {
  const imports = new Set<string>();
  const components = readModel.result.map((field) => generateReadModelDtoComponent(field, imports));
  return `package ${ir.app.packageName}.dto;

${Array.from(imports).sort().join('\n')}${imports.size > 0 ? '\n\n' : '\n'}public record ${readModelResultClassName(readModel)}(
${components.join(',\n')}
) {
}
`;
}

function generateReadModelHandler(
  ir: IRSdslProgram,
  readModel: IRReadModel,
  readFile?: (fileName: string) => string,
): string {
  if (readModel.handler.source === 'sql') {
    return generateSqlReadModelHandler(ir, readModel, readFile);
  }
  const imports = new Set<string>([
    `import ${ir.app.packageName}.dto.${readModelInputClassName(readModel)};`,
    `import ${ir.app.packageName}.dto.${readModelResultClassName(readModel)};`,
    `import ${ir.app.packageName}.security.PolicyPrincipal;`,
    'import jakarta.persistence.EntityManager;',
    'import java.util.List;',
    'import org.springframework.stereotype.Component;',
  ]);
  const repositoryImports = ir.models.map((model) => `${ir.app.packageName}.repository.${model.name}Repository`);
  for (const repositoryImport of repositoryImports) {
    imports.add(`import ${repositoryImport};`);
  }
  for (const field of [...readModel.inputs, ...readModel.result]) {
    addReadModelJavaTypeImports(imports, readModelJavaType(field));
  }
  const repositoryFields = ir.models.map((model) => `  private final ${model.name}Repository ${relationRepositoryFieldName(model.name)};`);
  const constructorArgs = [
    'EntityManager entityManager',
    ...ir.models.map((model) => `${model.name}Repository ${relationRepositoryFieldName(model.name)}`),
  ];
  const constructorAssignments = [
    '    this.entityManager = entityManager;',
    ...ir.models.map((model) => `    this.${relationRepositoryFieldName(model.name)} = ${relationRepositoryFieldName(model.name)};`),
  ];
  const snippet = readBackendSnippetFromResolvedPath(readModel.handler, readFile, 'return List.of();');

  return `package ${ir.app.packageName}.readmodel;

${Array.from(imports).sort().join('\n')}

@Component
public class ${readModelHandlerClassName(readModel)} {

  private final EntityManager entityManager;
${repositoryFields.length > 0 ? `${repositoryFields.join('\n')}\n` : ''}

  public ${readModelHandlerClassName(readModel)}(${constructorArgs.join(', ')}) {
${constructorAssignments.join('\n')}
  }

  public List<${readModelResultClassName(readModel)}> execute(${readModelInputClassName(readModel)} input, PolicyPrincipal principal) {
${indentSnippet(snippet, '    ')}
  }
}
`;
}

function generateSqlReadModelHandler(
  ir: IRSdslProgram,
  readModel: IRReadModel,
  readFile?: (fileName: string) => string,
): string {
  const imports = new Set<string>([
    `import ${ir.app.packageName}.dto.${readModelInputClassName(readModel)};`,
    `import ${ir.app.packageName}.dto.${readModelResultClassName(readModel)};`,
    `import ${ir.app.packageName}.security.PolicyPrincipal;`,
    'import java.sql.ResultSet;',
    'import java.sql.SQLException;',
    'import java.util.List;',
    'import org.springframework.jdbc.core.namedparam.MapSqlParameterSource;',
    'import org.springframework.jdbc.core.namedparam.NamedParameterJdbcTemplate;',
    'import org.springframework.stereotype.Component;',
  ]);
  for (const field of [...readModel.inputs, ...readModel.result]) {
    addReadModelJavaTypeImports(imports, readModelJavaType(field));
  }
  const sqlSource = readSqlSourceFromResolvedPath(readModel.handler, readFile, 'select 1');
  const parameterAssignments = readModel.inputs.map((field) => `    params.addValue("${field.name}", input.${field.name}());`);
  const resultExpressions = readModel.result.map((field) => `      ${readModelSqlJavaResultExpression(field)}`);
  const helperMethods = readModel.result.some((field) => readModelJavaType(field) === 'Instant')
    ? `

  private Instant readInstantColumn(ResultSet rs, String columnName) throws SQLException {
    java.sql.Timestamp timestamp = rs.getTimestamp(columnName);
    return timestamp == null ? null : timestamp.toInstant();
  }
`
    : '';
  return `package ${ir.app.packageName}.readmodel;

${Array.from(imports).sort().join('\n')}

@Component
public class ${readModelHandlerClassName(readModel)} {

  private final NamedParameterJdbcTemplate jdbcTemplate;

  public ${readModelHandlerClassName(readModel)}(NamedParameterJdbcTemplate jdbcTemplate) {
    this.jdbcTemplate = jdbcTemplate;
  }

  public List<${readModelResultClassName(readModel)}> execute(${readModelInputClassName(readModel)} input, PolicyPrincipal principal) {
    String sql = """
${escapeJavaTextBlock(sqlSource)}
""";
    MapSqlParameterSource params = new MapSqlParameterSource();
${parameterAssignments.length > 0 ? `${parameterAssignments.join('\n')}\n` : ''}    return jdbcTemplate.query(sql, params, (rs, rowNum) -> new ${readModelResultClassName(readModel)}(
${resultExpressions.join(',\n')}
    ));
  }${helperMethods}
}
`;
}

function generateReadModelController(ir: IRSdslProgram, readModel: IRReadModel): string {
  const preAuthorize = buildPreAuthorize(readModel);
  const hasRules = Boolean(readModel.rules);
  const imports = new Set<string>([
    `import ${ir.app.packageName}.api.ListEnvelope;`,
    `import ${ir.app.packageName}.dto.${readModelInputClassName(readModel)};`,
    `import ${ir.app.packageName}.dto.${readModelResultClassName(readModel)};`,
    `import ${ir.app.packageName}.readmodel.${readModelHandlerClassName(readModel)};`,
    `import ${ir.app.packageName}.security.PolicyPrincipal;`,
    'import org.springframework.http.HttpStatus;',
    'import org.springframework.security.core.Authentication;',
    'import org.springframework.validation.annotation.Validated;',
    'import org.springframework.web.bind.annotation.GetMapping;',
    'import org.springframework.web.bind.annotation.RequestMapping;',
    'import org.springframework.web.bind.annotation.RequestParam;',
    'import org.springframework.web.bind.annotation.RestController;',
    'import org.springframework.web.server.ResponseStatusException;',
  ]);
  if (hasRules) {
    imports.add(`import ${ir.app.packageName}.rules.${readModelRulesClassName(readModel)};`);
  }
  if (preAuthorize) {
    imports.add('import org.springframework.security.access.prepost.PreAuthorize;');
  }
  const requestParams = readModel.inputs.map((field) => generateReadModelRequestParameter(field, imports));
  const methodArgs = [...requestParams, 'Authentication authentication'];
  const inputCtorArgs = readModel.inputs.map((field) => field.name).join(', ');

  return `package ${ir.app.packageName}.controller;

${Array.from(imports).sort().join('\n')}

@RestController
@Validated
@RequestMapping("${readModel.api}")
${preAuthorize ? `${preAuthorize}\n` : ''}public class ${readModelControllerClassName(readModel)} {

  private final ${readModelHandlerClassName(readModel)} handler;
${hasRules ? `  private final ${readModelRulesClassName(readModel)} rules;\n` : ''}

  public ${readModelControllerClassName(readModel)}(${readModelHandlerClassName(readModel)} handler${hasRules ? `, ${readModelRulesClassName(readModel)} rules` : ''}) {
    this.handler = handler;
${hasRules ? '    this.rules = rules;\n' : ''}  }

${hasRules ? `
  private void enforceEligibility(${readModelInputClassName(readModel)} input, PolicyPrincipal principal) {
    String message = rules.firstEligibilityFailure(input, principal);
    if (message != null) {
      throw new ResponseStatusException(HttpStatus.FORBIDDEN, message);
    }
  }

  private void enforceValidation(${readModelInputClassName(readModel)} input, PolicyPrincipal principal) {
    String message = rules.firstValidationFailure(input, principal);
    if (message != null) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
  }
` : ''}

  @GetMapping
  public ListEnvelope<${readModelResultClassName(readModel)}> run(${methodArgs.join(', ')}) {
    ${readModelInputClassName(readModel)} input = new ${readModelInputClassName(readModel)}(${inputCtorArgs});
    PolicyPrincipal principal = PolicyPrincipal.fromAuthentication(authentication);
${hasRules ? `    enforceEligibility(input, principal);
    enforceValidation(input, principal);
    return new ListEnvelope<>(rules.applyDerivations(input, principal, handler.execute(input, principal)));` : '    return new ListEnvelope<>(handler.execute(input, principal));'}
  }
}
`;
}

function policyClassName(resource: IRResource): string {
  return `${toPascalCase(resource.name)}Policy`;
}

function resourceCreateRulesClassName(resource: IRResource): string {
  return `${toPascalCase(resource.name)}CreateRules`;
}

function resourceWorkflowClassName(resource: IRResource): string {
  return `${toPascalCase(resource.name)}Workflow`;
}

function workflowCreateServiceMethodName(resource: IRResource): string {
  return `create${toPascalCase(resource.name)}WithWorkflow`;
}

function workflowUpdateServiceMethodName(resource: IRResource): string {
  return `update${toPascalCase(resource.name)}WithWorkflow`;
}

function workflowTransitionServiceMethodName(resource: IRResource): string {
  return `transition${toPascalCase(resource.name)}`;
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

function generateWorkflowServiceMethods(
  model: IRModel,
  resource: IRResource & { workflow: NonNullable<IRResource['workflow']> },
  nestedCreate: NestedCreateResourceAnalysis | null,
  nestedUpdate: NestedUpdateResourceAnalysis | null,
): string {
  const stateField = workflowStateField(model, resource);
  const stateEnum = enumClassName(model.name, stateField.name);
  const stateAccessor = toPascalCase(stateField.name);
  const initialState = workflowInitialState(resource);

  const createMethod = nestedCreate
    ? `
  @Transactional
  public ${model.name}Response ${workflowCreateServiceMethodName(resource)}(${resourceCreateRequestClassName(resource)} request) {
    ${model.name} entity = new ${model.name}();
    apply${toPascalCase(resource.name)}CreateRequest(entity, request);
    entity.set${stateAccessor}(${stateEnum}.${initialState});
    entity = repository.save(entity);
${nestedCreate.includes.map((include) => `    persist${toPascalCase(resource.name)}${toPascalCase(include.fieldName)}Items(entity, request.${include.fieldName}());`).join('\n')}
    return toResponse(entity);
  }
`
    : `
  public ${model.name}Response ${workflowCreateServiceMethodName(resource)}(${model.name}Request request) {
    ${model.name} entity = new ${model.name}();
    applyRequest(entity, request);
    entity.set${stateAccessor}(${stateEnum}.${initialState});
    return toResponse(repository.save(entity));
  }
`;

  const updateMethod = nestedUpdate
    ? `
  @Transactional
  public ${model.name}Response ${workflowUpdateServiceMethodName(resource)}(Long id, ${resourceUpdateRequestClassName(resource)} request) {
    ${model.name} entity = findEntity(id);
    ${stateEnum} currentState = entity.get${stateAccessor}();
    apply${toPascalCase(resource.name)}UpdateRequest(entity, request);
${nestedUpdate.includes.map((include) => `    sync${toPascalCase(resource.name)}${toPascalCase(include.fieldName)}Items(entity, request.${include.fieldName}());`).join('\n')}
    entity.set${stateAccessor}(currentState);
    return toResponse(repository.save(entity));
  }
`
    : `
  public ${model.name}Response ${workflowUpdateServiceMethodName(resource)}(Long id, ${model.name}Request request) {
    ${model.name} entity = findEntity(id);
    ${stateEnum} currentState = entity.get${stateAccessor}();
    applyRequest(entity, request);
    entity.set${stateAccessor}(currentState);
    return toResponse(repository.save(entity));
  }
`;

  return `${createMethod}
${updateMethod}

  public ${model.name}Response ${workflowTransitionServiceMethodName(resource)}(Long id, String targetState) {
    ${model.name} entity = findEntity(id);
    try {
      entity.set${stateAccessor}(${stateEnum}.valueOf(targetState));
    } catch (IllegalArgumentException error) {
      throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Invalid workflow state: " + targetState);
    }
    return toResponse(repository.save(entity));
  }
`;
}

function readModelInputClassName(readModel: IRReadModel): string {
  return `${toPascalCase(readModel.name)}ReadModelInput`;
}

function readModelResultClassName(readModel: IRReadModel): string {
  return `${toPascalCase(readModel.name)}ReadModelResult`;
}

function readModelRulesClassName(readModel: IRReadModel): string {
  return `${toPascalCase(readModel.name)}ReadModelRules`;
}

function readModelHandlerClassName(readModel: IRReadModel): string {
  return `${toPascalCase(readModel.name)}ReadModelHandler`;
}

function readModelControllerClassName(readModel: IRReadModel): string {
  return `${toPascalCase(readModel.name)}ReadModelController`;
}

function springDerivationCoerceExpression(
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
      return `asStringValue(${valueExpr}, ${fallbackExpr})`;
    case 'integer':
      return `asIntegerValue(${valueExpr}, ${fallbackExpr})`;
    case 'long':
      return `asLongValue(${valueExpr}, ${fallbackExpr})`;
    case 'decimal':
      return `asBigDecimalValue(${valueExpr}, ${fallbackExpr})`;
    case 'boolean':
      return `asBooleanValue(${valueExpr}, ${fallbackExpr})`;
    default:
      return fallbackExpr;
  }
}

function generatePolicyPrincipal(ir: IRSdslProgram): string {
  return `package ${ir.app.packageName}.security;

import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.Set;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;

public record PolicyPrincipal(String username, Set<String> roles) {

  public boolean hasRole(String role) {
    return roles.contains(role);
  }

  public static PolicyPrincipal fromAuthentication(Authentication authentication) {
    if (authentication == null) {
      return new PolicyPrincipal("anonymous", Set.of());
    }
    Set<String> resolvedRoles = new LinkedHashSet<>();
    if (authentication.getAuthorities() != null) {
      for (GrantedAuthority grantedAuthority : authentication.getAuthorities()) {
        String authority = grantedAuthority == null ? null : grantedAuthority.getAuthority();
        if (authority != null && authority.startsWith("ROLE_")) {
          authority = authority.substring(5);
        }
        if (authority != null && !authority.isBlank()) {
          resolvedRoles.add(authority);
        }
      }
    }
    return new PolicyPrincipal(authentication.getName(), Collections.unmodifiableSet(resolvedRoles));
  }
}
`;
}

function generateSpringPolicyAdapter(
  ir: IRSdslProgram,
  resource: IRResource,
  readFile?: (fileName: string) => string,
): string {
  const policy = resource.auth.policy;
  if (policy?.source === 'rules') {
    return generateSpringRulesPolicyAdapter(ir, resource, policy);
  }
  const snippet = readBackendPolicySnippet(policy, readFile, 'return true;');
  return `package ${ir.app.packageName}.security;

import java.util.Map;
import org.springframework.stereotype.Component;

@Component
public class ${policyClassName(resource)} {

  public boolean allow(PolicyPrincipal principal, String operation, Map<String, String> params, Map<String, Object> payload) {
${indentSnippet(snippet, '    ')}
  }
}
`;
}

function generateSpringRulesPolicyAdapter(
  ir: IRSdslProgram,
  resource: IRResource,
  policy: IRAuthPolicyEscape,
): string {
  const manifestJson = escapeJavaTextBlock(JSON.stringify(policy.manifest ?? { rules: [] }, null, 2));
  return `package ${ir.app.packageName}.security;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Component;

@Component
public class ${policyClassName(resource)} {

  private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
  private static final List<Map<String, Object>> RULES = loadRules();

  private record Decision(boolean allowed, String message) {}

  public boolean allow(String operation, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    return decide(operation, principal, params, payload, record).allowed();
  }

  public boolean allowList(PolicyPrincipal principal) {
    return allow("list", principal, Map.of(), null, null);
  }

  public String deniedMessage(String operation, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    String message = decide(operation, principal, params, payload, record).message();
    return message == null || message.isBlank() ? "Forbidden" : message;
  }

  public <T> List<T> filterList(PolicyPrincipal principal, List<T> items) {
    List<T> filtered = new ArrayList<>();
    for (T item : items) {
      if (allow("list", principal, Map.of(), null, item)) {
        filtered.add(item);
      }
    }
    return filtered;
  }

  private Decision decide(String operation, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    for (Map<String, Object> rule : RULES) {
      if (matchesOperation(rule, operation) && isDeny(rule) && matchesRule(rule, principal, params, payload, record)) {
        return new Decision(false, messageFor(rule));
      }
    }
    for (Map<String, Object> rule : RULES) {
      if (matchesOperation(rule, operation) && isAllow(rule) && matchesRule(rule, principal, params, payload, record)) {
        return new Decision(true, null);
      }
    }
    return new Decision(false, "Forbidden");
  }

  private boolean matchesRule(Map<String, Object> rule, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    if (!evalBoolean(rule.get("when"), principal, params, payload, record) && !anyMatches(rule.get("or"), principal, params, payload, record)) {
      return false;
    }
    if ("list".equals(asString(rule.get("operation"))) && rule.containsKey("scopeWhen") && evalBoolean(rule.get("scopeWhen"), principal, params, payload, record)) {
      return evalBoolean(rule.get("scope"), principal, params, payload, record);
    }
    return true;
  }

  private boolean anyMatches(Object candidate, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    if (!(candidate instanceof List<?> values)) {
      return false;
    }
    for (Object value : values) {
      if (evalBoolean(value, principal, params, payload, record)) {
        return true;
      }
    }
    return false;
  }

  private boolean evalBoolean(Object node, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    return truthy(evalExpr(node, principal, params, payload, record));
  }

  private Object evalExpr(Object node, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    if (!(node instanceof Map<?, ?> raw)) {
      return null;
    }
    @SuppressWarnings("unchecked")
    Map<String, Object> expr = (Map<String, Object>) raw;
    String type = asString(expr.get("type"));
    if (type == null) {
      return null;
    }
    return switch (type) {
      case "literal" -> expr.get("value");
      case "identifier" -> resolvePath(expr.get("path"), principal, params, payload, record);
      case "binary" -> evalBinary(expr, principal, params, payload, record);
      case "unary" -> "not".equals(asString(expr.get("op"))) ? !evalBoolean(expr.get("operand"), principal, params, payload, record) : null;
      case "call" -> evalCall(expr, principal, params, payload, record);
      case "member" -> readProperty(evalExpr(expr.get("object"), principal, params, payload, record), asString(expr.get("property")));
      case "in" -> evalIn(expr, principal, params, payload, record);
      default -> null;
    };
  }

  private Object evalBinary(Map<String, Object> expr, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    String op = asString(expr.get("op"));
    Object left = evalExpr(expr.get("left"), principal, params, payload, record);
    Object right = evalExpr(expr.get("right"), principal, params, payload, record);
    return switch (op == null ? "" : op) {
      case "&&" -> truthy(left) && truthy(right);
      case "||" -> truthy(left) || truthy(right);
      case "==" -> valuesEqual(left, right);
      case "!=" -> !valuesEqual(left, right);
      case ">" -> compareValues(left, right) > 0;
      case "<" -> compareValues(left, right) < 0;
      case ">=" -> compareValues(left, right) >= 0;
      case "<=" -> compareValues(left, right) <= 0;
      default -> null;
    };
  }

  private Object evalCall(Map<String, Object> expr, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    String fn = asString(expr.get("fn"));
    List<?> args = expr.get("args") instanceof List<?> values ? values : List.of();
    return switch (fn == null ? "" : fn) {
      case "hasRole" -> args.size() >= 2 && hasRole(evalExpr(args.get(0), principal, params, payload, record), evalExpr(args.get(1), principal, params, payload, record));
      case "isEmpty" -> args.size() >= 1 && isEmpty(evalExpr(args.get(0), principal, params, payload, record));
      case "isNotEmpty" -> args.size() >= 1 && !isEmpty(evalExpr(args.get(0), principal, params, payload, record));
      case "count" -> args.size() >= 1 ? count(evalExpr(args.get(0), principal, params, payload, record)) : 0;
      default -> false;
    };
  }

  private boolean evalIn(Map<String, Object> expr, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    Object value = evalExpr(expr.get("value"), principal, params, payload, record);
    if (!(expr.get("list") instanceof List<?> values)) {
      return false;
    }
    for (Object candidateNode : values) {
      Object candidate = evalExpr(candidateNode, principal, params, payload, record);
      if (valuesEqual(value, candidate)) {
        return true;
      }
    }
    return false;
  }

  private Object resolvePath(Object candidate, PolicyPrincipal principal, Map<String, String> params, Map<String, Object> payload, Object record) {
    if (!(candidate instanceof List<?> values) || values.isEmpty()) {
      return null;
    }
    String root = asString(values.get(0));
    if (root == null) {
      return null;
    }
    if (values.size() == 1 && root.matches("[A-Z][A-Z0-9_]*")) {
      return root;
    }
    Object current = switch (root) {
      case "currentUser" -> principal;
      case "record" -> record;
      case "payload" -> payload;
      case "params" -> params;
      default -> null;
    };
    if ("currentUser".equals(root) && values.size() >= 2) {
      return resolveCurrentUser(principal, asString(values.get(1)));
    }
    for (int index = 1; index < values.size(); index += 1) {
      current = readProperty(current, asString(values.get(index)));
    }
    return current;
  }

  private Object resolveCurrentUser(PolicyPrincipal principal, String property) {
    if (property == null) {
      return principal;
    }
    return switch (property) {
      case "id", "username" -> principal.username();
      case "role" -> principal.roles().stream().findFirst().orElse(null);
      case "roles" -> principal.roles();
      default -> readProperty(principal, property);
    };
  }

  private Object readProperty(Object target, String property) {
    if (target == null || property == null || property.isBlank()) {
      return null;
    }
    if (target instanceof Map<?, ?> map) {
      return map.get(property);
    }
    try {
      Method accessor = target.getClass().getMethod(property);
      return accessor.invoke(target);
    } catch (ReflectiveOperationException ignored) {
      // Try getter form next.
    }
    try {
      Method getter = target.getClass().getMethod("get" + Character.toUpperCase(property.charAt(0)) + property.substring(1));
      return getter.invoke(target);
    } catch (ReflectiveOperationException ignored) {
      // Try field access next.
    }
    try {
      Field field = target.getClass().getDeclaredField(property);
      field.setAccessible(true);
      return field.get(target);
    } catch (ReflectiveOperationException ignored) {
      return null;
    }
  }

  private boolean matchesOperation(Map<String, Object> rule, String operation) {
    return Objects.equals(asString(rule.get("operation")), operation);
  }

  private boolean isAllow(Map<String, Object> rule) {
    return Objects.equals(asString(rule.get("effect")), "allow");
  }

  private boolean isDeny(Map<String, Object> rule) {
    return Objects.equals(asString(rule.get("effect")), "deny");
  }

  private String messageFor(Map<String, Object> rule) {
    Object message = rule.get("message");
    if (message instanceof String text && !text.isBlank()) {
      return text;
    }
    if (message instanceof Map<?, ?> descriptor) {
      Object defaultMessage = descriptor.get("defaultMessage");
      if (defaultMessage instanceof String text && !text.isBlank()) {
        return text;
      }
      Object key = descriptor.get("key");
      if (key instanceof String text && !text.isBlank()) {
        return text;
      }
    }
    return "Forbidden";
  }

  private boolean truthy(Object value) {
    if (value instanceof Boolean flag) {
      return flag;
    }
    if (value == null) {
      return false;
    }
    if (value instanceof Number number) {
      return number.doubleValue() != 0.0d;
    }
    if (value instanceof String text) {
      return !text.isBlank();
    }
    if (value instanceof Collection<?> collection) {
      return !collection.isEmpty();
    }
    if (value instanceof Map<?, ?> map) {
      return !map.isEmpty();
    }
    return true;
  }

  private boolean valuesEqual(Object left, Object right) {
    Object normalizedLeft = normalizeValue(left);
    Object normalizedRight = normalizeValue(right);
    if (normalizedLeft instanceof Number leftNumber && normalizedRight instanceof Number rightNumber) {
      return compareNumbers(leftNumber, rightNumber) == 0;
    }
    return Objects.equals(normalizedLeft, normalizedRight);
  }

  private int compareValues(Object left, Object right) {
    Object normalizedLeft = normalizeValue(left);
    Object normalizedRight = normalizeValue(right);
    if (normalizedLeft instanceof Number leftNumber && normalizedRight instanceof Number rightNumber) {
      return compareNumbers(leftNumber, rightNumber);
    }
    if (normalizedLeft instanceof Comparable<?> comparable && normalizedLeft.getClass().isInstance(normalizedRight)) {
      @SuppressWarnings("unchecked")
      Comparable<Object> cast = (Comparable<Object>) comparable;
      return cast.compareTo(normalizedRight);
    }
    return String.valueOf(normalizedLeft).compareTo(String.valueOf(normalizedRight));
  }

  private int compareNumbers(Number left, Number right) {
    return new BigDecimal(String.valueOf(left)).compareTo(new BigDecimal(String.valueOf(right)));
  }

  private Object normalizeValue(Object value) {
    if (value instanceof Enum<?> enumValue) {
      return enumValue.name();
    }
    return value;
  }

  private boolean hasRole(Object currentUser, Object role) {
    String expectedRole = role == null ? null : String.valueOf(role);
    if (expectedRole == null || expectedRole.isBlank()) {
      return false;
    }
    Object roles = readProperty(currentUser, "roles");
    if (roles instanceof Collection<?> collection) {
      for (Object candidate : collection) {
        if (expectedRole.equals(String.valueOf(candidate))) {
          return true;
        }
      }
    }
    Object primaryRole = readProperty(currentUser, "role");
    return expectedRole.equals(String.valueOf(primaryRole));
  }

  private boolean isEmpty(Object value) {
    if (value == null) {
      return true;
    }
    if (value instanceof String text) {
      return text.isBlank();
    }
    if (value instanceof Collection<?> collection) {
      return collection.isEmpty();
    }
    if (value instanceof Map<?, ?> map) {
      return map.isEmpty();
    }
    return false;
  }

  private int count(Object value) {
    if (value == null) {
      return 0;
    }
    if (value instanceof Collection<?> collection) {
      return collection.size();
    }
    if (value instanceof Map<?, ?> map) {
      return map.size();
    }
    if (value instanceof String text) {
      return text.length();
    }
    return 0;
  }

  private String asString(Object value) {
    return value instanceof String text ? text : null;
  }

  private static List<Map<String, Object>> loadRules() {
    try {
      Map<String, Object> manifest = OBJECT_MAPPER.readValue(
        """
${indentSnippet(manifestJson, '        ')}
        """,
        new TypeReference<Map<String, Object>>() { }
      );
      Object rules = manifest.get("rules");
      if (rules instanceof List<?> list) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> cast = (List<Map<String, Object>>) (List<?>) list;
        return cast;
      }
      return List.of();
    } catch (Exception error) {
      throw new IllegalStateException("Failed to load generated rules policy manifest", error);
    }
  }
}
`;
}

function generateSpringCreateRulesAdapter(
  ir: IRSdslProgram,
  resource: IRResource,
  model: IRModel,
): string {
  const manifestJson = escapeJavaTextBlock(JSON.stringify(resource.create?.rules?.manifest ?? {
    eligibility: [],
    validation: [],
  }, null, 2));
  return `package ${ir.app.packageName}.rules;

import ${ir.app.packageName}.security.PolicyPrincipal;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Component;

@Component
public class ${resourceCreateRulesClassName(resource)} {

  private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
  private static final List<Map<String, Object>> ELIGIBILITY = loadEntries("eligibility");
  private static final List<Map<String, Object>> VALIDATION = loadEntries("validation");

  public String firstEligibilityFailure(PolicyPrincipal principal, Map<String, String> params, Object payload) {
    for (Map<String, Object> rule : ELIGIBILITY) {
      if (!matchesRule(rule, principal, params, payload)) {
        return messageFor(rule, "Forbidden");
      }
    }
    return null;
  }

  public String firstValidationFailure(PolicyPrincipal principal, Map<String, String> params, Object payload) {
    for (Map<String, Object> rule : VALIDATION) {
      if (!matchesRule(rule, principal, params, payload)) {
        return messageFor(rule, "Validation failed");
      }
    }
    return null;
  }

  private boolean matchesRule(Map<String, Object> rule, PolicyPrincipal principal, Map<String, String> params, Object payload) {
    return evalBoolean(rule.get("when"), principal, params, payload) || anyMatches(rule.get("or"), principal, params, payload);
  }

  private boolean anyMatches(Object candidate, PolicyPrincipal principal, Map<String, String> params, Object payload) {
    if (!(candidate instanceof List<?> values)) {
      return false;
    }
    for (Object value : values) {
      if (evalBoolean(value, principal, params, payload)) {
        return true;
      }
    }
    return false;
  }

  private boolean evalBoolean(Object node, PolicyPrincipal principal, Map<String, String> params, Object payload) {
    return truthy(evalExpr(node, principal, params, payload));
  }

  private Object evalExpr(Object node, PolicyPrincipal principal, Map<String, String> params, Object payload) {
    if (!(node instanceof Map<?, ?> raw)) {
      return null;
    }
    @SuppressWarnings("unchecked")
    Map<String, Object> expr = (Map<String, Object>) raw;
    String type = asString(expr.get("type"));
    if (type == null) {
      return null;
    }
    return switch (type) {
      case "literal" -> expr.get("value");
      case "identifier" -> resolvePath(expr.get("path"), principal, params, payload);
      case "binary" -> evalBinary(expr, principal, params, payload);
      case "unary" -> "not".equals(asString(expr.get("op"))) ? !evalBoolean(expr.get("operand"), principal, params, payload) : null;
      case "call" -> evalCall(expr, principal, params, payload);
      case "member" -> readProperty(evalExpr(expr.get("object"), principal, params, payload), asString(expr.get("property")));
      case "in" -> evalIn(expr, principal, params, payload);
      default -> null;
    };
  }

  private Object evalBinary(Map<String, Object> expr, PolicyPrincipal principal, Map<String, String> params, Object payload) {
    String op = asString(expr.get("op"));
    Object left = evalExpr(expr.get("left"), principal, params, payload);
    Object right = evalExpr(expr.get("right"), principal, params, payload);
    return switch (op == null ? "" : op) {
      case "&&" -> truthy(left) && truthy(right);
      case "||" -> truthy(left) || truthy(right);
      case "==" -> valuesEqual(left, right);
      case "!=" -> !valuesEqual(left, right);
      case ">" -> compareValues(left, right) > 0;
      case "<" -> compareValues(left, right) < 0;
      case ">=" -> compareValues(left, right) >= 0;
      case "<=" -> compareValues(left, right) <= 0;
      case "+" -> addValues(left, right);
      case "-" -> subtractValues(left, right);
      case "*" -> multiplyValues(left, right);
      case "/" -> divideValues(left, right);
      default -> null;
    };
  }

  private Object evalCall(Map<String, Object> expr, PolicyPrincipal principal, Map<String, String> params, Object payload) {
    String fn = asString(expr.get("fn"));
    List<?> args = expr.get("args") instanceof List<?> values ? values : List.of();
    return switch (fn == null ? "" : fn) {
      case "hasRole" -> args.size() >= 2 && hasRole(evalExpr(args.get(0), principal, params, payload), evalExpr(args.get(1), principal, params, payload));
      case "isEmpty" -> args.size() >= 1 && isEmpty(evalExpr(args.get(0), principal, params, payload));
      case "isNotEmpty" -> args.size() >= 1 && !isEmpty(evalExpr(args.get(0), principal, params, payload));
      case "count" -> args.size() >= 1 ? count(evalExpr(args.get(0), principal, params, payload)) : 0;
      default -> false;
    };
  }

  private boolean evalIn(Map<String, Object> expr, PolicyPrincipal principal, Map<String, String> params, Object payload) {
    Object value = evalExpr(expr.get("value"), principal, params, payload);
    if (!(expr.get("list") instanceof List<?> values)) {
      return false;
    }
    for (Object candidateNode : values) {
      Object candidate = evalExpr(candidateNode, principal, params, payload);
      if (valuesEqual(value, candidate)) {
        return true;
      }
    }
    return false;
  }

  private Object resolvePath(Object candidate, PolicyPrincipal principal, Map<String, String> params, Object payload) {
    if (!(candidate instanceof List<?> values) || values.isEmpty()) {
      return null;
    }
    String root = asString(values.get(0));
    if (root == null) {
      return null;
    }
    if (values.size() == 1 && root.matches("[A-Z][A-Z0-9_]*")) {
      return root;
    }
    Object current = switch (root) {
      case "currentUser" -> principal;
      case "payload" -> payload;
      case "params" -> params;
      default -> null;
    };
    if ("currentUser".equals(root) && values.size() >= 2) {
      return resolveCurrentUser(principal, asString(values.get(1)));
    }
    for (int index = 1; index < values.size(); index += 1) {
      current = readProperty(current, asString(values.get(index)));
    }
    return current;
  }

  private Object resolveCurrentUser(PolicyPrincipal principal, String property) {
    if (property == null) {
      return principal;
    }
    return switch (property) {
      case "id", "username" -> principal.username();
      case "role" -> principal.roles().stream().findFirst().orElse(null);
      case "roles" -> principal.roles();
      default -> readProperty(principal, property);
    };
  }

  private Object readProperty(Object target, String property) {
    if (target == null || property == null || property.isBlank()) {
      return null;
    }
    if (target instanceof Map<?, ?> map) {
      return map.get(property);
    }
    try {
      Method accessor = target.getClass().getMethod(property);
      return accessor.invoke(target);
    } catch (ReflectiveOperationException ignored) {
      // Try getter form next.
    }
    try {
      Method getter = target.getClass().getMethod("get" + Character.toUpperCase(property.charAt(0)) + property.substring(1));
      return getter.invoke(target);
    } catch (ReflectiveOperationException ignored) {
      // Try field access next.
    }
    try {
      Field field = target.getClass().getDeclaredField(property);
      field.setAccessible(true);
      return field.get(target);
    } catch (ReflectiveOperationException ignored) {
      return null;
    }
  }

  private String messageFor(Map<String, Object> rule, String fallback) {
    Object message = rule.get("message");
    if (message instanceof String text && !text.isBlank()) {
      return text;
    }
    if (message instanceof Map<?, ?> descriptor) {
      Object defaultMessage = descriptor.get("defaultMessage");
      if (defaultMessage instanceof String text && !text.isBlank()) {
        return text;
      }
      Object key = descriptor.get("key");
      if (key instanceof String text && !text.isBlank()) {
        return text;
      }
    }
    return fallback;
  }

  private boolean truthy(Object value) {
    if (value instanceof Boolean flag) {
      return flag;
    }
    if (value == null) {
      return false;
    }
    if (value instanceof Number number) {
      return number.doubleValue() != 0.0d;
    }
    if (value instanceof String text) {
      return !text.isBlank();
    }
    if (value instanceof Collection<?> collection) {
      return !collection.isEmpty();
    }
    if (value instanceof Map<?, ?> map) {
      return !map.isEmpty();
    }
    return true;
  }

  private boolean valuesEqual(Object left, Object right) {
    Object normalizedLeft = normalizeValue(left);
    Object normalizedRight = normalizeValue(right);
    if (normalizedLeft instanceof Number leftNumber && normalizedRight instanceof Number rightNumber) {
      return compareNumbers(leftNumber, rightNumber) == 0;
    }
    return Objects.equals(normalizedLeft, normalizedRight);
  }

  private int compareValues(Object left, Object right) {
    Object normalizedLeft = normalizeValue(left);
    Object normalizedRight = normalizeValue(right);
    if (normalizedLeft instanceof Number leftNumber && normalizedRight instanceof Number rightNumber) {
      return compareNumbers(leftNumber, rightNumber);
    }
    if (normalizedLeft instanceof Comparable<?> comparable && normalizedLeft.getClass().isInstance(normalizedRight)) {
      @SuppressWarnings("unchecked")
      Comparable<Object> cast = (Comparable<Object>) comparable;
      return cast.compareTo(normalizedRight);
    }
    return String.valueOf(normalizedLeft).compareTo(String.valueOf(normalizedRight));
  }

  private int compareNumbers(Number left, Number right) {
    return toBigDecimal(left).compareTo(toBigDecimal(right));
  }

  private Object normalizeValue(Object value) {
    if (value instanceof Enum<?> enumValue) {
      return enumValue.name();
    }
    return value;
  }

  private boolean hasRole(Object currentUser, Object role) {
    String expectedRole = role == null ? null : String.valueOf(role);
    if (expectedRole == null || expectedRole.isBlank()) {
      return false;
    }
    Object roles = readProperty(currentUser, "roles");
    if (roles instanceof Collection<?> collection) {
      for (Object candidate : collection) {
        if (expectedRole.equals(String.valueOf(candidate))) {
          return true;
        }
      }
    }
    Object primaryRole = readProperty(currentUser, "role");
    return expectedRole.equals(String.valueOf(primaryRole));
  }

  private boolean isEmpty(Object value) {
    if (value == null) {
      return true;
    }
    if (value instanceof String text) {
      return text.isBlank();
    }
    if (value instanceof Collection<?> collection) {
      return collection.isEmpty();
    }
    if (value instanceof Map<?, ?> map) {
      return map.isEmpty();
    }
    return false;
  }

  private int count(Object value) {
    if (value == null) {
      return 0;
    }
    if (value instanceof Collection<?> collection) {
      return collection.size();
    }
    if (value instanceof Map<?, ?> map) {
      return map.size();
    }
    if (value instanceof String text) {
      return text.length();
    }
    return 0;
  }

  private String asString(Object value) {
    return value instanceof String text ? text : null;
  }

  private Object addValues(Object left, Object right) {
    if (left instanceof String || right instanceof String) {
      return String.valueOf(left == null ? "" : left) + String.valueOf(right == null ? "" : right);
    }
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      return toBigDecimal(leftNumber).add(toBigDecimal(rightNumber));
    }
    return null;
  }

  private Object subtractValues(Object left, Object right) {
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      return toBigDecimal(leftNumber).subtract(toBigDecimal(rightNumber));
    }
    return null;
  }

  private Object multiplyValues(Object left, Object right) {
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      return toBigDecimal(leftNumber).multiply(toBigDecimal(rightNumber));
    }
    return null;
  }

  private Object divideValues(Object left, Object right) {
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      BigDecimal divisor = toBigDecimal(rightNumber);
      if (BigDecimal.ZERO.compareTo(divisor) == 0) {
        return null;
      }
      return toBigDecimal(leftNumber).divide(divisor, 4, java.math.RoundingMode.HALF_UP);
    }
    return null;
  }

  private BigDecimal toBigDecimal(Number value) {
    return new BigDecimal(String.valueOf(value));
  }

  private static List<Map<String, Object>> loadEntries(String key) {
    try {
      Map<String, Object> manifest = OBJECT_MAPPER.readValue(
        """
${indentSnippet(manifestJson, '        ')}
        """,
        new TypeReference<Map<String, Object>>() { }
      );
      Object entries = manifest.get(key);
      if (entries instanceof List<?> list) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> cast = (List<Map<String, Object>>) (List<?>) list;
        return cast;
      }
      return List.of();
    } catch (Exception error) {
      throw new IllegalStateException("Failed to load generated create rules manifest", error);
    }
  }
}
`;
}

function generateSpringWorkflowAdapter(
  ir: IRSdslProgram,
  resource: IRResource & { workflow: NonNullable<IRResource['workflow']> },
  model: IRModel,
): string {
  const manifestJson = escapeJavaTextBlock(JSON.stringify(resource.workflow.manifest, null, 2));
  const stateField = workflowStateField(model, resource);
  const initialState = workflowInitialState(resource);
  return `package ${ir.app.packageName}.workflow;

import ${ir.app.packageName}.security.PolicyPrincipal;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.math.BigDecimal;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

@Component
public class ${resourceWorkflowClassName(resource)} {

  private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
  private static final String STATE_FIELD = "${stateField.name}";
  private static final String INITIAL_STATE = "${initialState}";
  private static final List<Map<String, Object>> TRANSITIONS = loadTransitions();

  public static record TransitionDecision(boolean allowed, HttpStatus status, String message, String targetState) {}

  public String initialState() {
    return INITIAL_STATE;
  }

  public TransitionDecision decide(String transitionName, PolicyPrincipal principal, Object record) {
    Map<String, Object> transition = findTransition(transitionName);
    if (transition == null) {
      return new TransitionDecision(false, HttpStatus.BAD_REQUEST, "Unknown transition: " + transitionName, null);
    }
    String currentState = currentState(record);
    List<String> fromStates = asStringList(transition.get("from"));
    if (!fromStates.contains(currentState)) {
      return new TransitionDecision(
        false,
        HttpStatus.BAD_REQUEST,
        "Transition \\"" + transitionName + "\\" is not allowed from current state " + currentState,
        null
      );
    }
    if (transition.containsKey("allow") && !evalBoolean(transition.get("allow"), principal, record)) {
      return new TransitionDecision(false, HttpStatus.FORBIDDEN, "Forbidden", null);
    }
    return new TransitionDecision(true, HttpStatus.OK, null, asString(transition.get("to")));
  }

  private Map<String, Object> findTransition(String transitionName) {
    for (Map<String, Object> transition : TRANSITIONS) {
      if (Objects.equals(asString(transition.get("name")), transitionName)) {
        return transition;
      }
    }
    return null;
  }

  private String currentState(Object record) {
    Object value = readProperty(record, STATE_FIELD);
    Object normalized = normalizeValue(value);
    return normalized == null ? "" : String.valueOf(normalized);
  }

  private List<String> asStringList(Object value) {
    if (!(value instanceof List<?> items)) {
      return List.of();
    }
    return items.stream()
      .filter(String.class::isInstance)
      .map(String.class::cast)
      .toList();
  }

  private boolean evalBoolean(Object node, PolicyPrincipal principal, Object record) {
    return truthy(evalExpr(node, principal, record));
  }

  private Object evalExpr(Object node, PolicyPrincipal principal, Object record) {
    if (!(node instanceof Map<?, ?> raw)) {
      return null;
    }
    @SuppressWarnings("unchecked")
    Map<String, Object> expr = (Map<String, Object>) raw;
    String type = asString(expr.get("type"));
    if (type == null) {
      return null;
    }
    return switch (type) {
      case "literal" -> expr.get("value");
      case "identifier" -> resolvePath(expr.get("path"), principal, record);
      case "binary" -> evalBinary(expr, principal, record);
      case "unary" -> "not".equals(asString(expr.get("op"))) ? !evalBoolean(expr.get("operand"), principal, record) : null;
      case "call" -> evalCall(expr, principal, record);
      case "member" -> readProperty(evalExpr(expr.get("object"), principal, record), asString(expr.get("property")));
      case "in" -> evalIn(expr, principal, record);
      default -> null;
    };
  }

  private Object evalBinary(Map<String, Object> expr, PolicyPrincipal principal, Object record) {
    String op = asString(expr.get("op"));
    Object left = evalExpr(expr.get("left"), principal, record);
    Object right = evalExpr(expr.get("right"), principal, record);
    return switch (op == null ? "" : op) {
      case "&&" -> truthy(left) && truthy(right);
      case "||" -> truthy(left) || truthy(right);
      case "==" -> valuesEqual(left, right);
      case "!=" -> !valuesEqual(left, right);
      case ">" -> compareValues(left, right) > 0;
      case "<" -> compareValues(left, right) < 0;
      case ">=" -> compareValues(left, right) >= 0;
      case "<=" -> compareValues(left, right) <= 0;
      case "+" -> addValues(left, right);
      case "-" -> subtractValues(left, right);
      case "*" -> multiplyValues(left, right);
      case "/" -> divideValues(left, right);
      default -> null;
    };
  }

  private Object evalCall(Map<String, Object> expr, PolicyPrincipal principal, Object record) {
    String fn = asString(expr.get("fn"));
    List<?> args = expr.get("args") instanceof List<?> values ? values : List.of();
    return switch (fn == null ? "" : fn) {
      case "hasRole" -> args.size() >= 2 && hasRole(evalExpr(args.get(0), principal, record), evalExpr(args.get(1), principal, record));
      case "isEmpty" -> args.size() >= 1 && isEmpty(evalExpr(args.get(0), principal, record));
      case "isNotEmpty" -> args.size() >= 1 && !isEmpty(evalExpr(args.get(0), principal, record));
      case "count" -> args.size() >= 1 ? count(evalExpr(args.get(0), principal, record)) : 0;
      default -> false;
    };
  }

  private boolean evalIn(Map<String, Object> expr, PolicyPrincipal principal, Object record) {
    Object value = evalExpr(expr.get("value"), principal, record);
    if (!(expr.get("list") instanceof List<?> values)) {
      return false;
    }
    for (Object candidateNode : values) {
      Object candidate = evalExpr(candidateNode, principal, record);
      if (valuesEqual(value, candidate)) {
        return true;
      }
    }
    return false;
  }

  private Object resolvePath(Object candidate, PolicyPrincipal principal, Object record) {
    if (!(candidate instanceof List<?> values) || values.isEmpty()) {
      return null;
    }
    String root = asString(values.get(0));
    if (root == null) {
      return null;
    }
    if (values.size() == 1 && root.matches("[A-Z][A-Z0-9_]*")) {
      return root;
    }
    Object current = switch (root) {
      case "currentUser" -> principal;
      case "record" -> record;
      default -> null;
    };
    if ("currentUser".equals(root) && values.size() >= 2) {
      return resolveCurrentUser(principal, asString(values.get(1)));
    }
    for (int index = 1; index < values.size(); index += 1) {
      current = readProperty(current, asString(values.get(index)));
    }
    return current;
  }

  private Object resolveCurrentUser(PolicyPrincipal principal, String property) {
    if (property == null) {
      return principal;
    }
    return switch (property) {
      case "id", "username" -> principal.username();
      case "role" -> principal.roles().stream().findFirst().orElse(null);
      case "roles" -> principal.roles();
      default -> readProperty(principal, property);
    };
  }

  private Object readProperty(Object target, String property) {
    if (target == null || property == null || property.isBlank()) {
      return null;
    }
    if (target instanceof Map<?, ?> map) {
      return map.get(property);
    }
    try {
      Method accessor = target.getClass().getMethod(property);
      return accessor.invoke(target);
    } catch (ReflectiveOperationException ignored) {
      // Try getter form next.
    }
    try {
      Method getter = target.getClass().getMethod("get" + Character.toUpperCase(property.charAt(0)) + property.substring(1));
      return getter.invoke(target);
    } catch (ReflectiveOperationException ignored) {
      // Try field access next.
    }
    try {
      Field field = target.getClass().getDeclaredField(property);
      field.setAccessible(true);
      return field.get(target);
    } catch (ReflectiveOperationException ignored) {
      return null;
    }
  }

  private boolean truthy(Object value) {
    if (value instanceof Boolean flag) {
      return flag;
    }
    if (value == null) {
      return false;
    }
    if (value instanceof Number number) {
      return number.doubleValue() != 0.0d;
    }
    if (value instanceof String text) {
      return !text.isBlank();
    }
    if (value instanceof Collection<?> collection) {
      return !collection.isEmpty();
    }
    if (value instanceof Map<?, ?> map) {
      return !map.isEmpty();
    }
    return true;
  }

  private boolean valuesEqual(Object left, Object right) {
    Object normalizedLeft = normalizeValue(left);
    Object normalizedRight = normalizeValue(right);
    if (normalizedLeft instanceof Number leftNumber && normalizedRight instanceof Number rightNumber) {
      return compareNumbers(leftNumber, rightNumber) == 0;
    }
    return Objects.equals(normalizedLeft, normalizedRight);
  }

  private int compareValues(Object left, Object right) {
    Object normalizedLeft = normalizeValue(left);
    Object normalizedRight = normalizeValue(right);
    if (normalizedLeft instanceof Number leftNumber && normalizedRight instanceof Number rightNumber) {
      return compareNumbers(leftNumber, rightNumber);
    }
    if (normalizedLeft instanceof Comparable<?> comparable && normalizedLeft.getClass().isInstance(normalizedRight)) {
      @SuppressWarnings("unchecked")
      Comparable<Object> cast = (Comparable<Object>) comparable;
      return cast.compareTo(normalizedRight);
    }
    return String.valueOf(normalizedLeft).compareTo(String.valueOf(normalizedRight));
  }

  private int compareNumbers(Number left, Number right) {
    return toBigDecimal(left).compareTo(toBigDecimal(right));
  }

  private Object normalizeValue(Object value) {
    if (value instanceof Enum<?> enumValue) {
      return enumValue.name();
    }
    return value;
  }

  private boolean hasRole(Object currentUser, Object role) {
    String expectedRole = role == null ? null : String.valueOf(role);
    if (expectedRole == null || expectedRole.isBlank()) {
      return false;
    }
    Object roles = readProperty(currentUser, "roles");
    if (roles instanceof Collection<?> collection) {
      for (Object candidate : collection) {
        if (expectedRole.equals(String.valueOf(candidate))) {
          return true;
        }
      }
    }
    Object primaryRole = readProperty(currentUser, "role");
    return expectedRole.equals(String.valueOf(primaryRole));
  }

  private boolean isEmpty(Object value) {
    if (value == null) {
      return true;
    }
    if (value instanceof String text) {
      return text.isBlank();
    }
    if (value instanceof Collection<?> collection) {
      return collection.isEmpty();
    }
    if (value instanceof Map<?, ?> map) {
      return map.isEmpty();
    }
    return false;
  }

  private int count(Object value) {
    if (value == null) {
      return 0;
    }
    if (value instanceof Collection<?> collection) {
      return collection.size();
    }
    if (value instanceof Map<?, ?> map) {
      return map.size();
    }
    if (value instanceof String text) {
      return text.length();
    }
    return 0;
  }

  private String asString(Object value) {
    return value instanceof String text ? text : null;
  }

  private Object addValues(Object left, Object right) {
    if (left instanceof String || right instanceof String) {
      return String.valueOf(left == null ? "" : left) + String.valueOf(right == null ? "" : right);
    }
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      return toBigDecimal(leftNumber).add(toBigDecimal(rightNumber));
    }
    return null;
  }

  private Object subtractValues(Object left, Object right) {
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      return toBigDecimal(leftNumber).subtract(toBigDecimal(rightNumber));
    }
    return null;
  }

  private Object multiplyValues(Object left, Object right) {
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      return toBigDecimal(leftNumber).multiply(toBigDecimal(rightNumber));
    }
    return null;
  }

  private Object divideValues(Object left, Object right) {
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      BigDecimal divisor = toBigDecimal(rightNumber);
      if (BigDecimal.ZERO.compareTo(divisor) == 0) {
        return null;
      }
      return toBigDecimal(leftNumber).divide(divisor, 4, java.math.RoundingMode.HALF_UP);
    }
    return null;
  }

  private BigDecimal toBigDecimal(Number value) {
    return new BigDecimal(String.valueOf(value));
  }

  private static List<Map<String, Object>> loadTransitions() {
    try {
      Map<String, Object> manifest = OBJECT_MAPPER.readValue(
        """
${indentSnippet(manifestJson, '        ')}
        """,
        new TypeReference<Map<String, Object>>() { }
      );
      Object transitions = manifest.get("transitions");
      if (transitions instanceof List<?> list) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> cast = (List<Map<String, Object>>) (List<?>) list;
        return cast;
      }
      return List.of();
    } catch (Exception error) {
      throw new IllegalStateException("Failed to load generated workflow manifest", error);
    }
  }
}
`;
}

function generateSpringReadModelRulesAdapter(
  ir: IRSdslProgram,
  readModel: IRReadModel,
): string {
  const manifestJson = escapeJavaTextBlock(JSON.stringify(readModel.rules?.manifest ?? {
    eligibility: [],
    validation: [],
    derivations: [],
  }, null, 2));
  const imports = new Set<string>([
    `import ${ir.app.packageName}.dto.${readModelInputClassName(readModel)};`,
    `import ${ir.app.packageName}.dto.${readModelResultClassName(readModel)};`,
    `import ${ir.app.packageName}.security.PolicyPrincipal;`,
    'import com.fasterxml.jackson.core.type.TypeReference;',
    'import com.fasterxml.jackson.databind.ObjectMapper;',
    'import java.lang.reflect.Field;',
    'import java.lang.reflect.Method;',
    'import java.math.BigDecimal;',
    'import java.util.Collection;',
    'import java.util.List;',
    'import java.util.Map;',
    'import java.util.Objects;',
    'import org.springframework.stereotype.Component;',
  ]);

  const derivationMethods = readModel.result
    .map((field) => {
      const derivation = readModel.rules?.program.derivations.find((entry) => entry.field === field.name);
      if (!derivation) {
        return '';
      }
      return `
  private ${readModelJavaType(field)} apply${toPascalCase(field.name)}Derivation(${readModelInputClassName(readModel)} input, PolicyPrincipal principal, ${readModelResultClassName(readModel)} item) {
    Map<String, Object> rule = findDerivation("${field.name}");
    if (rule == null) {
      return item.${field.name}();
    }
    if (rule.containsKey("when") && !evalBoolean(rule.get("when"), principal, input, item)) {
      return item.${field.name}();
    }
    return ${springDerivationCoerceExpression(field, 'evalExpr(rule.get("value"), principal, input, item)', `item.${field.name}()`)};
  }`;
    })
    .filter(Boolean)
    .join('\n');

  const resultArgs = readModel.result.map((field) => {
    const derivation = readModel.rules?.program.derivations.find((entry) => entry.field === field.name);
    return derivation ? `apply${toPascalCase(field.name)}Derivation(input, principal, item)` : `item.${field.name}()`;
  });

  return `package ${ir.app.packageName}.rules;

${Array.from(imports).sort().join('\n')}

@Component
public class ${readModelRulesClassName(readModel)} {

  private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();
  private static final List<Map<String, Object>> ELIGIBILITY = loadEntries("eligibility");
  private static final List<Map<String, Object>> VALIDATION = loadEntries("validation");
  private static final List<Map<String, Object>> DERIVATIONS = loadEntries("derivations");

  public String firstEligibilityFailure(${readModelInputClassName(readModel)} input, PolicyPrincipal principal) {
    for (Map<String, Object> rule : ELIGIBILITY) {
      if (!matchesRule(rule, principal, input)) {
        return messageFor(rule, "Forbidden");
      }
    }
    return null;
  }

  public String firstValidationFailure(${readModelInputClassName(readModel)} input, PolicyPrincipal principal) {
    for (Map<String, Object> rule : VALIDATION) {
      if (!matchesRule(rule, principal, input)) {
        return messageFor(rule, "Invalid request");
      }
    }
    return null;
  }

  public List<${readModelResultClassName(readModel)}> applyDerivations(${readModelInputClassName(readModel)} input, PolicyPrincipal principal, List<${readModelResultClassName(readModel)}> items) {
    if (DERIVATIONS.isEmpty()) {
      return items;
    }
    return items.stream()
      .map(item -> new ${readModelResultClassName(readModel)}(${resultArgs.join(', ')}))
      .toList();
  }
${derivationMethods ? `${derivationMethods}
` : ''}
  private boolean matchesRule(Map<String, Object> rule, PolicyPrincipal principal, ${readModelInputClassName(readModel)} input) {
    return evalBoolean(rule.get("when"), principal, input, null) || anyMatches(rule.get("or"), principal, input, null);
  }

  private Map<String, Object> findDerivation(String field) {
    for (Map<String, Object> entry : DERIVATIONS) {
      if (Objects.equals(asString(entry.get("field")), field)) {
        return entry;
      }
    }
    return null;
  }

  private boolean anyMatches(Object candidate, PolicyPrincipal principal, ${readModelInputClassName(readModel)} input, ${readModelResultClassName(readModel)} item) {
    if (!(candidate instanceof List<?> values)) {
      return false;
    }
    for (Object value : values) {
      if (evalBoolean(value, principal, input, item)) {
        return true;
      }
    }
    return false;
  }

  private boolean evalBoolean(Object node, PolicyPrincipal principal, ${readModelInputClassName(readModel)} input, ${readModelResultClassName(readModel)} item) {
    return truthy(evalExpr(node, principal, input, item));
  }

  private Object evalExpr(Object node, PolicyPrincipal principal, ${readModelInputClassName(readModel)} input, ${readModelResultClassName(readModel)} item) {
    if (!(node instanceof Map<?, ?> raw)) {
      return null;
    }
    @SuppressWarnings("unchecked")
    Map<String, Object> expr = (Map<String, Object>) raw;
    String type = asString(expr.get("type"));
    if (type == null) {
      return null;
    }
    return switch (type) {
      case "literal" -> expr.get("value");
      case "identifier" -> resolvePath(expr.get("path"), principal, input, item);
      case "binary" -> evalBinary(expr, principal, input, item);
      case "unary" -> "not".equals(asString(expr.get("op"))) ? !evalBoolean(expr.get("operand"), principal, input, item) : null;
      case "call" -> evalCall(expr, principal, input, item);
      case "member" -> readProperty(evalExpr(expr.get("object"), principal, input, item), asString(expr.get("property")));
      case "in" -> evalIn(expr, principal, input, item);
      default -> null;
    };
  }

  private Object evalBinary(Map<String, Object> expr, PolicyPrincipal principal, ${readModelInputClassName(readModel)} input, ${readModelResultClassName(readModel)} item) {
    String op = asString(expr.get("op"));
    Object left = evalExpr(expr.get("left"), principal, input, item);
    Object right = evalExpr(expr.get("right"), principal, input, item);
    return switch (op == null ? "" : op) {
      case "&&" -> truthy(left) && truthy(right);
      case "||" -> truthy(left) || truthy(right);
      case "==" -> valuesEqual(left, right);
      case "!=" -> !valuesEqual(left, right);
      case ">" -> compareValues(left, right) > 0;
      case "<" -> compareValues(left, right) < 0;
      case ">=" -> compareValues(left, right) >= 0;
      case "<=" -> compareValues(left, right) <= 0;
      case "+" -> addValues(left, right);
      case "-" -> subtractValues(left, right);
      case "*" -> multiplyValues(left, right);
      case "/" -> divideValues(left, right);
      default -> null;
    };
  }

  private Object evalCall(Map<String, Object> expr, PolicyPrincipal principal, ${readModelInputClassName(readModel)} input, ${readModelResultClassName(readModel)} item) {
    String fn = asString(expr.get("fn"));
    List<?> args = expr.get("args") instanceof List<?> values ? values : List.of();
    return switch (fn == null ? "" : fn) {
      case "hasRole" -> args.size() >= 2 && hasRole(evalExpr(args.get(0), principal, input, item), evalExpr(args.get(1), principal, input, item));
      case "isEmpty" -> args.size() >= 1 && isEmpty(evalExpr(args.get(0), principal, input, item));
      case "isNotEmpty" -> args.size() >= 1 && !isEmpty(evalExpr(args.get(0), principal, input, item));
      case "count" -> args.size() >= 1 ? count(evalExpr(args.get(0), principal, input, item)) : 0;
      default -> false;
    };
  }

  private boolean evalIn(Map<String, Object> expr, PolicyPrincipal principal, ${readModelInputClassName(readModel)} input, ${readModelResultClassName(readModel)} item) {
    Object value = evalExpr(expr.get("value"), principal, input, item);
    if (!(expr.get("list") instanceof List<?> values)) {
      return false;
    }
    for (Object candidateNode : values) {
      Object candidate = evalExpr(candidateNode, principal, input, item);
      if (valuesEqual(value, candidate)) {
        return true;
      }
    }
    return false;
  }

  private Object resolvePath(Object candidate, PolicyPrincipal principal, ${readModelInputClassName(readModel)} input, ${readModelResultClassName(readModel)} item) {
    if (!(candidate instanceof List<?> values) || values.isEmpty()) {
      return null;
    }
    String root = asString(values.get(0));
    if (root == null) {
      return null;
    }
    if (values.size() == 1 && root.matches("[A-Z][A-Z0-9_]*")) {
      return root;
    }
    Object current = switch (root) {
      case "currentUser" -> principal;
      case "input" -> input;
      case "item" -> item;
      default -> null;
    };
    if ("currentUser".equals(root) && values.size() >= 2) {
      return resolveCurrentUser(principal, asString(values.get(1)));
    }
    for (int index = 1; index < values.size(); index += 1) {
      current = readProperty(current, asString(values.get(index)));
    }
    return current;
  }

  private Object resolveCurrentUser(PolicyPrincipal principal, String property) {
    if (property == null) {
      return principal;
    }
    return switch (property) {
      case "id", "username" -> principal.username();
      case "role" -> principal.roles().stream().findFirst().orElse(null);
      case "roles" -> principal.roles();
      default -> readProperty(principal, property);
    };
  }

  private Object readProperty(Object target, String property) {
    if (target == null || property == null || property.isBlank()) {
      return null;
    }
    if (target instanceof Map<?, ?> map) {
      return map.get(property);
    }
    try {
      Method accessor = target.getClass().getMethod(property);
      return accessor.invoke(target);
    } catch (ReflectiveOperationException ignored) {
      // Try getter form next.
    }
    try {
      Method getter = target.getClass().getMethod("get" + Character.toUpperCase(property.charAt(0)) + property.substring(1));
      return getter.invoke(target);
    } catch (ReflectiveOperationException ignored) {
      // Try field access next.
    }
    try {
      Field field = target.getClass().getDeclaredField(property);
      field.setAccessible(true);
      return field.get(target);
    } catch (ReflectiveOperationException ignored) {
      return null;
    }
  }

  private String messageFor(Map<String, Object> rule, String fallback) {
    Object message = rule.get("message");
    if (message instanceof String text && !text.isBlank()) {
      return text;
    }
    if (message instanceof Map<?, ?> descriptor) {
      Object defaultMessage = descriptor.get("defaultMessage");
      if (defaultMessage instanceof String text && !text.isBlank()) {
        return text;
      }
      Object key = descriptor.get("key");
      if (key instanceof String text && !text.isBlank()) {
        return text;
      }
    }
    return fallback;
  }

  private boolean truthy(Object value) {
    if (value instanceof Boolean flag) {
      return flag;
    }
    if (value == null) {
      return false;
    }
    if (value instanceof Number number) {
      return number.doubleValue() != 0.0d;
    }
    if (value instanceof String text) {
      return !text.isBlank();
    }
    if (value instanceof Collection<?> collection) {
      return !collection.isEmpty();
    }
    if (value instanceof Map<?, ?> map) {
      return !map.isEmpty();
    }
    return true;
  }

  private boolean valuesEqual(Object left, Object right) {
    Object normalizedLeft = normalizeValue(left);
    Object normalizedRight = normalizeValue(right);
    if (normalizedLeft instanceof Number leftNumber && normalizedRight instanceof Number rightNumber) {
      return compareNumbers(leftNumber, rightNumber) == 0;
    }
    return Objects.equals(normalizedLeft, normalizedRight);
  }

  private int compareValues(Object left, Object right) {
    Object normalizedLeft = normalizeValue(left);
    Object normalizedRight = normalizeValue(right);
    if (normalizedLeft instanceof Number leftNumber && normalizedRight instanceof Number rightNumber) {
      return compareNumbers(leftNumber, rightNumber);
    }
    if (normalizedLeft instanceof Comparable<?> comparable && normalizedLeft.getClass().isInstance(normalizedRight)) {
      @SuppressWarnings("unchecked")
      Comparable<Object> cast = (Comparable<Object>) comparable;
      return cast.compareTo(normalizedRight);
    }
    return String.valueOf(normalizedLeft).compareTo(String.valueOf(normalizedRight));
  }

  private int compareNumbers(Number left, Number right) {
    return toBigDecimal(left).compareTo(toBigDecimal(right));
  }

  private Object normalizeValue(Object value) {
    if (value instanceof Enum<?> enumValue) {
      return enumValue.name();
    }
    return value;
  }

  private boolean hasRole(Object currentUser, Object role) {
    String expectedRole = role == null ? null : String.valueOf(role);
    if (expectedRole == null || expectedRole.isBlank()) {
      return false;
    }
    Object roles = readProperty(currentUser, "roles");
    if (roles instanceof Collection<?> collection) {
      for (Object candidate : collection) {
        if (expectedRole.equals(String.valueOf(candidate))) {
          return true;
        }
      }
    }
    Object primaryRole = readProperty(currentUser, "role");
    return expectedRole.equals(String.valueOf(primaryRole));
  }

  private boolean isEmpty(Object value) {
    if (value == null) {
      return true;
    }
    if (value instanceof String text) {
      return text.isBlank();
    }
    if (value instanceof Collection<?> collection) {
      return collection.isEmpty();
    }
    if (value instanceof Map<?, ?> map) {
      return map.isEmpty();
    }
    return false;
  }

  private int count(Object value) {
    if (value == null) {
      return 0;
    }
    if (value instanceof Collection<?> collection) {
      return collection.size();
    }
    if (value instanceof Map<?, ?> map) {
      return map.size();
    }
    if (value instanceof String text) {
      return text.length();
    }
    return 0;
  }

  private String asString(Object value) {
    return value instanceof String text ? text : null;
  }

  private Object addValues(Object left, Object right) {
    if (left instanceof String || right instanceof String) {
      return String.valueOf(left == null ? "" : left) + String.valueOf(right == null ? "" : right);
    }
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      return toBigDecimal(leftNumber).add(toBigDecimal(rightNumber));
    }
    return null;
  }

  private Object subtractValues(Object left, Object right) {
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      return toBigDecimal(leftNumber).subtract(toBigDecimal(rightNumber));
    }
    return null;
  }

  private Object multiplyValues(Object left, Object right) {
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      return toBigDecimal(leftNumber).multiply(toBigDecimal(rightNumber));
    }
    return null;
  }

  private Object divideValues(Object left, Object right) {
    if (left instanceof Number leftNumber && right instanceof Number rightNumber) {
      BigDecimal divisor = toBigDecimal(rightNumber);
      if (BigDecimal.ZERO.compareTo(divisor) == 0) {
        return null;
      }
      return toBigDecimal(leftNumber).divide(divisor, 4, java.math.RoundingMode.HALF_UP);
    }
    return null;
  }

  private BigDecimal toBigDecimal(Number value) {
    return new BigDecimal(String.valueOf(value));
  }

  private String asStringValue(Object value, String fallback) {
    return value == null ? fallback : String.valueOf(value);
  }

  private Integer asIntegerValue(Object value, Integer fallback) {
    if (value instanceof Number number) {
      return number.intValue();
    }
    return fallback;
  }

  private Long asLongValue(Object value, Long fallback) {
    if (value instanceof Number number) {
      return number.longValue();
    }
    return fallback;
  }

  private BigDecimal asBigDecimalValue(Object value, BigDecimal fallback) {
    if (value instanceof BigDecimal decimal) {
      return decimal;
    }
    if (value instanceof Number number) {
      return toBigDecimal(number);
    }
    return fallback;
  }

  private Boolean asBooleanValue(Object value, Boolean fallback) {
    if (value instanceof Boolean flag) {
      return flag;
    }
    return fallback;
  }

  private static List<Map<String, Object>> loadEntries(String key) {
    try {
      Map<String, Object> manifest = OBJECT_MAPPER.readValue(
        """
${indentSnippet(manifestJson, '        ')}
        """,
        new TypeReference<Map<String, Object>>() { }
      );
      Object entries = manifest.get(key);
      if (entries instanceof List<?> list) {
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> cast = (List<Map<String, Object>>) (List<?>) list;
        return cast;
      }
      return List.of();
    } catch (Exception error) {
      throw new IllegalStateException("Failed to load generated read-model rules manifest", error);
    }
  }
}
`;
}

function generateListIntegrationTest(resource: IRResource, model: IRModel): string {
  return `
  @Test
  void listReturnsItems() throws Exception {
    ${model.name} entity = seed${model.name}(primaryRequest());

    MvcResult result = mockMvc.perform(get("${resource.api}")${authenticatedHeaderChain(resource)})
      .andExpect(status().isOk())
      .andReturn();

    JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
    assertTrue(body.path("items").isArray());
    assertEquals(1, body.path("items").size());
    assert${model.name}Node(body.path("items").get(0), entity);
  }
`;
}

function generateGetIntegrationTest(resource: IRResource, model: IRModel): string {
  return `
  @Test
  void getReturnsItem() throws Exception {
    ${model.name} entity = seed${model.name}(primaryRequest());

    MvcResult result = mockMvc.perform(get("${resource.api}/" + entity.getId())${authenticatedHeaderChain(resource)})
      .andExpect(status().isOk())
      .andReturn();

    JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
    assert${model.name}Node(body.path("item"), entity);
  }
`;
}

function generateCreateIntegrationTest(
  resource: IRResource,
  model: IRModel,
  requestClassName: string,
): string {
  return `
  @Test
  void createPersistsAndReturnsItem() throws Exception {
    ${requestClassName} request = primaryRequest();

    MvcResult result = mockMvc.perform(post("${resource.api}")${authenticatedHeaderChain(resource)}
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(request)))
      .andExpect(status().isCreated())
      .andReturn();

    assertEquals(1L, repository.count());
    ${model.name} entity = repository.findAll().get(0);
    assert${model.name}MatchesCreateRequest(entity, request);

    JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
    assert${model.name}Node(body.path("item"), entity);
  }
`;
}

function generateUpdateIntegrationTest(
  resource: IRResource,
  model: IRModel,
  requestClassName: string,
  requestFactoryInvocation: string,
): string {
  return `
  @Test
  void updatePersistsAndReturnsItem() throws Exception {
    ${model.name} entity = seed${model.name}(primaryRequest());
    ${requestClassName} request = ${requestFactoryInvocation};

    MvcResult result = mockMvc.perform(put("${resource.api}/" + entity.getId())${authenticatedHeaderChain(resource)}
        .contentType(MediaType.APPLICATION_JSON)
        .content(objectMapper.writeValueAsString(request)))
      .andExpect(status().isOk())
      .andReturn();

    ${model.name} persisted = repository.findById(entity.getId()).orElseThrow();
    assert${model.name}MatchesUpdateRequest(persisted, request);

    JsonNode body = objectMapper.readTree(result.getResponse().getContentAsString());
    assert${model.name}Node(body.path("item"), persisted);
  }
`;
}

function generateDeleteIntegrationTest(resource: IRResource, model: IRModel): string {
  return `
  @Test
  void deleteRemovesItem() throws Exception {
    ${model.name} entity = seed${model.name}(primaryRequest());

    mockMvc.perform(delete("${resource.api}/" + entity.getId())${authenticatedHeaderChain(resource)})
      .andExpect(status().isNoContent());

    assertEquals(0L, repository.count());
  }
`;
}

function generatePrimaryRequestFactoryMethod(
  resource: IRResource,
  model: IRModel,
  nestedCreate: NestedCreateResourceAnalysis | null,
): string {
  const variant: SampleVariant = 'primary';
  const overrides = computeCreateRuleSampleOverrides(resource, model, variant, nestedCreate);
  const editableFields = editableModelFields(model);
  const args = editableFields.map((field) => `      ${sampleRequestValue(resource, model, field, variant, overrides)}`);
  const nestedArgs = nestedCreate?.includes.map((include) => `      ${sampleNestedCreateIncludeValue(resource, include, variant)}`) ?? [];
  const requestClass = nestedCreate ? resourceCreateRequestClassName(resource) : `${model.name}Request`;
  const allArgs = [...args, ...nestedArgs];
  if (allArgs.length === 0) {
    return `
  private ${requestClass} primaryRequest() {
    return new ${requestClass}();
  }
`;
  }
  return `
  private ${requestClass} primaryRequest() {
    return new ${requestClass}(
${allArgs.join(',\n')}
    );
  }
`;
}

function generateSecondaryRequestFactoryMethod(
  resource: IRResource,
  model: IRModel,
  nestedUpdate: NestedUpdateResourceAnalysis | null,
): string {
  const variant: SampleVariant = 'secondary';
  const editableFields = editableModelFields(model);
  const args = editableFields.map((field) => `      ${sampleRequestValue(resource, model, field, variant)}`);
  const requestClass = nestedUpdate ? resourceUpdateRequestClassName(resource) : `${model.name}Request`;
  const methodSignature = nestedUpdate ? `${model.name} entity` : '';
  const invocationTarget = nestedUpdate ? 'entity' : null;
  const nestedArgs = nestedUpdate?.includes.map((include) => `      ${sampleNestedUpdateIncludeValue(resource, include, variant, invocationTarget)}`) ?? [];
  const allArgs = [...args, ...nestedArgs];
  if (allArgs.length === 0) {
    return `
  private ${requestClass} secondaryRequest(${methodSignature}) {
    return new ${requestClass}();
  }
`;
  }
  return `
  private ${requestClass} secondaryRequest(${methodSignature}) {
    return new ${requestClass}(
${allArgs.join(',\n')}
    );
  }
`;
}

function generateSeedEntityMethod(
  resource: IRResource,
  model: IRModel,
  nestedCreate: NestedCreateResourceAnalysis | null,
): string {
  if (!nestedCreate) {
    return `
  private ${model.name} seed${model.name}(${model.name}Request request) {
    ${model.name} entity = new ${model.name}();
    apply${model.name}Request(entity, request);
    return repository.save(entity);
  }
`;
  }
  const persistCalls = nestedCreate.includes.map((include) =>
    `    persist${toPascalCase(resource.name)}${toPascalCase(include.fieldName)}Items(entity, request.${include.fieldName}());`,
  );
  return `
  private ${model.name} seed${model.name}(${resourceCreateRequestClassName(resource)} request) {
    ${model.name} entity = new ${model.name}();
    apply${toPascalCase(resource.name)}CreateRequest(entity, request);
    entity = repository.save(entity);
${persistCalls.length > 0 ? persistCalls.join('\n') : '    // No nested items in this slice'}
    return repository.findById(entity.getId()).orElseThrow();
  }
`;
}

function generateApplyRequestMethod(
  resource: IRResource,
  model: IRModel,
  nestedCreate: NestedCreateResourceAnalysis | null,
): string {
  if (!nestedCreate) {
    const editableFields = editableModelFields(model);
    const lines = editableFields.map((field) => {
      if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
        const relationField = field.fieldType as Extract<IRFieldType, { type: 'relation'; kind: 'belongsTo' }>;
        const targetModelName = relationField.target;
        return `    entity.set${toPascalCase(field.name)}(request.${field.name}() != null ? ${relationRepositoryFieldName(targetModelName)}.findById(request.${field.name}()).orElseThrow() : null);`;
      }
      return `    entity.set${toPascalCase(field.name)}(request.${field.name}());`;
    });
    return `
  private void apply${model.name}Request(${model.name} entity, ${model.name}Request request) {
${lines.length > 0 ? lines.join('\n') : '    // No editable fields in v0.1'}
  }
`;
  }
  const editableFields = editableModelFields(model);
  const lines = editableFields.map((field) => springRequestAssignmentLine(model, field, 'request'));
  const includeHelpers = nestedCreate.includes.map((include) => {
    const itemClassName = resourceCreateItemClassName(resource, include.fieldName);
    const applyItemLines = include.childFields.map((field) => springRequestAssignmentLine(include.targetModel, field, 'request'));
    return `
  private void persist${toPascalCase(resource.name)}${toPascalCase(include.fieldName)}Items(${model.name} parent, List<${itemClassName}> items) {
    if (items == null) {
      return;
    }
    for (${itemClassName} item : items) {
      ${include.targetModel.name} entity = new ${include.targetModel.name}();
      apply${toPascalCase(resource.name)}${toPascalCase(include.fieldName)}Item(entity, item);
      entity.set${toPascalCase(include.relationField.fieldType.by)}(parent);
      ${relationRepositoryFieldName(include.targetModel.name)}.save(entity);
    }
  }

  private void apply${toPascalCase(resource.name)}${toPascalCase(include.fieldName)}Item(${include.targetModel.name} entity, ${itemClassName} request) {
${applyItemLines.length > 0 ? applyItemLines.join('\n') : '    // No editable child fields in this slice'}
  }
`;
  }).join('\n');
  return `
  private void apply${toPascalCase(resource.name)}CreateRequest(${model.name} entity, ${resourceCreateRequestClassName(resource)} request) {
${lines.length > 0 ? lines.join('\n') : '    // No editable fields in v0.1'}
  }
${includeHelpers}
`;
}

function generateRelationSampleSeedMethod(model: IRModel, variant: SampleVariant): string {
  const cacheFieldName = sampleSeedCacheFieldName(model.name, variant);
  const methodName = sampleSeedMethodName(model.name, variant);
  const setters = editableModelFields(model).map((field) => {
    if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
      const relationField = field.fieldType as Extract<IRFieldType, { type: 'relation'; kind: 'belongsTo' }>;
      const targetModelName = relationField.target;
      return `    entity.set${toPascalCase(field.name)}(${sampleSeedMethodName(targetModelName, variant)}());`;
    }
    return `    entity.set${toPascalCase(field.name)}(${sampleFieldValue(model, field, variant)});`;
  });
  return `
  private ${model.name} ${methodName}() {
    if (${cacheFieldName} != null) {
      return ${cacheFieldName};
    }
    ${model.name} entity = new ${model.name}();
${setters.length > 0 ? setters.join('\n') : '    // No editable fields in v0.1'}
    ${cacheFieldName} = ${relationRepositoryFieldName(model.name)}.save(entity);
    return ${cacheFieldName};
  }
`;
}

function generateAssertEntityMatchesRequestMethod(
  resource: IRResource,
  model: IRModel,
  nestedCreate: NestedCreateResourceAnalysis | null,
  nestedUpdate: NestedUpdateResourceAnalysis | null,
): string {
  const editableFields = editableModelFields(model)
    .filter((field) => !(resource.workflow && field.name === resource.workflow.program.field));
  const createRequestClass = nestedCreate ? resourceCreateRequestClassName(resource) : `${model.name}Request`;
  const updateRequestClass = nestedUpdate ? resourceUpdateRequestClassName(resource) : `${model.name}Request`;
  const createLines = editableFields.map((field) => `    ${assertEntityMatchesRequestLine(model, field)}`);
  const updateLines = editableFields.map((field) => `    ${assertEntityMatchesRequestLine(model, field)}`);
  const createCountLines = nestedCreate?.includes.map((include) => `    assertEquals(request.${include.fieldName}() != null ? request.${include.fieldName}().size() : 0, ${nestedChildCountExpression(include)});`) ?? [];
  const updateCountLines = nestedUpdate?.includes.map((include) => `    assertEquals(request.${include.fieldName}() != null ? request.${include.fieldName}().size() : 0, ${nestedChildCountExpression(include)});`) ?? [];
  const parts = [`
  private void assert${model.name}MatchesCreateRequest(${model.name} entity, ${createRequestClass} request) {
${[...createLines, ...createCountLines].length > 0 ? [...createLines, ...createCountLines].join('\n') : '    assertTrue(true);'}
  }
`];
  if (updateRequestClass === createRequestClass) {
    parts.push(`
  private void assert${model.name}MatchesUpdateRequest(${model.name} entity, ${updateRequestClass} request) {
    assert${model.name}MatchesCreateRequest(entity, request);
  }
`);
  } else {
    parts.push(`
  private void assert${model.name}MatchesUpdateRequest(${model.name} entity, ${updateRequestClass} request) {
${[...updateLines, ...updateCountLines].length > 0 ? [...updateLines, ...updateCountLines].join('\n') : '    assertTrue(true);'}
  }
`);
  }
  return parts.join('\n');
}

function sampleNestedCreateIncludeValue(
  resource: IRResource,
  include: NestedCreateIncludeAnalysis,
  variant: SampleVariant,
): string {
  const args = include.childFields.map((field) => `          ${sampleFieldValue(include.targetModel, field, variant)}`);
  return `List.of(
        new ${resourceCreateItemClassName(resource, include.fieldName)}(
${args.join(',\n')}
        )
      )`;
}

function sampleNestedUpdateIncludeValue(
  resource: IRResource,
  include: NestedCreateIncludeAnalysis,
  variant: SampleVariant,
  entityRef: string | null,
): string {
  const args = include.childFields.map((field) => `          ${sampleFieldValue(include.targetModel, field, variant)}`);
  const idArg = entityRef ? `${existingNestedItemIdHelperName(include)}(${entityRef})` : 'null';
  return `List.of(
        new ${resourceUpdateItemClassName(resource, include.fieldName)}(
          ${idArg},
${args.join(',\n')}
        )
      )`;
}

function nestedChildCountExpression(
  include: NestedCreateIncludeAnalysis,
): string {
  return `${relationRepositoryFieldName(include.targetModel.name)}.findAll().stream()
      .filter(item -> item.get${toPascalCase(include.relationField.fieldType.by)}() != null)
      .filter(item -> Objects.equals(item.get${toPascalCase(include.relationField.fieldType.by)}().getId(), entity.getId()))
      .count()`;
}

function existingNestedItemIdHelperName(include: NestedCreateIncludeAnalysis): string {
  return `existing${toPascalCase(include.fieldName)}Id`;
}

function generateNestedUpdateIntegrationHelpers(
  model: IRModel,
  nestedUpdate: NestedUpdateResourceAnalysis | null,
): string {
  if (!nestedUpdate) {
    return '';
  }
  return nestedUpdate.includes.map((include) => `
  private Long ${existingNestedItemIdHelperName(include)}(${model.name} entity) {
    return ${relationRepositoryFieldName(include.targetModel.name)}.findAll().stream()
      .filter(item -> item.get${toPascalCase(include.relationField.fieldType.by)}() != null)
      .filter(item -> Objects.equals(item.get${toPascalCase(include.relationField.fieldType.by)}().getId(), entity.getId()))
      .map(${include.targetModel.name}::getId)
      .findFirst()
      .orElse(null);
  }
`).join('\n');
}

function generateAssertNodeMethod(model: IRModel): string {
  const fieldAssertions = persistedModelFields(model).map((field) => `    ${assertNodeLine(model, field)}`);
  return `
  private void assert${model.name}Node(JsonNode node, ${model.name} entity) {
    assertTrue(node.isObject());
    assertEquals(entity.getId().longValue(), node.path("id").asLong());
${fieldAssertions.join('\n')}
  }
`;
}

function generateAdminAuthorizationHeaderMethod(): string {
  return `
  private String adminAuthorizationHeader() {
    return "Basic " + Base64.getEncoder().encodeToString("admin:admin123".getBytes(StandardCharsets.UTF_8));
  }
`;
}

function buildPreAuthorize(surface: { auth: { mode: 'public' | 'authenticated'; roles: string[] } }): string | null {
  if (surface.auth.mode === 'public') {
    return null;
  }
  if (surface.auth.roles.length === 0) {
    return '@PreAuthorize("isAuthenticated()")';
  }
  return `@PreAuthorize("hasAnyRole(${surface.auth.roles.map((role) => `'${role}'`).join(', ')})")`;
}

function generateReadModelRequestParameter(field: IRReadModelField, imports: Set<string>): string {
  const typeName = readModelJavaType(field);
  addReadModelJavaTypeImports(imports, typeName);
  const annotations = [`@RequestParam(name = "${field.name}"${hasDecorator(field, 'required') ? '' : ', required = false'})`];
  if (field.fieldType.type === 'scalar' && field.fieldType.name === 'date') {
    imports.add('import org.springframework.format.annotation.DateTimeFormat;');
    annotations.push('@DateTimeFormat(iso = DateTimeFormat.ISO.DATE)');
  }
  return `${annotations.join(' ')} ${typeName} ${field.name}`;
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
  const analyses: NestedCreateIncludeAnalysis[] = [];

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
    analyses.push({
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
    includes: analyses,
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
  const analyses: NestedCreateIncludeAnalysis[] = [];

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
    analyses.push({
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
    includes: analyses,
  };
}

function resourceCreateRequestClassName(resource: IRResource): string {
  return `${toPascalCase(resource.name)}CreateRequest`;
}

function resourceCreateItemClassName(resource: IRResource, fieldName: string): string {
  return `${toPascalCase(resource.name)}${toPascalCase(fieldName)}CreateItem`;
}

function resourceUpdateRequestClassName(resource: IRResource): string {
  return `${toPascalCase(resource.name)}UpdateRequest`;
}

function resourceUpdateItemClassName(resource: IRResource, fieldName: string): string {
  return `${toPascalCase(resource.name)}${toPascalCase(fieldName)}UpdateItem`;
}

function serviceCreateMethodName(resource: IRResource): string {
  return `create${toPascalCase(resource.name)}`;
}

function serviceUpdateMethodName(resource: IRResource): string {
  return `update${toPascalCase(resource.name)}`;
}

function springRequestAssignmentLine(
  model: IRModel,
  field: IRModelField,
  requestRef: string,
): string {
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    const accessor = toPascalCase(field.name);
    const repositoryField = relationRepositoryFieldName(field.fieldType.target);
    const requestAccessor = `${requestRef}.${field.name}()`;
    const notFoundMessage = relationNotFoundMessage(field.fieldType.target);
    if (hasDecorator(field, 'required')) {
      return `    entity.set${accessor}(${repositoryField}.findById(${requestAccessor}).orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "${notFoundMessage}")));`;
    }
    return `    entity.set${accessor}(${requestAccessor} == null ? null : ${repositoryField}.findById(${requestAccessor}).orElseThrow(() -> new ResponseStatusException(HttpStatus.BAD_REQUEST, "${notFoundMessage}")));`;
  }
  return `    entity.set${toPascalCase(field.name)}(${requestRef}.${field.name}());`;
}

function generateNestedCreateServiceMethod(
  model: IRModel,
  analysis: NestedCreateResourceAnalysis,
): string {
  const requestClass = resourceCreateRequestClassName(analysis.resource);
  const persistCalls = analysis.includes.map((include) =>
    `    persist${toPascalCase(analysis.resource.name)}${toPascalCase(include.fieldName)}Items(entity, request.${include.fieldName}());`,
  );
  return `
  @Transactional
  public ${model.name}Response ${serviceCreateMethodName(analysis.resource)}(${requestClass} request) {
    ${model.name} entity = new ${model.name}();
    apply${toPascalCase(analysis.resource.name)}CreateRequest(entity, request);
    entity = repository.save(entity);
${persistCalls.length > 0 ? persistCalls.join('\n') : '    // No nested items in this slice'}
    return toResponse(entity);
  }
`;
}

function generateNestedCreateServiceHelpers(
  model: IRModel,
  analysis: NestedCreateResourceAnalysis,
): string {
  const applyRootLines = editableModelFields(model).map((field) => springRequestAssignmentLine(model, field, 'request'));
  const rootHelper = `
  private void apply${toPascalCase(analysis.resource.name)}CreateRequest(${model.name} entity, ${resourceCreateRequestClassName(analysis.resource)} request) {
${applyRootLines.length > 0 ? applyRootLines.join('\n') : '    // No editable fields in v0.1'}
  }
`;
  const includeHelpers = analysis.includes.map((include) => {
    const itemClassName = resourceCreateItemClassName(analysis.resource, include.fieldName);
    const applyItemLines = include.childFields.map((field) => springRequestAssignmentLine(include.targetModel, field, 'request'));
    return `
  private void persist${toPascalCase(analysis.resource.name)}${toPascalCase(include.fieldName)}Items(${model.name} parent, List<${itemClassName}> items) {
    if (items == null) {
      return;
    }
    for (${itemClassName} item : items) {
      ${include.targetModel.name} entity = new ${include.targetModel.name}();
      apply${toPascalCase(analysis.resource.name)}${toPascalCase(include.fieldName)}Item(entity, item);
      entity.set${toPascalCase(include.relationField.fieldType.by)}(parent);
      ${relationRepositoryFieldName(include.targetModel.name)}.save(entity);
    }
  }

  private void apply${toPascalCase(analysis.resource.name)}${toPascalCase(include.fieldName)}Item(${include.targetModel.name} entity, ${itemClassName} request) {
${applyItemLines.length > 0 ? applyItemLines.join('\n') : '    // No editable child fields in this slice'}
  }
`;
  }).join('\n');
  return `${rootHelper}${includeHelpers}`;
}

function generateNestedUpdateServiceMethod(
  model: IRModel,
  analysis: NestedUpdateResourceAnalysis,
): string {
  const requestClass = resourceUpdateRequestClassName(analysis.resource);
  const syncCalls = analysis.includes.map((include) =>
    `    sync${toPascalCase(analysis.resource.name)}${toPascalCase(include.fieldName)}Items(entity, request.${include.fieldName}());`,
  );
  return `
  @Transactional
  public ${model.name}Response ${serviceUpdateMethodName(analysis.resource)}(Long id, ${requestClass} request) {
    ${model.name} entity = findEntity(id);
    apply${toPascalCase(analysis.resource.name)}UpdateRequest(entity, request);
${syncCalls.length > 0 ? syncCalls.join('\n') : '    // No nested items in this slice'}
    return toResponse(repository.save(entity));
  }
`;
}

function generateNestedUpdateServiceHelpers(
  model: IRModel,
  analysis: NestedUpdateResourceAnalysis,
): string {
  const applyRootLines = editableModelFields(model).map((field) => springRequestAssignmentLine(model, field, 'request'));
  const rootHelper = `
  private void apply${toPascalCase(analysis.resource.name)}UpdateRequest(${model.name} entity, ${resourceUpdateRequestClassName(analysis.resource)} request) {
${applyRootLines.length > 0 ? applyRootLines.join('\n') : '    // No editable fields in v0.1'}
  }
`;
  const includeHelpers = analysis.includes.map((include) => {
    const itemClassName = resourceUpdateItemClassName(analysis.resource, include.fieldName);
    const applyItemLines = include.childFields.map((field) => springRequestAssignmentLine(include.targetModel, field, 'request'));
    return `
  private void sync${toPascalCase(analysis.resource.name)}${toPascalCase(include.fieldName)}Items(${model.name} parent, List<${itemClassName}> items) {
    Map<Long, ${include.targetModel.name}> existing = ${relationRepositoryFieldName(include.targetModel.name)}.findAll().stream()
      .filter(item -> item.get${toPascalCase(include.relationField.fieldType.by)}() != null)
      .filter(item -> Objects.equals(item.get${toPascalCase(include.relationField.fieldType.by)}().getId(), parent.getId()))
      .collect(Collectors.toMap(${include.targetModel.name}::getId, Function.identity()));
    if (items == null) {
      for (${include.targetModel.name} leftover : existing.values()) {
        ${relationRepositoryFieldName(include.targetModel.name)}.delete(leftover);
      }
      return;
    }
    for (${itemClassName} item : items) {
      ${include.targetModel.name} entity;
      if (item.id() != null) {
        entity = existing.remove(item.id());
        if (entity == null) {
          throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "${include.targetModel.name} not found for nested update");
        }
      } else {
        entity = new ${include.targetModel.name}();
      }
      apply${toPascalCase(analysis.resource.name)}${toPascalCase(include.fieldName)}UpdateItem(entity, item);
      entity.set${toPascalCase(include.relationField.fieldType.by)}(parent);
      ${relationRepositoryFieldName(include.targetModel.name)}.save(entity);
    }
    for (${include.targetModel.name} leftover : existing.values()) {
      ${relationRepositoryFieldName(include.targetModel.name)}.delete(leftover);
    }
  }

  private void apply${toPascalCase(analysis.resource.name)}${toPascalCase(include.fieldName)}UpdateItem(${include.targetModel.name} entity, ${itemClassName} request) {
${applyItemLines.length > 0 ? applyItemLines.join('\n') : '    // No editable child fields in this slice'}
  }
`;
  }).join('\n');
  return `${rootHelper}${includeHelpers}`;
}

function collectNestedDeleteIncludes(
  nestedCreateResources: NestedCreateResourceAnalysis[],
  nestedUpdateResources: NestedUpdateResourceAnalysis[],
): NestedCreateIncludeAnalysis[] {
  const includeMap = new Map<string, NestedCreateIncludeAnalysis>();
  for (const include of [...nestedCreateResources.flatMap((resource) => resource.includes), ...nestedUpdateResources.flatMap((resource) => resource.includes)]) {
    const key = `${include.fieldName}:${include.targetModel.name}:${include.relationField.fieldType.by}`;
    if (!includeMap.has(key)) {
      includeMap.set(key, include);
    }
  }
  return Array.from(includeMap.values());
}

function generateNestedDeleteServiceHelpers(
  model: IRModel,
  nestedCreateResources: NestedCreateResourceAnalysis[],
  nestedUpdateResources: NestedUpdateResourceAnalysis[],
): string {
  const includes = collectNestedDeleteIncludes(nestedCreateResources, nestedUpdateResources);
  if (includes.length === 0) {
    return '';
  }
  const deleteCalls = includes.map((include) => `    delete${model.name}${toPascalCase(include.fieldName)}Items(entity);`);
  const includeHelpers = includes.map((include) => `
  private void delete${model.name}${toPascalCase(include.fieldName)}Items(${model.name} parent) {
    ${relationRepositoryFieldName(include.targetModel.name)}.findAll().stream()
      .filter(item -> item.get${toPascalCase(include.relationField.fieldType.by)}() != null)
      .filter(item -> Objects.equals(item.get${toPascalCase(include.relationField.fieldType.by)}().getId(), parent.getId()))
      .forEach(${relationRepositoryFieldName(include.targetModel.name)}::delete);
  }
`).join('\n');
  return `
  private void deleteNestedChildren(${model.name} entity) {
${deleteCalls.join('\n')}
  }
${includeHelpers}`;
}

function generateRequestComponent(
  ir: IRSdslProgram,
  model: IRModel,
  field: IRModelField,
  imports: Set<string>,
): string {
  const annotations = buildRequestValidationAnnotations(field, imports);
  const typeName = requestJavaType(model, field);
  addJavaTypeImports(imports, typeName);
  addDomainTypeImport(imports, ir.app.packageName, typeName);
  return `${annotations.map((annotation) => `  ${annotation}`).join('\n')}${annotations.length > 0 ? '\n' : ''}  ${typeName} ${field.name}`;
}

function buildRequestValidationAnnotations(field: IRModelField, imports: Set<string>): string[] {
  const annotations: string[] = [];
  const minLen = numericDecoratorArg(field, 'minLen');
  const maxLen = numericDecoratorArg(field, 'maxLen');

  if (hasDecorator(field, 'required')) {
    if (field.fieldType.type === 'scalar' && (field.fieldType.name === 'string' || field.fieldType.name === 'text')) {
      imports.add('jakarta.validation.constraints.NotBlank');
      annotations.push('@NotBlank');
    } else {
      imports.add('jakarta.validation.constraints.NotNull');
      annotations.push('@NotNull');
    }
  }
  if (hasDecorator(field, 'email')) {
    imports.add('jakarta.validation.constraints.Email');
    annotations.push('@Email');
  }
  if (minLen !== undefined || maxLen !== undefined) {
    imports.add('jakarta.validation.constraints.Size');
    const parts: string[] = [];
    if (minLen !== undefined) {
      parts.push(`min = ${minLen}`);
    }
    if (maxLen !== undefined) {
      parts.push(`max = ${maxLen}`);
    }
    annotations.push(`@Size(${parts.join(', ')})`);
  }
  return annotations;
}

function editableModelFields(model: IRModel): IRModelField[] {
  return persistedModelFields(model)
    .filter((field) => !hasDecorator(field, 'createdAt') && !hasDecorator(field, 'updatedAt'));
}

function findAuditFields(model: IRModel): { createdAt?: IRModelField; updatedAt?: IRModelField } {
  return {
    createdAt: persistedModelFields(model).find((field) => hasDecorator(field, 'createdAt')),
    updatedAt: persistedModelFields(model).find((field) => hasDecorator(field, 'updatedAt')),
  };
}

function persistedModelFields(model: IRModel): IRModelField[] {
  return model.fields.filter((field) => !(field.fieldType.type === 'relation' && field.fieldType.kind === 'hasMany'));
}

function fieldJavaType(model: IRModel, field: IRModelField): string {
  if (field.fieldType.type === 'enum') {
    return enumClassName(model.name, field.name);
  }
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return field.fieldType.target;
  }
  if (field.fieldType.type !== 'scalar') {
    return 'String';
  }
  switch (field.fieldType.name) {
    case 'string':
    case 'text':
      return 'String';
    case 'integer':
      return 'Integer';
    case 'long':
      return 'Long';
    case 'decimal':
      return 'BigDecimal';
    case 'boolean':
      return 'Boolean';
    case 'datetime':
      return 'Instant';
    case 'date':
      return 'LocalDate';
  }
}

function readModelJavaType(field: IRReadModelField): string {
  if (field.fieldType.type !== 'scalar') {
    return 'String';
  }
  switch (field.fieldType.name) {
    case 'string':
    case 'text':
      return 'String';
    case 'integer':
      return 'Integer';
    case 'long':
      return 'Long';
    case 'decimal':
      return 'BigDecimal';
    case 'boolean':
      return 'Boolean';
    case 'datetime':
      return 'Instant';
    case 'date':
      return 'LocalDate';
  }
}

function requestJavaType(model: IRModel, field: IRModelField): string {
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return 'Long';
  }
  return fieldJavaType(model, field);
}

function responseJavaType(model: IRModel, field: IRModelField): string {
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return 'Long';
  }
  return fieldJavaType(model, field);
}

function enumClassName(modelName: string, fieldName: string): string {
  return `${modelName}${toPascalCase(fieldName)}`;
}

function safeTableName(modelName: string): string {
  const baseName = toSnakeCase(modelName);
  if (isReservedSqlIdentifier(baseName)) {
    return `${baseName}_records`;
  }
  return baseName;
}

function addJavaTypeImports(imports: Set<string>, typeName: string): void {
  if (typeName === 'BigDecimal') {
    imports.add('java.math.BigDecimal');
  }
  if (typeName === 'Instant') {
    imports.add('java.time.Instant');
  }
  if (typeName === 'LocalDate') {
    imports.add('java.time.LocalDate');
  }
}

function addReadModelJavaTypeImports(imports: Set<string>, typeName: string): void {
  if (typeName === 'BigDecimal') {
    imports.add('import java.math.BigDecimal;');
  }
  if (typeName === 'Instant') {
    imports.add('import java.time.Instant;');
  }
  if (typeName === 'LocalDate') {
    imports.add('import java.time.LocalDate;');
  }
}

function generateReadModelDtoComponent(field: IRReadModelField, imports: Set<string>): string {
  const typeName = readModelJavaType(field);
  addReadModelJavaTypeImports(imports, typeName);
  return `  ${typeName} ${field.name}`;
}

function addDomainTypeImport(imports: Set<string>, basePackage: string, typeName: string): void {
  if (!isJavaBuiltinType(typeName)) {
    imports.add(`${basePackage}.domain.${typeName}`);
  }
}

function addJavaTypeImportsFromStatement(imports: Set<string>, basePackage: string, typeName: string): void {
  if (typeName === 'BigDecimal') {
    imports.add('import java.math.BigDecimal;');
    return;
  }
  if (typeName === 'Instant') {
    imports.add('import java.time.Instant;');
    return;
  }
  if (typeName === 'LocalDate') {
    imports.add('import java.time.LocalDate;');
    return;
  }
  if (!isJavaBuiltinType(typeName)) {
    imports.add(`import ${basePackage}.domain.${typeName};`);
  }
}

function renderImports(imports: Set<string>): string {
  if (imports.size === 0) {
    return '';
  }
  return `${Array.from(imports).sort().map((entry) => `import ${entry};`).join('\n')}\n\n`;
}

function isJavaBuiltinType(typeName: string): boolean {
  return typeName === 'String'
    || typeName === 'Integer'
    || typeName === 'Long'
    || typeName === 'Boolean'
    || typeName === 'BigDecimal'
    || typeName === 'Instant'
    || typeName === 'LocalDate';
}

function isReservedSqlIdentifier(identifier: string): boolean {
  return SQL_RESERVED_IDENTIFIERS.has(identifier.toLowerCase());
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
type SampleScalarValue = string | number | boolean | null;
type SampleObjectValue = { [key: string]: SampleValue };
type SampleValue = SampleScalarValue | SampleObjectValue | SampleValue[];

function authenticatedHeaderChain(resource: IRResource): string {
  if (resource.auth.mode !== 'authenticated') {
    return '';
  }
  return '\n      .header("Authorization", adminAuthorizationHeader())';
}

function sampleRequestValue(
  resource: IRResource,
  model: IRModel,
  field: IRModelField,
  variant: SampleVariant,
  overrides?: Map<string, string>,
): string {
  const override = overrides?.get(field.name);
  if (override) {
    return override;
  }
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    const relationField = field.fieldType as Extract<IRFieldType, { type: 'relation'; kind: 'belongsTo' }>;
    const targetModelName = relationField.target;
    return `${sampleSeedMethodName(targetModelName, variant)}().getId()`;
  }
  if (resource.workflow && field.name === resource.workflow.program.field && field.fieldType.type === 'enum') {
    return `${enumClassName(model.name, field.name)}.${workflowInitialState(resource)}`;
  }
  return sampleFieldValue(model, field, variant);
}

function computeCreateRuleSampleOverrides(
  resource: IRResource,
  model: IRModel,
  variant: SampleVariant,
  nestedCreate: NestedCreateResourceAnalysis | null,
): Map<string, string> {
  const overrides = new Map<string, string>();
  const validationEntries = resource.create?.rules?.manifest.validation ?? [];
  if (validationEntries.length === 0) {
    return overrides;
  }
  const fieldMap = new Map(model.fields.map((field) => [field.name, field]));
  const payload: Record<string, SampleValue> = {};
  for (const field of editableModelFields(model)) {
    payload[field.name] = sampleFieldRuntimeValue(model, field, variant);
  }
  for (const include of nestedCreate?.includes ?? []) {
    payload[include.fieldName] = [
      Object.fromEntries(include.childFields.map((field) => [field.name, sampleFieldRuntimeValue(include.targetModel, field, variant)])),
    ];
  }
  for (const entry of validationEntries) {
    const derived = deriveSampleOverrideFromValidation(entry.when, payload);
    if (!derived) {
      continue;
    }
    const field = fieldMap.get(derived.fieldName);
    if (!field) {
      continue;
    }
    payload[derived.fieldName] = derived.value;
    overrides.set(derived.fieldName, renderRuntimeValueAsSample(model, field, derived.value));
  }
  return overrides;
}

function deriveSampleOverrideFromValidation(
  node: unknown,
  payload: Record<string, SampleValue>,
): { fieldName: string; value: SampleValue } | null {
  if (!isBinaryExprNode(node) || node.op !== '==') {
    return null;
  }
  const leftTarget = extractPayloadFieldTarget(node.left);
  const rightTarget = extractPayloadFieldTarget(node.right);
  if (leftTarget && !exprReferencesPayloadField(node.right, leftTarget)) {
    const value = evaluateSampleExpr(node.right, payload);
    return value === undefined ? null : { fieldName: leftTarget, value };
  }
  if (rightTarget && !exprReferencesPayloadField(node.left, rightTarget)) {
    const value = evaluateSampleExpr(node.left, payload);
    return value === undefined ? null : { fieldName: rightTarget, value };
  }
  return null;
}

function isBinaryExprNode(node: unknown): node is { type: 'binary'; op: string; left: unknown; right: unknown } {
  return Boolean(node) && typeof node === 'object' && (node as { type?: unknown }).type === 'binary';
}

function extractPayloadFieldTarget(node: unknown): string | null {
  if (!node || typeof node !== 'object') {
    return null;
  }
  if ((node as { type?: unknown }).type !== 'identifier') {
    return null;
  }
  const path = (node as { path?: unknown }).path;
  if (!Array.isArray(path) || path.length !== 2 || path[0] !== 'payload' || typeof path[1] !== 'string') {
    return null;
  }
  return path[1];
}

function exprReferencesPayloadField(node: unknown, fieldName: string): boolean {
  if (!node || typeof node !== 'object') {
    return false;
  }
  const candidate = extractPayloadFieldTarget(node);
  if (candidate === fieldName) {
    return true;
  }
  const typedNode = node as {
    type?: string;
    left?: unknown;
    right?: unknown;
    operand?: unknown;
    args?: unknown;
    object?: unknown;
    value?: unknown;
    list?: unknown;
  };
  if (typedNode.type === 'binary') {
    return exprReferencesPayloadField(typedNode.left, fieldName) || exprReferencesPayloadField(typedNode.right, fieldName);
  }
  if (typedNode.type === 'unary') {
    return exprReferencesPayloadField(typedNode.operand, fieldName);
  }
  if (typedNode.type === 'call' && Array.isArray(typedNode.args)) {
    return typedNode.args.some((arg) => exprReferencesPayloadField(arg, fieldName));
  }
  if (typedNode.type === 'member') {
    return exprReferencesPayloadField(typedNode.object, fieldName);
  }
  if (typedNode.type === 'in') {
    return exprReferencesPayloadField(typedNode.value, fieldName)
      || (Array.isArray(typedNode.list) && typedNode.list.some((item) => exprReferencesPayloadField(item, fieldName)));
  }
  return false;
}

function evaluateSampleExpr(node: unknown, payload: Record<string, SampleValue>): SampleValue | undefined {
  if (!node || typeof node !== 'object') {
    return undefined;
  }
  const typedNode = node as {
    type?: string;
    op?: string;
    value?: SampleValue;
    path?: unknown;
    left?: unknown;
    right?: unknown;
    operand?: unknown;
    fn?: string;
    args?: unknown;
    object?: unknown;
    property?: unknown;
    list?: unknown;
  };
  switch (typedNode.type) {
    case 'literal':
      return typedNode.value ?? null;
    case 'identifier':
      return resolveSampleIdentifierPath(typedNode.path, payload);
    case 'member': {
      const objectValue = evaluateSampleExpr(typedNode.object, payload);
      if (!objectValue || typeof objectValue !== 'object' || Array.isArray(objectValue) || typeof typedNode.property !== 'string') {
        return undefined;
      }
      return (objectValue as SampleObjectValue)[typedNode.property];
    }
    case 'call':
      return evaluateSampleCall(typedNode.fn, typedNode.args, payload);
    case 'binary': {
      const left = evaluateSampleExpr(typedNode.left, payload);
      const right = evaluateSampleExpr(typedNode.right, payload);
      return evaluateSampleBinary(typedNode.op, left, right);
    }
    case 'unary': {
      if (typedNode.op !== 'not') {
        return undefined;
      }
      const value = evaluateSampleExpr(typedNode.operand, payload);
      return !sampleTruthy(value);
    }
    case 'in': {
      const value = evaluateSampleExpr(typedNode.value, payload);
      if (!Array.isArray(typedNode.list)) {
        return undefined;
      }
      return typedNode.list.some((item) => evaluateSampleExpr(item, payload) === value);
    }
    default:
      return undefined;
  }
}

function resolveSampleIdentifierPath(path: unknown, payload: Record<string, SampleValue>): SampleValue | undefined {
  if (!Array.isArray(path) || path.length === 0) {
    return undefined;
  }
  if (path[0] === 'payload' && path.length === 2 && typeof path[1] === 'string') {
    return payload[path[1]];
  }
  if (path.length === 1 && typeof path[0] === 'string') {
    return path[0];
  }
  return undefined;
}

function evaluateSampleCall(fn: string | undefined, args: unknown, payload: Record<string, SampleValue>): SampleValue | undefined {
  if (!Array.isArray(args)) {
    return undefined;
  }
  switch (fn) {
    case 'count': {
      const value = evaluateSampleExpr(args[0], payload);
      return Array.isArray(value) ? value.length : 0;
    }
    case 'isEmpty': {
      const value = evaluateSampleExpr(args[0], payload);
      if (value == null) {
        return true;
      }
      if (typeof value === 'string') {
        return value.length === 0;
      }
      if (Array.isArray(value)) {
        return value.length === 0;
      }
      return false;
    }
    case 'isNotEmpty': {
      const value = evaluateSampleCall('isEmpty', args, payload);
      return typeof value === 'boolean' ? !value : undefined;
    }
    default:
      return undefined;
  }
}

function evaluateSampleBinary(op: string | undefined, left: SampleValue | undefined, right: SampleValue | undefined): SampleValue | undefined {
  switch (op) {
    case '+':
      return asSampleNumber(left) + asSampleNumber(right);
    case '-':
      return asSampleNumber(left) - asSampleNumber(right);
    case '*':
      return asSampleNumber(left) * asSampleNumber(right);
    case '/':
      return asSampleNumber(right) === 0 ? undefined : asSampleNumber(left) / asSampleNumber(right);
    case '==':
      return left === right;
    case '!=':
      return left !== right;
    case '>':
      return asSampleNumber(left) > asSampleNumber(right);
    case '<':
      return asSampleNumber(left) < asSampleNumber(right);
    case '>=':
      return asSampleNumber(left) >= asSampleNumber(right);
    case '<=':
      return asSampleNumber(left) <= asSampleNumber(right);
    case '&&':
      return sampleTruthy(left) && sampleTruthy(right);
    case '||':
      return sampleTruthy(left) || sampleTruthy(right);
    default:
      return undefined;
  }
}

function asSampleNumber(value: SampleValue | undefined): number {
  if (typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0 && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return 0;
}

function sampleTruthy(value: SampleValue | undefined): boolean {
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    return value.length > 0;
  }
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  return value != null;
}

function sampleFieldRuntimeValue(model: IRModel, field: IRModelField, variant: SampleVariant): SampleValue {
  const isPrimary = variant === 'primary';
  if (hasDecorator(field, 'email')) {
    return `${isPrimary ? 'primary' : 'secondary'}.${toKebabCase(model.name)}.${field.name}@example.com`;
  }
  if (field.fieldType.type === 'enum') {
    const values = field.fieldType.values;
    return isPrimary ? values[0] : values[Math.min(1, values.length - 1)];
  }
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return isPrimary ? 1 : 2;
  }
  if (field.fieldType.type !== 'scalar') {
    return null;
  }
  switch (field.fieldType.name) {
    case 'string':
      return `${toPascalCase(model.name)}${toPascalCase(field.name)} ${isPrimary ? 'Alpha' : 'Beta'}`;
    case 'text':
      return `${toPascalCase(model.name)}${toPascalCase(field.name)} ${isPrimary ? 'Alpha body' : 'Beta body'}`;
    case 'integer':
      return isPrimary ? 21 : 34;
    case 'long':
      return isPrimary ? 7001 : 7002;
    case 'decimal':
      return isPrimary ? 12.5 : 18.75;
    case 'boolean':
      return isPrimary;
    case 'datetime':
      return isPrimary ? '2026-01-15T10:15:30Z' : '2026-02-20T12:00:00Z';
    case 'date':
      return isPrimary ? '2026-01-15' : '2026-02-20';
  }
}

function renderRuntimeValueAsSample(model: IRModel, field: IRModelField, value: SampleValue): string {
  if (field.fieldType.type === 'enum' && typeof value === 'string') {
    return `${enumClassName(model.name, field.name)}.${value}`;
  }
  if (field.fieldType.type === 'scalar') {
    switch (field.fieldType.name) {
      case 'integer':
        return String(Math.trunc(asSampleNumber(value)));
      case 'long':
        return `${Math.trunc(asSampleNumber(value))}L`;
      case 'decimal':
        return `new BigDecimal("${asSampleNumber(value).toFixed(2)}")`;
      case 'boolean':
        return sampleTruthy(value) ? 'true' : 'false';
      case 'date':
        return `LocalDate.parse("${String(value)}")`;
      case 'datetime':
        return `Instant.parse("${String(value)}")`;
      default:
        return JSON.stringify(String(value ?? ''));
    }
  }
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return `${Math.trunc(asSampleNumber(value))}L`;
  }
  return sampleFieldValue(model, field, 'primary');
}

function sampleFieldValue(model: IRModel, field: IRModelField, variant: SampleVariant): string {
  const prefix = `${toPascalCase(model.name)}${toPascalCase(field.name)}`;
  const isPrimary = variant === 'primary';
  if (hasDecorator(field, 'email')) {
    return `"${isPrimary ? 'primary' : 'secondary'}.${toKebabCase(model.name)}.${field.name}@example.com"`;
  }
  if (field.fieldType.type === 'enum') {
    const values = field.fieldType.values;
    const selected = isPrimary ? values[0] : values[Math.min(1, values.length - 1)];
    return `${enumClassName(model.name, field.name)}.${selected}`;
  }
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return isPrimary ? '1L' : '2L';
  }
  if (field.fieldType.type !== 'scalar') {
    return '""';
  }
  switch (field.fieldType.name) {
    case 'string':
      return `"${prefix} ${isPrimary ? 'Alpha' : 'Beta'}"`;
    case 'text':
      return `"${prefix} ${isPrimary ? 'Alpha body' : 'Beta body'}"`;
    case 'integer':
      return isPrimary ? '21' : '34';
    case 'long':
      return isPrimary ? '7001L' : '7002L';
    case 'decimal':
      return isPrimary ? 'new BigDecimal("12.50")' : 'new BigDecimal("18.75")';
    case 'boolean':
      return isPrimary ? 'true' : 'false';
    case 'datetime':
      return isPrimary ? 'Instant.parse("2026-01-15T10:15:30Z")' : 'Instant.parse("2026-02-20T12:00:00Z")';
    case 'date':
      return isPrimary ? 'LocalDate.parse("2026-01-15")' : 'LocalDate.parse("2026-02-20")';
  }
}

function assertEntityMatchesRequestLine(model: IRModel, field: IRModelField): string {
  const entityValue = field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo'
    ? `entity.get${toPascalCase(field.name)}() != null ? entity.get${toPascalCase(field.name)}().getId() : null`
    : `entity.get${toPascalCase(field.name)}()`;
  const requestValue = `request.${field.name}()`;
  if (field.fieldType.type === 'enum') {
    return `assertEquals(${requestValue}, ${entityValue});`;
  }
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return `assertEquals(${requestValue}, ${entityValue});`;
  }
  if (field.fieldType.type !== 'scalar') {
    return 'assertTrue(true);';
  }
  switch (field.fieldType.name) {
    case 'decimal':
      return `assertEquals(0, ${entityValue}.compareTo(${requestValue}));`;
    default:
      return `assertEquals(${requestValue}, ${entityValue});`;
  }
}

function assertNodeLine(model: IRModel, field: IRModelField): string {
  const entityValue = `entity.get${toPascalCase(field.name)}()`;
  const nodeValue = `node.path("${field.name}")`;
  if (field.fieldType.type === 'enum') {
    return `assertEquals(${entityValue}.name(), ${nodeValue}.asText());`;
  }
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return `assertEquals(${entityValue} != null ? ${entityValue}.getId() : null, ${nodeValue}.isNull() ? null : ${nodeValue}.asLong());`;
  }
  if (field.fieldType.type !== 'scalar') {
    return 'assertTrue(true);';
  }
  switch (field.fieldType.name) {
    case 'string':
    case 'text':
      return `assertEquals(${entityValue}, ${nodeValue}.asText());`;
    case 'integer':
      return `assertEquals(${entityValue}.intValue(), ${nodeValue}.asInt());`;
    case 'long':
      return `assertEquals(${entityValue}.longValue(), ${nodeValue}.asLong());`;
    case 'decimal':
      return `assertEquals(0, ${entityValue}.compareTo(${nodeValue}.decimalValue()));`;
    case 'boolean':
      return `assertEquals(${entityValue}, ${nodeValue}.asBoolean());`;
    case 'datetime':
      return `assertTrue(Duration.between(${entityValue}, Instant.parse(${nodeValue}.asText())).abs().toNanos() < 1_000_000L);`;
    case 'date':
      return `assertEquals(${entityValue}.toString(), ${nodeValue}.asText());`;
  }
}

function responseFieldExpression(model: IRModel, field: IRModelField): string {
  if (field.fieldType.type === 'relation' && field.fieldType.kind === 'belongsTo') {
    return `entity.get${toPascalCase(field.name)}() != null ? entity.get${toPascalCase(field.name)}().getId() : null`;
  }
  return `entity.get${toPascalCase(field.name)}()`;
}

function collectBelongsToDependencyModels(
  ir: IRSdslProgram,
  model: IRModel,
  seen = new Set<string>(),
): IRModel[] {
  const dependencies: IRModel[] = [];
  for (const field of editableModelFields(model)) {
    if (field.fieldType.type !== 'relation') {
      continue;
    }
    if (field.fieldType.kind !== 'belongsTo') {
      continue;
    }
    const targetModelName = field.fieldType.target;
    const target = ir.models.find((candidate) => candidate.name === targetModelName);
    if (!target || seen.has(target.name)) {
      continue;
    }
    seen.add(target.name);
    dependencies.push(target);
    dependencies.push(...collectBelongsToDependencyModels(ir, target, seen));
  }
  return dependencies;
}

function orderModelsForCleanup(ir: IRSdslProgram): IRModel[] {
  return [...ir.models].sort((left, right) => modelCleanupDepth(ir, right) - modelCleanupDepth(ir, left));
}

function modelCleanupDepth(ir: IRSdslProgram, model: IRModel, seen = new Set<string>()): number {
  if (seen.has(model.name)) {
    return 0;
  }
  const nextSeen = new Set(seen);
  nextSeen.add(model.name);
  const dependencyDepths: number[] = [];
  for (const field of editableModelFields(model)) {
    if (field.fieldType.type !== 'relation') {
      continue;
    }
    if (field.fieldType.kind !== 'belongsTo') {
      continue;
    }
    const relationField = field.fieldType as Extract<IRFieldType, { type: 'relation'; kind: 'belongsTo' }>;
    const targetModel = ir.models.find((candidate) => candidate.name === relationField.target);
    if (!targetModel) {
      continue;
    }
    dependencyDepths.push(1 + modelCleanupDepth(ir, targetModel, nextSeen));
  }
  return dependencyDepths.length === 0 ? 0 : Math.max(...dependencyDepths);
}

function relationRepositoryFieldName(modelName: string): string {
  return `${modelName.charAt(0).toLowerCase()}${modelName.slice(1)}Repository`;
}

function sampleSeedMethodName(modelName: string, variant: SampleVariant): string {
  return `seedSample${modelName}${variant === 'primary' ? 'Primary' : 'Secondary'}`;
}

function sampleSeedCacheFieldName(modelName: string, variant: SampleVariant): string {
  return `${variant}Sample${modelName}`;
}

function relationNotFoundMessage(modelName: string): string {
  return `${modelName} relation not found`;
}

function readBackendPolicySnippet(
  policy: IRAuthPolicyEscape | undefined,
  readFile: ((fileName: string) => string) | undefined,
  fallback: string,
): string {
  if (!policy || !readFile) {
    return fallback;
  }
  try {
    const source = readFile(policy.resolvedPath).trim();
    return source.length > 0 ? source : fallback;
  } catch {
    return fallback;
  }
}

function readBackendSnippetFromResolvedPath(
  handler: IRReadModelHandlerEscape | undefined,
  readFile: ((fileName: string) => string) | undefined,
  fallback: string,
): string {
  if (!handler || !readFile) {
    return fallback;
  }
  try {
    const source = readFile(handler.resolvedPath).trim();
    return source.length > 0 ? source : fallback;
  } catch {
    return fallback;
  }
}

function readSqlSourceFromResolvedPath(
  handler: IRReadModelHandlerEscape | undefined,
  readFile: ((fileName: string) => string) | undefined,
  fallback: string,
): string {
  if (!handler || handler.source !== 'sql' || !readFile) {
    return fallback;
  }
  try {
    const source = readFile(handler.resolvedPath).trim();
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

function readModelSqlJavaResultExpression(field: IRReadModelField): string {
  if (field.fieldType.type !== 'scalar') {
    return `rs.getObject("${field.name}")`;
  }
  switch (field.fieldType.name) {
    case 'string':
    case 'text':
      return `rs.getString("${field.name}")`;
    case 'integer':
      return `rs.getObject("${field.name}", Integer.class)`;
    case 'long':
      return `rs.getObject("${field.name}", Long.class)`;
    case 'decimal':
      return `rs.getBigDecimal("${field.name}")`;
    case 'boolean':
      return `rs.getObject("${field.name}", Boolean.class)`;
    case 'date':
      return `rs.getObject("${field.name}", LocalDate.class)`;
    case 'datetime':
      return `readInstantColumn(rs, "${field.name}")`;
  }
}

function escapeJavaTextBlock(input: string): string {
  return input.replace(/\r\n/g, '\n').replaceAll('"""', '\\"\\"\\"');
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

const SQL_RESERVED_IDENTIFIERS = new Set([
  'group',
  'order',
  'select',
  'table',
  'user',
  'where',
]);

function escapeXml(input: string): string {
  return input
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}
