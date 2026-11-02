import { toSentence, shownMark, markLabel } from '../view.ts';
import { createFold, createIcon, createLink, make, renderRichText } from './dom.ts';
import type { IconName } from './dom.ts';
import type { CheckResult, ViewModel, ResultPlan } from '../types.ts';
type CheckStep = { id: string; title: string; mark: string; reason?: string; what?: string; why?: string; fix?: string; how?: string; docs?: string; };
export function renderAllChecks(result: CheckResult, viewModel: ViewModel, resultPlan: ResultPlan): HTMLElement {
  const installSourceList = (resultPlan as unknown as { installSteps?: unknown[] }).installSteps ?? [];
  const installIdentifiers = new Set<string>(installSourceList.map((entry: unknown): string => {
    if (typeof entry === 'string') return entry;
    const record = entry as { id?: unknown };
    return typeof record.id === 'string' ? record.id : '';
  }).filter((identifier: string): boolean => identifier !== ''));
  const summaryRecord = (result as unknown as { summary?: { steps?: CheckStep[] } }).summary;
  const stepList: CheckStep[] = summaryRecord?.steps ?? [];
  const totalCount: number = (resultPlan as unknown as { total?: number }).total ?? stepList.length;
  const checksContainer = make('div', 'checks');
  for (const stepRecord of stepList) {
    const identifier = stepRecord.id;
    const isDone = stepRecord.mark === 'done';
    const nextIdentifier: string | null = (viewModel as unknown as { next?: { id?: string } | null }).next?.id ?? null;
    const isNext = shownMark(stepRecord.mark, identifier, nextIdentifier) === 'next';
    const rowClass = 'ck' + (isDone ? ' is-done' : '') + (isNext ? ' ck-next' : '');
    let tagText = '';
    if (isDone) tagText = '';
    else if (isNext) tagText = 'do this first';
    else if (installIdentifiers.has(identifier)) tagText = 'needs yokoten';
    else {
      const reasonText: string = stepRecord.reason ?? '';
      tagText = markLabel(stepRecord.mark, reasonText);
    }
    const markContainer = make('span', 'ck-mark');
    let iconName: IconName = 'circle';
    if (isDone) iconName = 'check';
    else if (isNext) iconName = 'dot';
    const iconElement = createIcon(iconName);
    markContainer.appendChild(iconElement);
    const titleContainer = make('span', 'ck-title');
    renderRichText(stepRecord.title, titleContainer);
    const titleNodes: Node[] = [markContainer, titleContainer];
    if (tagText !== '') {
      const tagContainer = make('span', 'ck-tag', tagText);
      titleNodes.push(tagContainer);
    }
    const bodyNodes: Node[] = [];
    const fieldDefinitions: Array<[string, string | undefined]> = [['What we found.', stepRecord.what], ['Why it matters.', stepRecord.why], ['How to fix it.', stepRecord.fix]];
    for (const fieldPair of fieldDefinitions) {
      const leadText = fieldPair[0];
      const valueText = fieldPair[1];
      if (!valueText) continue;
      const paragraph = make('p', 'ck-field');
      const boldElement = make('b', undefined, leadText);
      paragraph.appendChild(boldElement);
      paragraph.appendChild(document.createTextNode(' '));
      renderRichText(toSentence(valueText), paragraph);
      bodyNodes.push(paragraph);
    }
    if (stepRecord.docs && stepRecord.docs !== '') {
      const docsParagraph = make('p', 'ck-field');
      const linkElement = createLink(stepRecord.docs, stepRecord.docs);
      docsParagraph.appendChild(linkElement);
      bodyNodes.push(docsParagraph);
    }
    if (stepRecord.how && stepRecord.how !== '') {
      const howParagraph = make('p', 'ck-field muted');
      renderRichText(stepRecord.how, howParagraph);
      const howFold = createFold('How this was judged', [howParagraph], { key: 'how-' + identifier });
      bodyNodes.push(howFold);
    }
    const rowFold = createFold(titleNodes, bodyNodes, { key: 'check-' + identifier, id: 'check-' + identifier, className: rowClass });
    checksContainer.appendChild(rowFold);
  }
  const outerFold = createFold(`See all ${totalCount} checks`, [checksContainer], { key: 'all-checks' });
  const sectionElement = make('section', 'plan');
  sectionElement.setAttribute('aria-label', 'All checks');
  sectionElement.appendChild(outerFold);
  return sectionElement;
}
