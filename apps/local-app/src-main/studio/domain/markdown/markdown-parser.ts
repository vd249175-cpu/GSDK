export { parseProject, stripOutlineAnnotations } from '../../../shared/project-parser.mjs';
import { parseProject } from '../../../shared/project-parser.mjs';
import type { ParsedProject } from '../types';

/**
 * Canonical GraphVideo project parser used by production, Causal Runtime and Experiment.
 * Keeping this Application alias avoids a second Markdown grammar in the Domain graph.
 */
export function parseProjectMarkdown(markdown: string): ParsedProject {
  return parseProject(markdown) as ParsedProject;
}
