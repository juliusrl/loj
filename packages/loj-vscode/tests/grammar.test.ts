import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function readGrammar(fileName: string): string {
  return readFileSync(join(process.cwd(), 'syntaxes', fileName), 'utf8');
}

function readManifest(): {
  main: string;
  activationEvents: string[];
  contributes: {
    languages: Array<{ id: string; extensions?: string[]; filenamePatterns?: string[] }>;
    viewsContainers?: { activitybar?: Array<{ id: string }> };
    views?: Record<string, Array<{ id: string }>>;
  };
} {
  return JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    main: string;
    activationEvents: string[];
    contributes: {
      languages: Array<{ id: string; extensions?: string[]; filenamePatterns?: string[] }>;
      viewsContainers?: { activitybar?: Array<{ id: string }> };
      views?: Record<string, Array<{ id: string }>>;
    };
  };
}

describe('vscode grammars', () => {
  it('covers current web-family entities, sections, and escape hatches', () => {
    const grammar = readGrammar('rdsl.tmLanguage.json');
    expect(grammar).toContain('resource|page|readModel');
    expect(grammar).toContain('queryState');
    expect(grammar).toContain('selectionState');
    expect(grammar).toContain('dateNavigation');
    expect(grammar).toContain('workflow');
    expect(grammar).toContain('related');
    expect(grammar).toContain('seo');
    expect(grammar).toContain('style');
    expect(grammar).toContain('siteName');
    expect(grammar).toContain('defaultTitle');
    expect(grammar).toContain('prevLabel');
    expect(grammar).toContain('nextLabel');
    expect(grammar).toContain('completesWith');
    expect(grammar).toContain('@(fn|custom|expr|rules|flow|asset|style)');
  });

  it('covers current api-family entities, sections, and escape hatches', () => {
    const grammar = readGrammar('sdsl.tmLanguage.json');
    expect(grammar).toContain('resource|readModel|workflow|rules');
    expect(grammar).toContain('workflow');
    expect(grammar).toContain('wizard');
    expect(grammar).toContain('steps');
    expect(grammar).toContain('create');
    expect(grammar).toContain('update');
    expect(grammar).toContain('includes');
    expect(grammar).toContain('handler');
    expect(grammar).toContain('inputs');
    expect(grammar).toContain('result');
    expect(grammar).toContain('states');
    expect(grammar).toContain('transitions');
    expect(grammar).toContain('validate');
    expect(grammar).toContain('derive');
    expect(grammar).toContain('eligibility');
    expect(grammar).toContain('when');
    expect(grammar).toContain('value');
    expect(grammar).toContain('allow');
    expect(grammar).toContain('from');
    expect(grammar).toContain('to');
    expect(grammar).toContain('completesWith');
    expect(grammar).toContain('@(fn|rules|flow|sql)');
  });

  it('covers current project-shell runtime and database surfaces', () => {
    const grammar = readGrammar('loj-project.tmLanguage.json');
    expect(grammar).toContain('app|targets|dev');
    expect(grammar).toContain('database');
    expect(grammar).toContain('runtime');
    expect(grammar).toContain('vendor');
    expect(grammar).toContain('migrations');
    expect(grammar).toContain('autoProvision');
    expect(grammar).toContain('shutdown');
    expect(grammar).toContain('health');
    expect(grammar).toContain('readiness');
    expect(grammar).toContain('drain');
    expect(grammar).toContain('cors');
    expect(grammar).toContain('forwardedHeaders');
    expect(grammar).toContain('trustedProxy');
    expect(grammar).toContain('requestSizeLimit');
    expect(grammar).toContain('basePath');
    expect(grammar).toContain('previewPort');
  });

  it('covers style-family-adjacent tokens and shell properties in the current web grammar', () => {
    const grammar = readGrammar('rdsl.tmLanguage.json');
    expect(grammar).toContain('app|compiler|imports|tokens');
    expect(grammar).toContain('colors');
    expect(grammar).toContain('spacing');
    expect(grammar).toContain('borderRadius');
    expect(grammar).toContain('elevation');
    expect(grammar).toContain('typography');
    expect(grammar).toContain('escape');
    expect(grammar).toContain('extends');
    expect(grammar).toContain('fontSize');
    expect(grammar).toContain('lineHeight');
    expect(grammar).toContain('backgroundColor');
  });

  it('registers current .rules.loj, .flow.loj, and .style.loj language entrypoints and sidebar activation', () => {
    const manifest = readManifest();
    const languages = manifest.contributes.languages;
    expect(manifest.main).toBe('./dist/extension.cjs');
    expect(manifest.activationEvents).toContain('onStartupFinished');
    expect(manifest.activationEvents).toContain('onView:lojSidebar.overview');
    expect(languages.some((language) => language.id === 'loj-rules' && language.filenamePatterns?.includes('*.rules.loj'))).toBe(true);
    expect(languages.some((language) => language.id === 'loj-flow' && language.filenamePatterns?.includes('*.flow.loj'))).toBe(true);
    expect(languages.some((language) => language.id === 'loj-style' && language.filenamePatterns?.includes('*.style.loj'))).toBe(true);
    expect(manifest.contributes.viewsContainers?.activitybar?.some((container) => container.id === 'lojSidebar')).toBe(true);
    expect(manifest.contributes.views?.lojSidebar?.some((view) => view.id === 'lojSidebar.overview')).toBe(true);
  });

  it('ships dedicated grammar files for rules, flow, and style surfaces', () => {
    const rulesGrammar = readGrammar('loj-rules.tmLanguage.json');
    const flowGrammar = readGrammar('loj-flow.tmLanguage.json');
    const styleGrammar = readGrammar('loj-style.tmLanguage.json');
    expect(rulesGrammar).toContain('rules');
    expect(rulesGrammar).toContain('validate|derive|eligibility');
    expect(rulesGrammar).toContain('when|message|value');
    expect(flowGrammar).toContain('workflow');
    expect(flowGrammar).toContain('states|wizard|steps|transitions');
    expect(flowGrammar).toContain('completesWith|surface|allow|from|to');
    expect(styleGrammar).toContain('tokens');
    expect(styleGrammar).toContain('style');
    expect(styleGrammar).toContain('colors|spacing|borderRadius|elevation|typography');
    expect(styleGrammar).toContain('escape|css|extends');
  });
});
