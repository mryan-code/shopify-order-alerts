import { TEMPLATE_VARIABLES, type TemplateContext, type TemplateVariable } from "./types.js";

const TOKEN = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;
const KNOWN = new Set<string>(TEMPLATE_VARIABLES);

export function isTemplateVariable(value: string): value is TemplateVariable {
  return KNOWN.has(value);
}

export function renderTemplate(template: string, context: TemplateContext): string {
  const rendered = template.replace(TOKEN, (match, key: string) => {
    if (!isTemplateVariable(key)) return match;
    return context[key] ?? "";
  });
  return rendered
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}
